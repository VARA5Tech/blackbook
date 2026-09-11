import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clientDirectives,
  customerPreferenceProfile,
  customers,
  households,
} from "@/db/schema";
import { requireCapability } from "@/auth/session";
import {
  clientDnaSchema,
  clientSearchSchema,
  createCustomerSchema,
  fullName,
  updateCustomerSchema,
  type ClientDnaInput,
  type ClientSearchInput,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from "@/domain/customers";
import { onlyProvided } from "@/domain/shared";
import * as repo from "@/repositories/customer-repository";
import { diffFields, logActivity } from "./activity-service";

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function searchClients(input: ClientSearchInput) {
  await requireCapability("client.read");
  const query = clientSearchSchema.parse(input);
  return repo.searchCustomers(query);
}

export async function getClient360(customerId: string) {
  await requireCapability("client.read");
  return repo.loadClient360(customerId);
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createCustomer(input: CreateCustomerInput) {
  const actor = await requireCapability("client.create");
  const data = createCustomerSchema.parse(input);

  await assertPhoneIsFree(data.mobile, data.whatsapp);
  await assertHouseholdExists(data.householdId);

  const customer = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(customers)
      .values({
        ...data,
        profileUpdatedAt: new Date(),
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning();

    // Every client gets a preference profile row so later edits are updates,
    // never "insert or update" branching in the UI.
    await tx
      .insert(customerPreferenceProfile)
      .values({ customerId: created.id, updatedBy: actor.id })
      .onConflictDoNothing();

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: created.id,
        action: "created",
        customerId: created.id,
        householdId: created.householdId,
        summary: `Client ${created.ref} created`,
      },
      tx,
    );

    return created;
  });

  return customer;
}

export async function updateCustomer(input: UpdateCustomerInput) {
  const actor = await requireCapability("client.update");
  const data = updateCustomerSchema.parse(input);
  const { id, ...parsed } = data;
  // Only what the caller sent: an edit form that omits a field must not blank it.
  const patch = onlyProvided(input as Record<string, unknown>, parsed);

  const existing = await repo.findCustomerById(id);
  if (!existing) throw new DomainError("Client not found");

  if (patch.primaryRmId !== undefined && patch.primaryRmId !== existing.primaryRmId) {
    await requireCapability("client.reassign_rm");
  }

  await assertPhoneIsFree(patch.mobile, patch.whatsapp, id);
  if (patch.householdId !== undefined)
    await assertHouseholdExists(patch.householdId);

  const changes = diffFields(existing, patch);
  if (Object.keys(changes).length === 0) return existing;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(customers)
      .set({
        ...patch,
        updatedAt: new Date(),
        updatedBy: actor.id,
        profileUpdatedAt: new Date(),
      })
      .where(eq(customers.id, id))
      .returning();

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: id,
        action: "updated",
        customerId: id,
        householdId: updated.householdId,
        summary: summariseChanges(changes),
        changes,
      },
      tx,
    );

    return updated;
  });
}

/** Free-text Client DNA plus the DO and DON'T lists, saved as one edit. */
export async function updateClientDna(input: ClientDnaInput) {
  const actor = await requireCapability("client.update");
  const data = clientDnaSchema.parse(input);

  const existing = await repo.findCustomerById(data.customerId);
  if (!existing) throw new DomainError("Client not found");

  return db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({
        clientDna: data.clientDna,
        updatedAt: new Date(),
        updatedBy: actor.id,
        profileUpdatedAt: new Date(),
      })
      .where(eq(customers.id, data.customerId));

    // The lists are small and fully re-sent by the editor, so replacing them
    // is simpler and more predictable than diffing individual rows.
    await tx
      .delete(clientDirectives)
      .where(eq(clientDirectives.customerId, data.customerId));

    const rows = [
      ...data.dos.map((body, index) => ({
        customerId: data.customerId,
        kind: "do" as const,
        body,
        sortOrder: index,
      })),
      ...data.donts.map((body, index) => ({
        customerId: data.customerId,
        kind: "dont" as const,
        body,
        sortOrder: index,
      })),
    ];
    if (rows.length > 0) await tx.insert(clientDirectives).values(rows);

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: data.customerId,
        action: "updated",
        customerId: data.customerId,
        householdId: existing.householdId,
        summary: "Client DNA updated",
      },
      tx,
    );
  });
}

export async function archiveCustomer(customerId: string) {
  const actor = await requireCapability("client.archive");

  const existing = await repo.findCustomerById(customerId);
  if (!existing) throw new DomainError("Client not found");
  if (existing.archivedAt) return existing;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(customers)
      .set({
        archivedAt: new Date(),
        status: "inactive",
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(customers.id, customerId))
      .returning();

    // A household must never point at an archived primary client.
    if (existing.householdId) {
      await tx
        .update(households)
        .set({ primaryCustomerId: null })
        .where(
          and(
            eq(households.id, existing.householdId),
            eq(households.primaryCustomerId, customerId),
          ),
        );
    }

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: customerId,
        action: "archived",
        customerId,
        householdId: existing.householdId,
        summary: `Client ${existing.ref} archived`,
      },
      tx,
    );

    return updated;
  });
}

/**
 * Permanently destroys a client. There is no undo.
 *
 * Two deliberate constraints, both modelled on how Twenty treats its trash:
 * the record must already be archived, so erasure is always a second,
 * considered step rather than a mis-click; and the audit entry is written
 * before the delete, so the fact that an erasure happened outlives the data it
 * erased. The audit row's client reference is cleared by the foreign key as the
 * row goes, which is exactly what migration 0003 was for.
 */
export async function eraseCustomer(customerId: string, reason: string) {
  const actor = await requireCapability("client.destroy");

  const justification = reason.trim();
  if (justification.length < 10) {
    throw new DomainError(
      "Record why this client is being erased. It is the only trace that will remain.",
    );
  }

  const existing = await repo.findCustomerById(customerId);
  if (!existing) throw new DomainError("Client not found");
  if (!existing.archivedAt) {
    throw new DomainError(
      "Archive the client first. Erasure is deliberate, not a shortcut for archiving.",
    );
  }

  await db.transaction(async (tx) => {
    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: customerId,
        action: "archived",
        customerId,
        householdId: existing.householdId,
        summary: `Client ${existing.ref} permanently erased. Reason: ${justification}`,
      },
      tx,
    );

    await tx.delete(customers).where(eq(customers.id, customerId));
  });

  return { ref: existing.ref };
}

export async function restoreCustomer(customerId: string) {
  const actor = await requireCapability("client.archive");

  const existing = await repo.findCustomerById(customerId);
  if (!existing) throw new DomainError("Client not found");
  if (!existing.archivedAt) return existing;

  await assertPhoneIsFree(existing.mobile, existing.whatsapp, customerId);

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(customers)
      .set({
        archivedAt: null,
        status: "active",
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(customers.id, customerId))
      .returning();

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: customerId,
        action: "restored",
        customerId,
        householdId: existing.householdId,
        summary: `Client ${existing.ref} restored`,
      },
      tx,
    );

    return updated;
  });
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

async function assertPhoneIsFree(
  mobile?: string | null,
  whatsapp?: string | null,
  excludeId?: string,
) {
  for (const [field, value] of [
    ["mobile", mobile],
    ["whatsapp", whatsapp],
  ] as const) {
    if (!value) continue;
    const clashes = await repo.findActiveByPhone(value, excludeId);
    if (clashes.length > 0) {
      const clash = clashes[0];
      throw new DomainError(
        `That number already belongs to ${fullName(clash)} (${clash.ref}).`,
        { [field]: [`Already used by ${clash.ref}`] },
      );
    }
  }
}

async function assertHouseholdExists(householdId: string | null | undefined) {
  if (!householdId) return;
  const household = await db.query.households.findFirst({
    where: eq(households.id, householdId),
  });
  if (!household) throw new DomainError("That household no longer exists");
}

function summariseChanges(changes: Record<string, unknown>): string {
  const fields = Object.keys(changes);
  if (fields.length === 1) return `Updated ${labelFor(fields[0])}`;
  if (fields.length <= 3)
    return `Updated ${fields.map(labelFor).join(", ")}`;
  return `Updated ${fields.length} fields`;
}

function labelFor(field: string): string {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toLowerCase())
    .trim();
}
