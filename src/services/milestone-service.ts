import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { requireCapability } from "@/auth/session";
import { db } from "@/db";
import { customers, households, milestones } from "@/db/schema";
import {
  createMilestoneSchema,
  updateMilestoneSchema,
  type CreateMilestoneInput,
  type UpdateMilestoneInput,
} from "@/domain/milestones";
import { diffFields, logActivity } from "./activity-service";
import { DomainError } from "./client-service";

/**
 * Days until the next occurrence, computed in Postgres so ordering and
 * filtering happen in the same indexed pass. See migration 0002.
 */
const daysUntil = sql<number>`vara5_days_until(${milestones.monthOfYear}, ${milestones.dayOfMonth}, current_date)`;
const nextOccurrence = sql<string>`vara5_next_occurrence(${milestones.monthOfYear}, ${milestones.dayOfMonth}, current_date)`;

export type UpcomingMilestone = {
  id: string;
  type: (typeof milestones.$inferSelect)["type"];
  title: string;
  date: string;
  nextOccurrence: string;
  daysUntil: number;
  celebrationStyle: string | null;
  notes: string | null;
  customerId: string | null;
  customerName: string | null;
  customerRef: string | null;
  householdId: string | null;
  householdName: string | null;
  householdRef: string | null;
};

/**
 * Milestone reminders for the operations dashboard.
 *
 * Sunday scope is surfacing what is coming up. The shape here is deliberately
 * the same one a future notification job would consume.
 */
export async function getUpcomingMilestones(withinDays = 45, limit = 50) {
  await requireCapability("client.read");

  const rows = await db
    .select({
      id: milestones.id,
      type: milestones.type,
      title: milestones.title,
      date: milestones.date,
      nextOccurrence,
      daysUntil,
      celebrationStyle: milestones.celebrationStyle,
      notes: milestones.notes,
      customerId: milestones.customerId,
      customerName: sql<string | null>`coalesce(
        ${customers.preferredName},
        trim(${customers.firstName} || ' ' || coalesce(${customers.lastName}, ''))
      )`,
      customerRef: customers.ref,
      householdId: milestones.householdId,
      householdName: households.name,
      householdRef: households.ref,
    })
    .from(milestones)
    .leftJoin(customers, eq(milestones.customerId, customers.id))
    .leftJoin(households, eq(milestones.householdId, households.id))
    .where(
      and(
        eq(milestones.status, "active"),
        sql`${daysUntil} between 0 and ${withinDays}`,
        // Archived clients should not generate concierge reminders.
        sql`(${customers.id} is null or ${customers.archivedAt} is null)`,
        sql`(${households.id} is null or ${households.archivedAt} is null)`,
      ),
    )
    .orderBy(asc(daysUntil))
    .limit(limit);

  return rows as UpcomingMilestone[];
}

export async function countUpcoming(withinDays: number, type?: string) {
  const conditions = [
    eq(milestones.status, "active"),
    sql`${daysUntil} between 0 and ${withinDays}`,
  ];
  if (type) conditions.push(sql`${milestones.type} = ${type}`);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(milestones)
    .where(and(...conditions));
  return row.count;
}

export async function listMilestonesForCustomer(customerId: string) {
  await requireCapability("client.read");
  return db
    .select({
      id: milestones.id,
      type: milestones.type,
      title: milestones.title,
      date: milestones.date,
      nextOccurrence,
      daysUntil,
      recursAnnually: milestones.recursAnnually,
      celebrationStyle: milestones.celebrationStyle,
      notes: milestones.notes,
      status: milestones.status,
    })
    .from(milestones)
    .where(
      and(eq(milestones.customerId, customerId), eq(milestones.status, "active")),
    )
    .orderBy(asc(daysUntil));
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createMilestone(input: CreateMilestoneInput) {
  const actor = await requireCapability("milestone.manage");
  const data = createMilestoneSchema.parse(input);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(milestones)
      .values({ ...data, createdBy: actor.id })
      .returning();

    await logActivity(
      {
        actor,
        entityType: "milestone",
        entityId: created.id,
        action: "created",
        customerId: created.customerId,
        householdId: created.householdId,
        summary: `Milestone added: ${created.title}`,
      },
      tx,
    );

    return created;
  });
}

export async function updateMilestone(input: UpdateMilestoneInput) {
  const actor = await requireCapability("milestone.manage");
  const data = updateMilestoneSchema.parse(input);
  const { id, ...patch } = data;

  const existing = await db.query.milestones.findFirst({
    where: eq(milestones.id, id),
  });
  if (!existing) throw new DomainError("Milestone not found");

  const changes = diffFields(existing, patch);
  if (Object.keys(changes).length === 0) return existing;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(milestones)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(milestones.id, id))
      .returning();

    await logActivity(
      {
        actor,
        entityType: "milestone",
        entityId: id,
        action: patch.status === "archived" ? "archived" : "updated",
        customerId: updated.customerId,
        householdId: updated.householdId,
        summary:
          patch.status === "archived"
            ? `Milestone removed: ${updated.title}`
            : `Milestone updated: ${updated.title}`,
        changes,
      },
      tx,
    );

    return updated;
  });
}

export async function archiveMilestone(id: string) {
  return updateMilestone({ id, status: "archived" });
}
