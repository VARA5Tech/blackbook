import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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

/*
 * `search_document` is qualified with its table in both helpers below.
 *
 * The grouped clients list joins `customer` to itself under an alias to find
 * each household's primary, and both copies have that column. Left bare, the
 * reference is ambiguous and Postgres refuses the whole query.
 */

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

  // The document also carries the client's executive assistant's name and email.
  if (tsQuery) {
    clauses.push(sql`${customers}.search_document @@ to_tsquery('simple', ${tsQuery})`);
  }
  const hasDigits = Boolean(digits && digits.length >= 3);
  if (hasDigits) {
    clauses.push(sql`${customers.mobileNormalized} like ${`%${digits}%`}`);
    clauses.push(sql`${customers.whatsappNormalized} like ${`%${digits}%`}`);
    clauses.push(sql`${customers.eaPhoneNormalized} like ${`%${digits}%`}`);
  }

  /*
   * The household's executive assistant, who often calls on the family's
   * behalf. Every member of that household is found by them. The subquery sits
   * in WHERE, where Drizzle qualifies the outer column.
   */
  clauses.push(sql`exists (
    select 1 from household ea_household
    where ea_household.id = ${customers.householdId}
      and (
        lower(coalesce(ea_household.ea_name, '')) like ${like}
        or lower(coalesce(ea_household.ea_email, '')) like ${like}
        ${hasDigits ? sql`or ea_household.ea_phone_normalized like ${`%${digits}%`}` : sql``}
      )
  )`);

  return or(...clauses)!;
}

function rankExpression(q: string | undefined) {
  if (!q) return sql<number>`0`;
  const tsQuery = toPrefixTsQuery(q);
  const tsRank = tsQuery
    ? sql<number>`ts_rank(${customers}.search_document, to_tsquery('simple', ${tsQuery}))`
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

/** The filters behind the clients list, shared by the flat and grouped searches. */
function searchConditions(query: ClientSearchQuery) {
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

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function searchCustomers(query: ClientSearchQuery): Promise<{
  rows: ClientSearchRow[];
  total: number;
}> {
  const where = searchConditions(query);

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

export type ClientGroupMember = ClientSearchRow & {
  householdRole: (typeof customers.$inferSelect)["householdRole"];
};

export type ClientGroup = {
  /** The household's id, or the client's own id when they have no household. */
  key: string;
  household: { id: string; name: string; ref: string } | null;
  /** The household's primary client, or the client themselves when solo. */
  lead: ClientGroupMember;
  /**
   * Whether the lead is the household's designated primary, as opposed to the
   * first member by name standing in because nobody has been designated.
   */
  leadIsPrimary: boolean;
  /**
   * Whether the lead matched the search and filters.
   *
   * A household is always listed under its primary, so when a search finds
   * only another member the primary still leads the group, for context.
   */
  leadMatched: boolean;
  /** The household's other members who matched, in name order. */
  members: ClientGroupMember[];
};

/**
 * The clients list, one entry per household rather than one per person.
 *
 * Pagination counts groups, not people. Paging by person would cut a family in
 * half at a page boundary, with the primary on one page and their children on
 * the next.
 *
 * Every person here is still a client row, which is what lets each family
 * member carry their own preferences, milestones and history. Grouping is how
 * they are listed, not how they are stored.
 */
export async function searchClientGroups(query: ClientSearchQuery): Promise<{
  groups: ClientGroup[];
  totalGroups: number;
  totalHouseholds: number;
  totalClients: number;
}> {
  const where = searchConditions(query);
  const groupKey = sql<string>`coalesce(${customers.householdId}, ${customers.id})`;

  /**
   * The name a group sorts under: the one shown on its lead row.
   *
   * The household's primary pointer wins, then a member whose role is primary,
   * then the alphabetically first member. The joined primary is the same row for
   * every member of a group, so max() only reads it inside the aggregate.
   */
  const pointedPrimary = alias(customers, "pointed_primary");
  const leadName = sql`lower(coalesce(
    max(${pointedPrimary.firstName}),
    min(case when ${customers.householdRole} = 'primary' then ${customers.firstName} end),
    min(${customers.firstName})
  ))`;

  const groupOrder = (() => {
    switch (query.sort) {
      case "recent":
        return [sql`max(${customers.createdAt}) desc`, groupKey];
      case "last_interaction":
        return [sql`max(${customers.lastInteractionAt}) desc nulls last`, groupKey];
      case "name":
        return [asc(leadName), groupKey];
      default:
        return query.q
          ? [sql`max(${rankExpression(query.q)}) desc`, asc(leadName), groupKey]
          : [asc(leadName), groupKey];
    }
  })();

  const [page, [totals]] = await Promise.all([
    db
      .select({ key: groupKey })
      .from(customers)
      .leftJoin(households, eq(customers.householdId, households.id))
      .leftJoin(pointedPrimary, eq(pointedPrimary.id, households.primaryCustomerId))
      .where(where)
      .groupBy(groupKey)
      .orderBy(...groupOrder)
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({
        groups: sql<number>`count(distinct ${groupKey})::int`,
        households: sql<number>`count(distinct ${customers.householdId})::int`,
        clients: sql<number>`count(*)::int`,
      })
      .from(customers)
      .where(where),
  ]);

  const counts = {
    totalGroups: totals.groups,
    totalHouseholds: totals.households,
    totalClients: totals.clients,
  };
  if (page.length === 0) return { groups: [], ...counts };

  const keys = page.map((group) => group.key);

  const memberColumns = {
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
    householdPrimaryId: households.primaryCustomerId,
    householdRole: customers.householdRole,
    rmId: customers.primaryRmId,
    rmName: users.name,
  };

  type Fetched = ClientGroupMember & { householdPrimaryId: string | null };

  const matched = (await db
    .select(memberColumns)
    .from(customers)
    .leftJoin(households, eq(customers.householdId, households.id))
    .leftJoin(users, eq(customers.primaryRmId, users.id))
    .where(and(inArray(groupKey, keys), where))
    .orderBy(asc(customers.firstName), asc(customers.lastName))) as Fetched[];

  /**
   * Primaries who did not match the search, fetched only to lead their group.
   *
   * A household names its primary in two ways: the explicit pointer, set from
   * the household screen, and a member whose role is primary, set when the
   * client is created. Either can be the only one present.
   */
  const matchedIds = new Set(matched.map((row) => row.id));
  const missingPointers = new Set<string>();
  const needRolePrimary = new Set<string>();

  for (const row of matched) {
    if (!row.householdId) continue;
    if (row.householdPrimaryId) {
      if (!matchedIds.has(row.householdPrimaryId)) {
        missingPointers.add(row.householdPrimaryId);
      }
    } else {
      needRolePrimary.add(row.householdId);
    }
  }
  for (const row of matched) {
    if (row.householdId && row.householdRole === "primary") {
      needRolePrimary.delete(row.householdId);
    }
  }

  const contextConditions = [];
  if (missingPointers.size > 0) {
    contextConditions.push(inArray(customers.id, [...missingPointers]));
  }
  if (needRolePrimary.size > 0) {
    contextConditions.push(
      and(
        inArray(customers.householdId, [...needRolePrimary]),
        eq(customers.householdRole, "primary"),
        isNull(customers.archivedAt),
      )!,
    );
  }

  const context =
    contextConditions.length > 0
      ? ((await db
          .select(memberColumns)
          .from(customers)
          .leftJoin(households, eq(customers.householdId, households.id))
          .leftJoin(users, eq(customers.primaryRmId, users.id))
          .where(or(...contextConditions))
          .orderBy(asc(customers.firstName))) as Fetched[])
      : [];

  const toMember = (row: Fetched): ClientGroupMember => {
    const member: Partial<Fetched> = { ...row };
    delete member.householdPrimaryId;
    return member as ClientGroupMember;
  };

  const groups = keys.map((key): ClientGroup => {
    const rows = matched.filter((row) => (row.householdId ?? row.id) === key);
    const first = rows[0];
    if (!first) {
      throw new Error(`Group ${key} was paged but has no matching members`);
    }

    if (!first.householdId) {
      return {
        key,
        household: null,
        lead: toMember(first),
        leadIsPrimary: false,
        leadMatched: true,
        members: [],
      };
    }

    const householdId = first.householdId;
    const pointer = first.householdPrimaryId;

    const lead =
      (pointer &&
        (rows.find((row) => row.id === pointer) ??
          context.find((row) => row.id === pointer))) ||
      rows.find((row) => row.householdRole === "primary") ||
      context.find(
        (row) => row.householdId === householdId && row.householdRole === "primary",
      ) ||
      first;

    return {
      key,
      household: {
        id: householdId,
        name: first.householdName ?? "",
        ref: first.householdRef ?? "",
      },
      lead: toMember(lead),
      leadIsPrimary: lead.id === pointer || lead.householdRole === "primary",
      leadMatched: rows.some((row) => row.id === lead.id),
      members: rows.filter((row) => row.id !== lead.id).map(toMember),
    };
  });

  return { groups, ...counts };
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

/* ------------------------------------------------------------------ */
/* Private access                                                      */
/* ------------------------------------------------------------------ */

/**
 * Active, unarchived clients whose mobile or WhatsApp number is exactly this
 * one, given as international digits. Two at most: one is an answer, and two is
 * a conflict the caller refuses rather than resolves.
 */
export async function findPrivateAccessGuests(digits: string) {
  return db
    .select({
      id: customers.id,
      firstName: customers.firstName,
      preferredName: customers.preferredName,
      mobileNormalized: customers.mobileNormalized,
      whatsappNormalized: customers.whatsappNormalized,
    })
    .from(customers)
    .where(
      and(
        isNull(customers.archivedAt),
        eq(customers.status, "active"),
        or(
          eq(customers.mobileNormalized, digits),
          eq(customers.whatsappNormalized, digits),
        ),
      ),
    )
    .limit(2);
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
