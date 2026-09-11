import "server-only";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { requireCapability } from "@/auth/session";
import { db } from "@/db";
import { customers, tasks, users } from "@/db/schema";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  createTaskSchema,
  type CreateTaskInput,
  type TaskStatus,
} from "@/domain/engagement";
import { logActivity } from "./activity-service";
import { DomainError } from "./client-service";

export {
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUS_LABELS,
  createTaskSchema,
  type CreateTaskInput,
};

export async function listTasks(options?: {
  assigneeId?: string;
  includeDone?: boolean;
}) {
  await requireCapability("client.read");

  const conditions = [];
  if (options?.assigneeId)
    conditions.push(eq(tasks.assigneeId, options.assigneeId));
  if (!options?.includeDone) {
    conditions.push(
      or(eq(tasks.status, "open"), eq(tasks.status, "in_progress"))!,
    );
  }

  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      details: tasks.details,
      dueDate: tasks.dueDate,
      status: tasks.status,
      priority: tasks.priority,
      customerId: tasks.customerId,
      customerName: sql<string | null>`coalesce(
        ${customers.preferredName},
        trim(${customers.firstName} || ' ' || coalesce(${customers.lastName}, ''))
      )`,
      assigneeName: users.name,
    })
    .from(tasks)
    .leftJoin(customers, eq(tasks.customerId, customers.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt))
    .limit(200);
}

export async function createTask(input: CreateTaskInput) {
  const actor = await requireCapability("task.manage");
  const data = createTaskSchema.parse(input);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tasks)
      .values({ ...data, createdBy: actor.id })
      .returning();

    if (created.customerId) {
      await logActivity(
        {
          actor,
          entityType: "task",
          entityId: created.id,
          action: "created",
          customerId: created.customerId,
          summary: `Task created: ${created.title}`,
        },
        tx,
      );
    }

    return created;
  });
}

export async function setTaskStatus(
  id: string,
  status: TaskStatus,
) {
  const actor = await requireCapability("task.manage");

  const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  if (!existing) throw new DomainError("Task not found");

  const [updated] = await db
    .update(tasks)
    .set({
      status,
      updatedAt: new Date(),
      completedAt: status === "done" ? new Date() : null,
    })
    .where(eq(tasks.id, id))
    .returning();

  if (updated.customerId) {
    await logActivity({
      actor,
      entityType: "task",
      entityId: id,
      action: "updated",
      customerId: updated.customerId,
      summary: `Task ${TASK_STATUS_LABELS[status].toLowerCase()}: ${updated.title}`,
    });
  }

  return updated;
}

