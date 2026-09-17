import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  activityLog,
  clientDirectives,
  clientInterests,
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
import {
  onlyProvided,
  optionalEmail,
  parseInternationalPhone,
  requiredText,
  uuidSchema,
} from "@/domain/shared";
import { logger } from "@/lib/logger";
import { posthogIsConfigured, sessionReplays } from "@/lib/posthog";
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

/** The clients list, grouped so each household appears once under its primary. */
export async function searchClientGroups(input: ClientSearchInput) {
  await requireCapability("client.read");
  const query = clientSearchSchema.parse(input);
  return repo.searchClientGroups(query);
}

export async function getClient360(customerId: string) {
  await requireCapability("client.read");
  return repo.loadClient360(customerId);
}

/* ------------------------------------------------------------------ */
/* Private access, for the vara5.travel website                        */
/* ------------------------------------------------------------------ */

export type PrivateAccessGuest = {
  /** The key the website seals into its session, and PostHog's person id. */
  id: string;
  ref: string;
  name: string;
  phone: string;
  email: string | null;
};

/**
 * Whether a phone number belongs to a client allowed through the website's
 * private gate, and where to send their code.
 *
 * No capability check, deliberately: the caller is the website, not a member
 * of staff, and `/api/private-access/lookup` authenticates it by signature
 * before calling this. Nothing else may call it.
 *
 * Only an active, unarchived client matches, on the exact international number,
 * mobile or WhatsApp. A number two clients share is refused rather than guessed.
 *
 * The code goes back to whichever of the client's own numbers was typed: clients
 * keep WhatsApp on both, and a code that arrives on the handset they just used
 * is the one they are waiting for. It is still only ever a number already on the
 * record, so nobody can have a client's code delivered to a phone of their own.
 * The answer is a name, that number, and the client's email if the record holds
 * one, which the website falls back to when WhatsApp refuses the message.
 */
export async function lookupPrivateAccessGuest(
  phone: string,
): Promise<PrivateAccessGuest | null> {
  const parsed = parseInternationalPhone(phone);
  if (!parsed) return null;

  const matches = await repo.findPrivateAccessGuests(parsed.e164.slice(1));

  if (matches.length > 1) {
    logger.warn("private_access.ambiguous_number", {
      customerIds: matches.map((match) => match.id),
    });
    return null;
  }

  const [guest] = matches;
  // The match was exact, so this is the typed number; read back off the record
  // rather than echoed, so only a stored number is ever returned.
  const sendTo = [guest?.mobileNormalized, guest?.whatsappNormalized].find(
    (number) => number === parsed.e164.slice(1),
  );
  if (!guest || !sendTo) {
    logger.info("private_access.lookup", { outcome: "not_found" });
    return null;
  }

  logger.info("private_access.lookup", { outcome: "found", customerId: guest.id });
  return {
    id: guest.id,
    ref: guest.ref,
    name: guest.preferredName?.trim() || guest.firstName,
    phone: `+${sendTo}`,
    email: guest.email,
  };
}

/**
 * The same answer, for a guest the website has already signed in.
 *
 * The website re-checks on every page load by the id in its signed session, not
 * by the number typed weeks ago, so correcting a client's phone in Blackbook
 * does not sign them out and their history stays on one client. Archiving them
 * or making them inactive still ends access at the next load.
 */
export async function lookupPrivateAccessGuestById(
  customerId: string,
): Promise<PrivateAccessGuest | null> {
  if (!uuidSchema.safeParse(customerId).success) return null;

  const guest = await repo.findPrivateAccessGuestById(customerId);
  const sendTo = guest?.whatsappNormalized ?? guest?.mobileNormalized;
  if (!guest || !sendTo) {
    logger.info("private_access.lookup_by_id", { outcome: "not_found" });
    return null;
  }

  return {
    id: guest.id,
    ref: guest.ref,
    name: guest.preferredName?.trim() || guest.firstName,
    phone: `+${sendTo}`,
    email: guest.email,
  };
}

/**
 * Keep the email a guest gave the website when WhatsApp could not reach them.
 *
 * Only fills a blank: an address already on the record is never overwritten
 * from the gate, so nobody can point a client's code at an address of their own
 * by typing one here. Same rules as the lookup, and the same reason for having
 * no capability check. The entry is written as the system, with no actor.
 */
export async function savePrivateAccessEmail(
  phone: string,
  email: string,
): Promise<boolean> {
  const address = optionalEmail.safeParse(email);
  if (!address.success || !address.data) return false;

  const parsed = parseInternationalPhone(phone);
  if (!parsed) return false;

  const matches = await repo.findPrivateAccessGuests(parsed.e164.slice(1));
  if (matches.length !== 1) return false;

  const [guest] = matches;
  if (guest.email) return false;

  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({ email: address.data, updatedAt: new Date() })
      .where(eq(customers.id, guest.id));
    await tx.insert(activityLog).values({
      entityType: "customer",
      entityId: guest.id,
      customerId: guest.id,
      action: "updated",
      summary: "Email added from the private access gate",
      changes: { email: { from: null, to: address.data } },
      actorId: null,
    });
  });

  logger.info("private_access.email_saved", { customerId: guest.id });
  return true;
}

/* ------------------------------------------------------------------ */
/* Interest, reported by vara5.travel                                  */
/* ------------------------------------------------------------------ */

export const INTEREST_KINDS = [
  "opened",
  "read",
  "photos",
  "video",
  "cta_clicked",
] as const;

const interestSchema = z.object({
  customerId: uuidSchema,
  /** The journey's slug, which the website owns. */
  destination: requiredText("Destination", 120),
  title: requiredText("Title", 200),
  kind: z.enum(INTEREST_KINDS),
  /** Capped in the schema as well as the table, so a stuck timer cannot lie. */
  seconds: z.coerce.number().int().min(0).max(86_400).default(0),
});

export type RecordInterestInput = z.input<typeof interestSchema>;

/**
 * Records what a client looked at on the members' site.
 *
 * No capability check, for the same reason as the lookup above: the caller is
 * the website, not a member of staff, and `/api/private-access/interest`
 * authenticates it by signature before calling this. Nothing else may call it.
 *
 * Refused for a client who is archived or inactive, so access ending ends the
 * record keeping with it. Only the Curator click reaches the timeline: a client
 * reading four journeys on a Sunday would otherwise bury the interactions staff
 * actually write.
 */
export async function recordPrivateAccessInterest(
  input: RecordInterestInput,
): Promise<boolean> {
  const parsed = interestSchema.safeParse(input);
  if (!parsed.success) return false;
  const data = parsed.data;

  const guest = await repo.findPrivateAccessGuestById(data.customerId);
  if (!guest) {
    logger.info("private_access.interest", { outcome: "not_found" });
    return false;
  }

  await db.transaction(async (tx) => {
    await tx.insert(clientInterests).values({
      customerId: data.customerId,
      destination: data.destination,
      title: data.title,
      kind: data.kind,
      seconds: data.seconds,
    });

    if (data.kind === "cta_clicked") {
      await tx.insert(activityLog).values({
        entityType: "customer",
        entityId: data.customerId,
        customerId: data.customerId,
        action: "interaction_logged",
        summary: `Asked the Curator about ${data.title} on vara5.travel`,
        // Nobody signed in as staff did this, so the trail records no actor.
        actorId: null,
      });
    }
  });

  logger.info("private_access.interest", {
    outcome: "recorded",
    customerId: data.customerId,
    kind: data.kind,
  });
  return true;
}

/** What a client has been reading on the members' site, for the Interest panel. */
export async function getClientInterest(customerId: string) {
  await requireCapability("client.read");
  return repo.summariseInterest(customerId);
}

/**
 * Links to the recordings of a client's visits, for the curator who wants to
 * watch rather than read a summary. Empty whenever PostHog is unconfigured or
 * unreachable, which the panel shows as simply having nothing to offer.
 */
export async function getClientReplays(customerId: string) {
  await requireCapability("client.read");
  if (!posthogIsConfigured()) return [];
  return sessionReplays(customerId);
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
