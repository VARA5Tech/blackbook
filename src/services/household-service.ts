import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireCapability } from "@/auth/session";
import { db } from "@/db";
import { customers, households, milestones, users } from "@/db/schema";
import {
  createHouseholdSchema,
  householdMemberSchema,
  updateHouseholdSchema,
  type CreateHouseholdInput,
  type HouseholdMemberInput,
  type HouseholdSort,
  type UpdateHouseholdInput,
} from "@/domain/households";
import { digitsOnly, onlyProvided } from "@/domain/shared";
import { diffFields, logActivity } from "./activity-service";
import { DomainError } from "./client-service";

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listHouseholds(
  search?: string,
  sort: HouseholdSort = "name",
  dir: "asc" | "desc" = "asc",
) {
  await requireCapability("client.read");

  const conditions = [isNull(households.archivedAt)];
  if (search?.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    const digits = digitsOnly(search);
    conditions.push(
      sql`(lower(${households.name}) like ${term}
        or lower(${households.ref}) like ${term}
        or lower(coalesce(${households.city}, '')) like ${term}
        or lower(coalesce(${households.eaName}, '')) like ${term}
        or lower(coalesce(${households.eaEmail}, '')) like ${term}
        ${digits && digits.length >= 3 ? sql`or ${households.eaPhoneNormalized} like ${`%${digits}%`}` : sql``}
        or similarity(${households.name}, ${search.trim()}) > 0.25)`,
    );
  }

  /**
   * Joins rather than correlated subqueries.
   *
   * Drizzle renders an outer column inside a raw subquery unqualified, so
   * `where c.household_id = <households.id>` binds to the subquery's own
   * customer.id and silently counts zero. Joining avoids the ambiguity
   * entirely and lets Postgres qualify every reference itself.
   */
  const member = alias(customers, "member");
  const primaryClient = alias(customers, "primary_client");
  const manager = alias(users, "manager");

  const memberCount = sql<number>`count(distinct ${member.id})::int`;
  const order = {
    name: sql`lower(${households.name})`,
    members: memberCount,
    city: sql`lower(${households.city})`,
    updated: households.updatedAt,
  }[sort];

  return db
    .select({
      id: households.id,
      ref: households.ref,
      name: households.name,
      city: households.city,
      travelPattern: households.travelPattern,
      updatedAt: households.updatedAt,
      memberCount,
      // First names in household order, so "Samrath, Karishma" reads as the family.
      memberNames: sql<string[]>`coalesce(
        array_agg(coalesce(${member.preferredName}, ${member.firstName})
          order by (${member.householdRole} = 'primary') desc, ${member.dateOfBirth} nulls last, ${member.firstName})
          filter (where ${member.id} is not null),
        '{}'
      )`,
      primaryCustomerId: primaryClient.id,
      primaryCustomerName: sql<string | null>`coalesce(
        ${primaryClient.preferredName},
        nullif(trim(${primaryClient.firstName} || ' ' || coalesce(${primaryClient.lastName}, '')), '')
      )`,
      managerNames: sql<string[]>`coalesce(
        array_agg(distinct ${manager.name}) filter (where ${manager.name} is not null),
        '{}'
      )`,
    })
    .from(households)
    .leftJoin(
      member,
      and(eq(member.householdId, households.id), isNull(member.archivedAt)),
    )
    .leftJoin(primaryClient, eq(primaryClient.id, households.primaryCustomerId))
    // Whoever manages any member: a family is usually one curator's, and a
    // household with no primary client set still has people looking after it.
    .leftJoin(manager, eq(manager.id, member.primaryRmId))
    .where(and(...conditions))
    // households.id and primaryClient.id are primary keys, so every other
    // selected column is functionally dependent on them.
    .groupBy(households.id, primaryClient.id)
    .orderBy(
      dir === "desc" ? sql`${order} desc nulls last` : sql`${order} asc nulls last`,
      asc(households.name),
    )
    .limit(200);
}

export async function getHousehold(householdId: string) {
  await requireCapability("client.read");

  const household = await db.query.households.findFirst({
    where: eq(households.id, householdId),
  });
  if (!household) return null;

  const [members, householdMilestones] = await Promise.all([
    db
      .select({
        id: customers.id,
        ref: customers.ref,
        firstName: customers.firstName,
        lastName: customers.lastName,
        preferredName: customers.preferredName,
        householdRole: customers.householdRole,
        dateOfBirth: customers.dateOfBirth,
        mobile: customers.mobile,
        email: customers.email,
        status: customers.status,
        city: customers.city,
        clientDna: customers.clientDna,
        lastInteractionAt: customers.lastInteractionAt,
        rmName: users.name,
      })
      .from(customers)
      .leftJoin(users, eq(customers.primaryRmId, users.id))
      .where(
        and(eq(customers.householdId, householdId), isNull(customers.archivedAt)),
      )
      .orderBy(asc(customers.householdRole), asc(customers.firstName)),

    db
      .select()
      .from(milestones)
      .where(
        and(
          eq(milestones.householdId, householdId),
          eq(milestones.status, "active"),
        ),
      )
      .orderBy(asc(milestones.monthOfYear), asc(milestones.dayOfMonth)),
  ]);

  return { household, members, milestones: householdMilestones };
}

/** Households a client can be attached to, for the picker on the client form. */
export async function listHouseholdOptions() {
  await requireCapability("client.read");
  return db
    .select({
      id: households.id,
      ref: households.ref,
      name: households.name,
      city: households.city,
    })
    .from(households)
    .where(isNull(households.archivedAt))
    .orderBy(asc(households.name));
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createHousehold(input: CreateHouseholdInput) {
  const actor = await requireCapability("household.manage");
  const data = createHouseholdSchema.parse(input);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(households)
      .values({ ...data, createdBy: actor.id, updatedBy: actor.id })
      .returning();

    // Creating a household around an existing client attaches them at once.
    if (data.primaryCustomerId) {
      await tx
        .update(customers)
        .set({ householdId: created.id, householdRole: "primary" })
        .where(eq(customers.id, data.primaryCustomerId));
    }

    await logActivity(
      {
        actor,
        entityType: "household",
        entityId: created.id,
        action: "created",
        householdId: created.id,
        summary: `Household ${created.ref} created`,
      },
      tx,
    );

    return created;
  });
}

export async function updateHousehold(input: UpdateHouseholdInput) {
  const actor = await requireCapability("household.manage");
  const data = updateHouseholdSchema.parse(input);
  const { id, ...parsed } = data;
  // Only what the caller sent: an edit that omits a field must not blank it.
  const patch = onlyProvided(input as Record<string, unknown>, parsed);

  const existing = await db.query.households.findFirst({
    where: eq(households.id, id),
  });
  if (!existing) throw new DomainError("Household not found");

  if (patch.primaryCustomerId) {
    const member = await db.query.customers.findFirst({
      where: and(
        eq(customers.id, patch.primaryCustomerId),
        eq(customers.householdId, id),
      ),
    });
    if (!member) {
      throw new DomainError(
        "The primary client must already be a member of this household",
      );
    }
  }

  const changes = diffFields(existing, patch);
  if (Object.keys(changes).length === 0) return existing;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(households)
      .set({ ...patch, updatedAt: new Date(), updatedBy: actor.id })
      .where(eq(households.id, id))
      .returning();

    if (patch.primaryCustomerId) {
      await tx
        .update(customers)
        .set({ householdRole: "primary" })
        .where(eq(customers.id, patch.primaryCustomerId));
    }

    await logActivity(
      {
        actor,
        entityType: "household",
        entityId: id,
        action: "updated",
        householdId: id,
        summary: `Household ${updated.ref} updated`,
        changes,
      },
      tx,
    );

    return updated;
  });
}

export async function addHouseholdMember(input: HouseholdMemberInput) {
  const actor = await requireCapability("household.manage");
  const data = householdMemberSchema.parse(input);

  const [household, customer] = await Promise.all([
    db.query.households.findFirst({ where: eq(households.id, data.householdId) }),
    db.query.customers.findFirst({ where: eq(customers.id, data.customerId) }),
  ]);
  if (!household) throw new DomainError("Household not found");
  if (!customer) throw new DomainError("Client not found");
  if (customer.householdId && customer.householdId !== data.householdId) {
    throw new DomainError(
      "That client already belongs to another household. Remove them from it first.",
    );
  }

  return db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({
        householdId: data.householdId,
        householdRole: data.householdRole,
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(customers.id, data.customerId));

    await logActivity(
      {
        actor,
        entityType: "household",
        entityId: data.householdId,
        action: "linked",
        customerId: data.customerId,
        householdId: data.householdId,
        summary: `${customer.firstName} ${customer.lastName ?? ""} linked to ${household.ref}`.trim(),
      },
      tx,
    );
  });
}

export async function removeHouseholdMember(
  householdId: string,
  customerId: string,
) {
  const actor = await requireCapability("household.manage");

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
  });
  if (!customer || customer.householdId !== householdId) {
    throw new DomainError("That client is not part of this household");
  }

  return db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({
        householdId: null,
        householdRole: null,
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(customers.id, customerId));

    await tx
      .update(households)
      .set({ primaryCustomerId: null })
      .where(
        and(
          eq(households.id, householdId),
          eq(households.primaryCustomerId, customerId),
        ),
      );

    await logActivity(
      {
        actor,
        entityType: "household",
        entityId: householdId,
        action: "unlinked",
        customerId,
        householdId,
        summary: `${customer.firstName} ${customer.lastName ?? ""} removed from household`.trim(),
      },
      tx,
    );
  });
}

export async function countHouseholds() {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(households)
    .where(isNull(households.archivedAt));
  return row.count;
}
