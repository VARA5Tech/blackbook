import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, type Database } from "@/db";
import { activityLog, users } from "@/db/schema";
import type { Actor } from "@/auth/session";
import { FIELD_LABELS } from "@/domain/engagement";

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
