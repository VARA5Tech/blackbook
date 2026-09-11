import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { customers, households } from "./core";
import {
  activityActionEnum,
  activityEntityEnum,
  interactionTypeEnum,
  milestoneStatusEnum,
  milestoneTypeEnum,
  taskPriorityEnum,
  taskStatusEnum,
} from "./enums";

/* ------------------------------------------------------------------ */
/* Milestones                                                          */
/* ------------------------------------------------------------------ */

/**
 * One reusable entity instead of birthday / spouseBirthday / child1Birthday
 * columns, so a client or household can carry any number of important dates.
 *
 * A milestone hangs off either a customer or a household, never both.
 */
export const milestones = pgTable(
  "milestone",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "cascade",
    }),
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "cascade",
    }),

    type: milestoneTypeEnum("type").notNull(),
    title: text("title").notNull(),
    date: date("date").notNull(),

    /** Birthdays and anniversaries repeat; a one-off trip date does not. */
    recursAnnually: boolean("recurs_annually").notNull().default(true),
    /**
     * Month and day are stored separately so "upcoming in the next 30 days"
     * is an index scan rather than a full-table date-arithmetic pass.
     */
    monthOfYear: smallint("month_of_year").generatedAlwaysAs(
      sql`extract(month from date)::smallint`,
    ),
    dayOfMonth: smallint("day_of_month").generatedAlwaysAs(
      sql`extract(day from date)::smallint`,
    ),

    celebrationStyle: text("celebration_style"),
    notes: text("notes"),
    /** Days before the date at which the ops team wants to be nudged. */
    reminderDaysBefore: integer("reminder_days_before")
      .array()
      .notNull()
      .default([30, 7, 1]),

    status: milestoneStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("milestone_customer_idx").on(t.customerId),
    index("milestone_household_idx").on(t.householdId),
    index("milestone_upcoming_idx").on(t.monthOfYear, t.dayOfMonth, t.status),
    index("milestone_type_idx").on(t.type),
    check(
      "milestone_owner_check",
      sql`(customer_id is not null) <> (household_id is not null)`,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Interactions                                                        */
/* ------------------------------------------------------------------ */

/** Every recorded touchpoint. Drives "Last Interaction" and the timeline. */
export const interactions = pgTable(
  "interaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "cascade",
    }),
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "cascade",
    }),

    type: interactionTypeEnum("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    summary: text("summary").notNull(),
    details: text("details"),

    loggedBy: text("logged_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("interaction_customer_idx").on(t.customerId, t.occurredAt),
    index("interaction_household_idx").on(t.householdId, t.occurredAt),
    check(
      "interaction_owner_check",
      sql`customer_id is not null or household_id is not null`,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

/**
 * Present in the handover navigation and definition of done but absent from the
 * operations document, so it is deliberately minimal until ops specifies more.
 */
export const tasks = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    details: text("details"),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "cascade",
    }),
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "cascade",
    }),
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dueDate: date("due_date"),
    status: taskStatusEnum("status").notNull().default("open"),
    priority: taskPriorityEnum("priority").notNull().default("normal"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("task_assignee_idx").on(t.assigneeId, t.status),
    index("task_customer_idx").on(t.customerId),
    index("task_due_idx").on(t.dueDate, t.status),
  ],
);

/* ------------------------------------------------------------------ */
/* Activity log                                                        */
/* ------------------------------------------------------------------ */

/**
 * Append-only audit trail. Nothing in the application updates or deletes rows
 * here; it is the source for both the Client 360 timeline and the
 * "who changed what" record the handover quality bar asks for.
 */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    entityType: activityEntityEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: activityActionEnum("action").notNull(),

    /**
     * Denormalised so a client timeline is one indexed read.
     *
     * SET NULL, not CASCADE: the log is append-only, so cascading would make
     * erasing a client impossible. Clearing the reference lets the client row
     * be destroyed while the record that something happened survives.
     */
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "set null",
    }),

    /** Human sentence rendered directly in the timeline. */
    summary: text("summary").notNull(),
    /** Field-level diff: { field: { from, to } }. */
    changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>(),

    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("activity_log_customer_idx").on(t.customerId, t.createdAt),
    index("activity_log_household_idx").on(t.householdId, t.createdAt),
    index("activity_log_entity_idx").on(t.entityType, t.entityId),
    index("activity_log_created_idx").on(t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const milestoneRelations = relations(milestones, ({ one }) => ({
  customer: one(customers, {
    fields: [milestones.customerId],
    references: [customers.id],
  }),
  household: one(households, {
    fields: [milestones.householdId],
    references: [households.id],
  }),
}));

export const interactionRelations = relations(interactions, ({ one }) => ({
  customer: one(customers, {
    fields: [interactions.customerId],
    references: [customers.id],
  }),
  household: one(households, {
    fields: [interactions.householdId],
    references: [households.id],
  }),
  loggedByUser: one(users, {
    fields: [interactions.loggedBy],
    references: [users.id],
  }),
}));

export const taskRelations = relations(tasks, ({ one }) => ({
  customer: one(customers, {
    fields: [tasks.customerId],
    references: [customers.id],
  }),
  assignee: one(users, {
    fields: [tasks.assigneeId],
    references: [users.id],
  }),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  actor: one(users, {
    fields: [activityLog.actorId],
    references: [users.id],
  }),
}));

export type Milestone = typeof milestones.$inferSelect;
export type Interaction = typeof interactions.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type ActivityLogEntry = typeof activityLog.$inferSelect;
