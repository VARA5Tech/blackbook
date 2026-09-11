import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityLog,
  clientDirectives,
  customerPreferenceProfile,
  customerPreferences,
  customers,
  households,
  interactions,
  milestones,
  preferenceOptions,
  users,
} from "@/db/schema";
import type { ClientSearchQuery } from "@/domain/customers";
import { digitsOnly } from "@/domain/shared";

/**
 * Turns user input into a prefix tsquery: "rish sha" becomes "rish:* & sha:*".
 *
 * Punctuation is escaped, not removed. Stripping it looked safer but silently
 * broke the full-text path for any name containing an apostrophe or a hyphen:
 * Postgres indexes "O'Brien" as the tokens o and brien, so a search stripped to
 * "OBrien" matched nothing and the result came back only from the fuzzy
 * trigram clause, unranked. Escaping preserves the token boundaries Postgres
 * actually used. This follows the approach taken by Twenty CRM.
 *
 * Control characters are removed first. They are never part of a name, and a
 * NUL byte is rejected by the driver before Postgres even sees the query.
 */
function toPrefixTsQuery(input: string): string | null {
  const terms = input
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/[\p{Cc}\p{Cf}]/gu, ""))
    .map((term) => term.replace(/[\\:'&|!()<>*@]/g, "\\$&"))
    .filter((term) => term.length > 0)
    .map((term) => `${term}:*`);

  return terms.length > 0 ? terms.join(" & ") : null;
}

const SIMILARITY_FLOOR = 0.25;

function searchPredicate(q: string) {
  const tsQuery = toPrefixTsQuery(q);
  const digits = digitsOnly(q);
  const like = `%${q.toLowerCase()}%`;

  const clauses = [
    // Reference lookup: "CUST-00125", or just "125".
    sql`lower(${customers.ref}) like ${like}`,
    // Fuzzy name match, tolerant of spelling.
    sql`greatest(
      similarity(coalesce(${customers.firstName}, ''), ${q}),
      similarity(coalesce(${customers.lastName}, ''), ${q}),
      similarity(coalesce(${customers.preferredName}, ''), ${q})
    ) > ${SIMILARITY_FLOOR}`,
  ];

  if (tsQuery) {
    clauses.push(sql`search_document @@ to_tsquery('simple', ${tsQuery})`);
  }
  if (digits && digits.length >= 3) {
    clauses.push(sql`${customers.mobileNormalized} like ${`%${digits}%`}`);
    clauses.push(sql`${customers.whatsappNormalized} like ${`%${digits}%`}`);
  }

  return or(...clauses)!;
}

function rankExpression(q: string | undefined) {
  if (!q) return sql<number>`0`;
  const tsQuery = toPrefixTsQuery(q);
  const tsRank = tsQuery
    ? sql<number>`ts_rank(search_document, to_tsquery('simple', ${tsQuery}))`
    : sql<number>`0`;

  return sql<number>`(
    ${tsRank} * 4
    + greatest(
        similarity(coalesce(${customers.firstName}, ''), ${q}),
        similarity(coalesce(${customers.lastName}, ''), ${q}),
        similarity(coalesce(${customers.preferredName}, ''), ${q})
      )
  )`;
}

/** Requires the client to hold a given stance on every listed option. */
function preferenceFilter(
  optionIds: string[],
  polarity: "prefer" | "wishlist" | "avoid",
) {
  const ids = sql.join(
    optionIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  return sql`(
    select count(distinct cp.option_id)
    from customer_preference cp
    where cp.customer_id = ${customers.id}
      and cp.polarity = ${polarity}
      and cp.option_id in (${ids})
  ) = ${optionIds.length}`;
}

export type ClientSearchRow = {
  id: string;
  ref: string;
  firstName: string;
  lastName: string | null;
  preferredName: string | null;
  city: string | null;
  mobile: string | null;
  email: string | null;
  status: "active" | "inactive";
  customerSince: string;
  lastInteractionAt: Date | null;
  archivedAt: Date | null;
  householdId: string | null;
  householdName: string | null;
  householdRef: string | null;
  rmId: string | null;
  rmName: string | null;
};

export async function searchCustomers(query: ClientSearchQuery): Promise<{
  rows: ClientSearchRow[];
  total: number;
}> {
  const conditions = [];

  if (!query.includeArchived) conditions.push(isNull(customers.archivedAt));
  if (query.q) conditions.push(searchPredicate(query.q));
  if (query.status) conditions.push(eq(customers.status, query.status));
  if (query.rmId) conditions.push(eq(customers.primaryRmId, query.rmId));
  if (query.householdId)
    conditions.push(eq(customers.householdId, query.householdId));
  if (query.city)
    conditions.push(sql`lower(${customers.city}) = ${query.city.toLowerCase()}`);
  if (query.prefers.length > 0)
    conditions.push(preferenceFilter(query.prefers, "prefer"));
  if (query.avoids.length > 0)
    conditions.push(preferenceFilter(query.avoids, "avoid"));
  if (query.notContactedInDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - query.notContactedInDays);
    conditions.push(
      or(
        isNull(customers.lastInteractionAt),
        lt(customers.lastInteractionAt, cutoff),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const orderBy = (() => {
    switch (query.sort) {
      case "name":
        return [asc(customers.firstName), asc(customers.lastName)];
      case "recent":
        return [desc(customers.createdAt)];
      case "last_interaction":
        return [sql`${customers.lastInteractionAt} desc nulls last`];
      default:
        return query.q
          ? [desc(rankExpression(query.q)), asc(customers.firstName)]
          : [asc(customers.firstName), asc(customers.lastName)];
    }
  })();

  const rows = await db
    .select({
      id: customers.id,
      ref: customers.ref,
      firstName: customers.firstName,
      lastName: customers.lastName,
      preferredName: customers.preferredName,
      city: customers.city,
      mobile: customers.mobile,
      email: customers.email,
      status: customers.status,
      customerSince: customers.customerSince,
      lastInteractionAt: customers.lastInteractionAt,
      archivedAt: customers.archivedAt,
      householdId: customers.householdId,
      householdName: households.name,
      householdRef: households.ref,
      rmId: customers.primaryRmId,
      rmName: users.name,
    })
    .from(customers)
    .leftJoin(households, eq(customers.householdId, households.id))
    .leftJoin(users, eq(customers.primaryRmId, users.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(query.limit)
    .offset(query.offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customers)
    .where(where);

  return { rows: rows as ClientSearchRow[], total: count };
}

/* ------------------------------------------------------------------ */
/* Client 360                                                          */
/* ------------------------------------------------------------------ */

/** Shared with milestone-service; defined in migration 0002. */
const MILESTONE_NEXT_OCCURRENCE = sql<string>`vara5_next_occurrence(${milestones.monthOfYear}, ${milestones.dayOfMonth}, current_date)`;
const MILESTONE_DAYS_UNTIL = sql<number>`vara5_days_until(${milestones.monthOfYear}, ${milestones.dayOfMonth}, current_date)`;

export async function findCustomerById(id: string) {
  return db.query.customers.findFirst({ where: eq(customers.id, id) });
}

export async function findCustomerByRef(ref: string) {
  return db.query.customers.findFirst({
    where: sql`upper(${customers.ref}) = ${ref.toUpperCase()}`,
  });
}

/** Every piece of a client's record, in the shape the Client 360 screen needs. */
export async function loadClient360(customerId: string) {
  const customer = await db
    .select({
      customer: customers,
      household: households,
      rm: { id: users.id, name: users.name, email: users.email },
    })
    .from(customers)
    .leftJoin(households, eq(customers.householdId, households.id))
    .leftJoin(users, eq(customers.primaryRmId, users.id))
    .where(eq(customers.id, customerId))
    .limit(1);

  if (customer.length === 0) return null;
  const record = customer[0];

  const [
    directives,
    preferences,
    profile,
    householdMembers,
    clientMilestones,
    recentInteractions,
    timeline,
  ] = await Promise.all([
    db
      .select()
      .from(clientDirectives)
      .where(eq(clientDirectives.customerId, customerId))
      .orderBy(asc(clientDirectives.kind), asc(clientDirectives.sortOrder)),

    db
      .select({
        id: customerPreferences.id,
        polarity: customerPreferences.polarity,
        note: customerPreferences.note,
        rank: customerPreferences.rank,
        optionId: preferenceOptions.id,
        kind: preferenceOptions.kind,
        label: preferenceOptions.label,
        grouping: preferenceOptions.grouping,
      })
      .from(customerPreferences)
      .innerJoin(
        preferenceOptions,
        eq(customerPreferences.optionId, preferenceOptions.id),
      )
      .where(eq(customerPreferences.customerId, customerId))
      .orderBy(asc(customerPreferences.rank), asc(preferenceOptions.label)),

    db.query.customerPreferenceProfile.findFirst({
      where: eq(customerPreferenceProfile.customerId, customerId),
    }),

    record.household
      ? db
          .select({
            id: customers.id,
            ref: customers.ref,
            firstName: customers.firstName,
            lastName: customers.lastName,
            preferredName: customers.preferredName,
            householdRole: customers.householdRole,
            dateOfBirth: customers.dateOfBirth,
            status: customers.status,
          })
          .from(customers)
          .where(
            and(
              eq(customers.householdId, record.household.id),
              isNull(customers.archivedAt),
            ),
          )
          .orderBy(asc(customers.householdRole), asc(customers.firstName))
      : Promise.resolve([]),

    /**
     * Ordered by how soon the date actually falls, not by calendar month, so
     * the first row is the one the concierge team needs to act on next.
     */
    db
      .select({
        id: milestones.id,
        customerId: milestones.customerId,
        householdId: milestones.householdId,
        type: milestones.type,
        title: milestones.title,
        date: milestones.date,
        recursAnnually: milestones.recursAnnually,
        celebrationStyle: milestones.celebrationStyle,
        notes: milestones.notes,
        nextOccurrence: MILESTONE_NEXT_OCCURRENCE,
        daysUntil: MILESTONE_DAYS_UNTIL,
      })
      .from(milestones)
      .where(
        and(
          record.household
            ? or(
                eq(milestones.customerId, customerId),
                eq(milestones.householdId, record.household.id),
              )!
            : eq(milestones.customerId, customerId),
          eq(milestones.status, "active"),
        ),
      )
      .orderBy(asc(MILESTONE_DAYS_UNTIL)),

    db
      .select({
        id: interactions.id,
        type: interactions.type,
        occurredAt: interactions.occurredAt,
        summary: interactions.summary,
        details: interactions.details,
        loggedByName: users.name,
      })
      .from(interactions)
      .leftJoin(users, eq(interactions.loggedBy, users.id))
      .where(eq(interactions.customerId, customerId))
      .orderBy(desc(interactions.occurredAt))
      .limit(20),

    db
      .select({
        id: activityLog.id,
        action: activityLog.action,
        entityType: activityLog.entityType,
        summary: activityLog.summary,
        changes: activityLog.changes,
        createdAt: activityLog.createdAt,
        actorName: users.name,
      })
      .from(activityLog)
      .leftJoin(users, eq(activityLog.actorId, users.id))
      .where(eq(activityLog.customerId, customerId))
      .orderBy(desc(activityLog.createdAt))
      .limit(50),
  ]);

  return {
    customer: record.customer,
    household: record.household,
    rm: record.rm,
    directives,
    preferences,
    profile: profile ?? null,
    householdMembers,
    milestones: clientMilestones,
    interactions: recentInteractions,
    timeline,
  };
}

export type Client360 = NonNullable<Awaited<ReturnType<typeof loadClient360>>>;

/* ------------------------------------------------------------------ */
/* Duplicate detection                                                 */
/* ------------------------------------------------------------------ */

/** Active clients already holding this phone number. */
export async function findActiveByPhone(phone: string, excludeId?: string) {
  const digits = digitsOnly(phone);
  if (!digits) return [];

  const conditions = [
    isNull(customers.archivedAt),
    or(
      eq(customers.mobileNormalized, digits),
      eq(customers.whatsappNormalized, digits),
    )!,
  ];
  if (excludeId) conditions.push(sql`${customers.id} <> ${excludeId}`);

  return db
    .select({
      id: customers.id,
      ref: customers.ref,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(customers)
    .where(and(...conditions));
}

export async function listByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(customers).where(inArray(customers.id, ids));
}

/* ------------------------------------------------------------------ */
/* Dashboard reads                                                     */
/* ------------------------------------------------------------------ */

/** Clients whose profile is missing the fields ops relies on most. */
export async function countIncompleteProfiles() {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customers)
    .where(
      and(
        isNull(customers.archivedAt),
        eq(customers.status, "active"),
        sql`(
          ${customers.mobile} is null
          or ${customers.email} is null
          or ${customers.clientDna} is null
          or not exists (
            select 1 from customer_preference cp where cp.customer_id = ${customers.id}
          )
        )`,
      ),
    );
  return row.count;
}

export async function countNeedingFollowUp(days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customers)
    .where(
      and(
        isNull(customers.archivedAt),
        eq(customers.status, "active"),
        or(
          isNull(customers.lastInteractionAt),
          lt(customers.lastInteractionAt, cutoff),
        )!,
      ),
    );
  return row.count;
}

export async function recentlyViewedClients(limit = 6) {
  return db
    .select({
      id: customers.id,
      ref: customers.ref,
      firstName: customers.firstName,
      lastName: customers.lastName,
      preferredName: customers.preferredName,
      city: customers.city,
      updatedAt: customers.updatedAt,
    })
    .from(customers)
    .where(isNull(customers.archivedAt))
    .orderBy(desc(customers.updatedAt))
    .limit(limit);
}
