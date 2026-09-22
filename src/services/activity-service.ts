import "server-only";
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db, type Database } from "@/db";
import { activityLog, customers, households, users } from "@/db/schema";
import { requireCapability, type Actor } from "@/auth/session";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_PERIODS,
  ACTIVITY_RECORDS,
  FIELD_LABELS,
  type ActivityAction,
  type ActivityPeriod,
  type ActivityRecord,
  type ChangeLookups,
} from "@/domain/engagement";

type Entity = (typeof activityLog.$inferInsert)["entityType"];
type Action = (typeof activityLog.$inferInsert)["action"];

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

/**
 * Compares a record before and after an edit and returns only what moved.
 *
 * Values are normalised first so that null, undefined and "" are treated as the
 * same absence, otherwise every form submission would look like a change.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  ignore: string[] = ["updatedAt", "updatedBy", "createdAt", "createdBy"],
): FieldChanges {
  const changes: FieldChanges = {};

  for (const [key, next] of Object.entries(after)) {
    if (ignore.includes(key)) continue;
    const previous = before[key as keyof T];
    if (normalise(previous) === normalise(next)) continue;
    changes[key] = { from: previous ?? null, to: next ?? null };
  }

  return changes;
}

function normalise(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export type LogInput = {
  actor: Actor;
  entityType: Entity;
  entityId: string;
  action: Action;
  summary: string;
  customerId?: string | null;
  householdId?: string | null;
  changes?: FieldChanges;
};

/**
 * Writes one audit row. Pass `tx` when the caller is inside a transaction so
 * the log and the change it describes commit or fail together.
 */
export async function logActivity(
  input: LogInput,
  tx: Database | Parameters<Parameters<Database["transaction"]>[0]>[0] = db,
) {
  const hasChanges = input.changes && Object.keys(input.changes).length > 0;

  await tx.insert(activityLog).values({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    customerId: input.customerId ?? null,
    householdId: input.householdId ?? null,
    summary: input.summary,
    changes: hasChanges ? input.changes : null,
    actorId: input.actor.id,
  });
}

export async function listRecentActivity(limit = 50) {
  return db
    .select({
      id: activityLog.id,
      action: activityLog.action,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      customerId: activityLog.customerId,
      householdId: activityLog.householdId,
      summary: activityLog.summary,
      createdAt: activityLog.createdAt,
      actorName: users.name,
    })
    .from(activityLog)
    .leftJoin(users, eq(activityLog.actorId, users.id))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
}

export type ActivityFilters = {
  q?: string;
  action?: string;
  record?: string;
  by?: string;
  period?: string;
  page?: number;
};

/** Anything unrecognised in the URL is dropped rather than trusted. */
function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Where a period starts, as SQL. "Today" is midnight in India, since that is
 * where today is for the desk, and Postgres works that out exactly rather than
 * trusting whichever timezone the server happens to run in.
 */
function periodStart(period: ActivityPeriod): SQL | null {
  if (period === "today") {
    return sql`(date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`;
  }
  if (period === "7d") return sql`now() - interval '7 days'`;
  if (period === "30d") return sql`now() - interval '30 days'`;
  return null;
}

/**
 * The activity log as a table: who did what to which record, filtered and
 * paged on the server.
 *
 * Names come back already joined, and the ids a field change can carry come
 * back as lookups, so the screen can say "Relationship manager: Aryan →
 * Sudhansu" instead of the sentence that was stored when the row was written.
 */
export async function listActivity(filters: ActivityFilters) {
  await requireCapability("client.read");

  const action = pick<ActivityAction>(filters.action, ACTIVITY_ACTIONS);
  const record = pick<ActivityRecord>(filters.record, ACTIVITY_RECORDS);
  const period = pick<ActivityPeriod>(filters.period, ACTIVITY_PERIODS) ?? "all";
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const term = filters.q?.trim().slice(0, 100);

  const conditions: SQL[] = [];
  if (action) conditions.push(eq(activityLog.action, action));
  if (record) conditions.push(eq(activityLog.entityType, record));
  if (filters.by === "website") conditions.push(isNull(activityLog.actorId));
  else if (filters.by) conditions.push(eq(activityLog.actorId, filters.by));
  const since = periodStart(period);
  if (since) conditions.push(sql`${activityLog.createdAt} >= ${since}`);
  if (term) {
    const like = `%${term.toLowerCase()}%`;
    conditions.push(sql`(
      lower(${activityLog.summary}) like ${like}
      or lower(coalesce(${users.name}, '')) like ${like}
      or lower(coalesce(${customers.firstName} || ' ' || coalesce(${customers.lastName}, ''), '')) like ${like}
      or lower(coalesce(${customers.preferredName}, '')) like ${like}
      or lower(coalesce(${customers.ref}, '')) like ${like}
      or lower(coalesce(${households.name}, '')) like ${like}
      or lower(coalesce(${households.ref}, '')) like ${like}
    )`);
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const base = () =>
    db
      .select({
        id: activityLog.id,
        createdAt: activityLog.createdAt,
        action: activityLog.action,
        entityType: activityLog.entityType,
        summary: activityLog.summary,
        changes: activityLog.changes,
        actorId: activityLog.actorId,
        actorName: users.name,
        customerId: activityLog.customerId,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        customerPreferredName: customers.preferredName,
        customerRef: customers.ref,
        householdId: activityLog.householdId,
        householdName: households.name,
        householdRef: households.ref,
      })
      .from(activityLog)
      .leftJoin(users, eq(activityLog.actorId, users.id))
      .leftJoin(customers, eq(activityLog.customerId, customers.id))
      .leftJoin(households, eq(activityLog.householdId, households.id));

  const [rows, [{ total }]] = await Promise.all([
    base()
      .where(where)
      .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
      .limit(ACTIVITY_PAGE_SIZE)
      .offset((page - 1) * ACTIVITY_PAGE_SIZE),
    db
      .select({ total: count() })
      .from(activityLog)
      .leftJoin(users, eq(activityLog.actorId, users.id))
      .leftJoin(customers, eq(activityLog.customerId, customers.id))
      .leftJoin(households, eq(activityLog.householdId, households.id))
      .where(where),
  ]);

  return { rows, total, page, pageSize: ACTIVITY_PAGE_SIZE, lookups: await changeLookups(rows) };
}

export type ActivityRow = Awaited<ReturnType<typeof listActivity>>["rows"][number];

/** Resolves every user and household id that appears inside a change. */
async function changeLookups(
  rows: { changes: Record<string, { from: unknown; to: unknown }> | null }[],
): Promise<ChangeLookups> {
  const userIds = new Set<string>();
  const householdIds = new Set<string>();
  for (const row of rows) {
    for (const [field, change] of Object.entries(row.changes ?? {})) {
      for (const value of [change.from, change.to]) {
        if (typeof value !== "string" || !value) continue;
        if (field === "householdId") householdIds.add(value);
        else if (field === "primaryRmId" || field.endsWith("By") || field === "assigneeId") userIds.add(value);
      }
    }
  }
  const [people, homes] = await Promise.all([
    userIds.size
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds]))
      : Promise.resolve([]),
    householdIds.size
      ? db
          .select({ id: households.id, name: households.name })
          .from(households)
          .where(inArray(households.id, [...householdIds]))
      : Promise.resolve([]),
  ]);
  return {
    users: Object.fromEntries(people.map((person) => [person.id, person.name])),
    households: Object.fromEntries(homes.map((home) => [home.id, home.name])),
  };
}

/** Everyone who has ever written to the log, for the "By" filter. */
export async function listActivityAuthors() {
  await requireCapability("client.read");
  return db
    .selectDistinct({ id: users.id, name: users.name })
    .from(activityLog)
    .innerJoin(users, eq(activityLog.actorId, users.id))
    .orderBy(users.name);
}

export async function listHouseholdActivity(householdId: string, limit = 50) {
  return db
    .select({
      id: activityLog.id,
      action: activityLog.action,
      entityType: activityLog.entityType,
      summary: activityLog.summary,
      createdAt: activityLog.createdAt,
      actorName: users.name,
    })
    .from(activityLog)
    .leftJoin(users, eq(activityLog.actorId, users.id))
    .where(eq(activityLog.householdId, householdId))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
}

export { FIELD_LABELS };
