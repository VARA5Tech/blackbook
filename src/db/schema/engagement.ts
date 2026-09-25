import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { customers, households } from "./core";
import {
  activityActionEnum,
  activityEntityEnum,
  interactionTypeEnum,
  interestKindEnum,
  leadSourceEnum,
  leadStatusEnum,
  milestoneStatusEnum,
  milestoneTypeEnum,
  taskPriorityEnum,
  taskStatusEnum,
  tripStatusEnum,
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
    id: uuid("id").primaryKey().default(sql`vara5_uuid_v7()`),
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
    id: uuid("id").primaryKey().default(sql`vara5_uuid_v7()`),
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
    id: uuid("id").primaryKey().default(sql`vara5_uuid_v7()`),
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
    /**
     * The lead this was raised for, when it was.
     *
     * On the task rather than a `task_id` on the lead, because one lead is
     * worked through many tasks — call them, send options, chase the deposit,
     * confirm the flights — and a single column could only ever hold the
     * first. Null for the ordinary chores that belong to no lead.
     */
    leadId: uuid("lead_id").references((): AnyPgColumn => leads.id, {
      onDelete: "cascade",
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
    index("task_lead_idx").on(t.leadId),
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
    id: uuid("id").primaryKey().default(sql`vara5_uuid_v7()`),

    entityType: activityEntityEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: activityActionEnum("action").notNull(),

    /**
     * Denormalised so a client timeline is one indexed read.
     *
     * SET NULL, not CASCADE: erasing a client clears the reference, so the
     * client row is destroyed while the record that something happened
     * survives.
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

/* ------------------------------------------------------------------ */
/* Interest from vara5.com                                          */
/* ------------------------------------------------------------------ */

/**
 * What a client looked at on the members' site, one row per action.
 *
 * Written only by the website, through the signed private-access channel, so
 * there is no capability check anywhere near it and no staff member can type
 * one. It is the raw material for the Interest panel on Client 360: which
 * journeys a client keeps returning to, how long they read, and whether they
 * asked the Curator.
 *
 * Kept as rows rather than a running total per destination, because "opened
 * four times over three weeks" and "opened four times in one evening" are
 * different clients, and only rows can tell them apart. Erasing a client takes
 * their interest with them.
 */
export const clientInterests = pgTable(
  "client_interest",
  {
    id: uuid("id").primaryKey().default(sql`vara5_uuid_v7()`),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),

    /** The journey's slug on the website, stable across title edits. */
    destination: text("destination").notNull(),
    /** Its title as the client saw it, so the panel reads the same later. */
    title: text("title").notNull(),
    kind: interestKindEnum("kind").notNull(),
    /** Seconds spent, where the action has a duration. Zero otherwise. */
    seconds: integer("seconds").notNull().default(0),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("client_interest_customer_idx").on(t.customerId, t.occurredAt),
    index("client_interest_destination_idx").on(t.destination, t.occurredAt),
    check(
      "client_interest_seconds_sane",
      sql`seconds >= 0 and seconds <= 86400`,
    ),
  ],
).enableRLS();

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

export const clientInterestRelations = relations(clientInterests, ({ one }) => ({
  customer: one(customers, {
    fields: [clientInterests.customerId],
    references: [customers.id],
  }),
}));

export type ClientInterest = typeof clientInterests.$inferSelect;

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */

/**
 * A client put their hand up, and somebody owes them an answer.
 *
 * Its own table rather than a task, because the two answer different
 * questions. A task is a piece of work and is finished or it is not; a lead is
 * a commercial state that outlives any single piece of work — one Courchevel
 * ask becomes a call, a set of options, a deposit chase and a flight
 * confirmation, and sits in `planning` while all four open and close. Folding
 * them together would also put "Confirm a date of birth" in the denominator of
 * every conversion figure.
 *
 * Kept deliberately narrow, and joined to what already exists: the ask stays
 * in `client_interest`, the work stays in `task`, the proof that somebody made
 * contact stays in `interaction`, and every transition is written to
 * `activity_log` like any other change to a client.
 */
export const leads = pgTable(
  "lead",
  {
    id: uuid("id").primaryKey().default(sql`vara5_uuid_v7()`),

    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),

    /**
     * The ask this came from. Nullable because a lead may later be raised by
     * hand for a client who telephoned, and because an interest row can be
     * erased with the client while the lead is still being reported on.
     */
    interestId: uuid("interest_id").references(() => clientInterests.id, {
      onDelete: "set null",
    }),

    /** What they asked about, copied so the lead still reads on its own. */
    destination: text("destination").notNull(),
    title: text("title").notNull(),

    status: leadStatusEnum("status").notNull().default("new"),

    /** How it reached the desk. The website reports itself; the rest is typed. */
    source: leadSourceEnum("source").notNull().default("website"),

    /**
     * The curator who owes the answer. Null means nobody does, which is the
     * state that escalates immediately rather than waiting out the window: a
     * clock nobody owns runs out with nothing happening.
     */
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    assignedBy: text("assigned_by").references(() => users.id, {
      onDelete: "set null",
    }),

    /** When the answer is late. Two days from the ask unless reassigned. */
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),

    /**
     * Set the moment anybody logs an interaction against the client after the
     * ask, as well as by the explicit button. Contact that happened on
     * WhatsApp and was written down afterwards still counts, which is the
     * only reading of the data that matches how the desk works.
     */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by").references(() => users.id, {
      onDelete: "set null",
    }),

    /**
     * How far the chasing has gone: 0 nobody told, 1 the curator and the
     * managers, 2 the administrators as well. Raised by the sweep before the
     * mail is sent, never after, so two instances cannot both send it.
     */
    escalationLevel: integer("escalation_level").notNull().default(0),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),

    outcomeNote: text("outcome_note"),
    /** Why it went nowhere. Required by the service when dropping. */
    droppedReason: text("dropped_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("lead_status_idx").on(t.status, t.dueAt),
    index("lead_assignee_idx").on(t.assigneeId, t.status),
    index("lead_customer_idx").on(t.customerId),
    /**
     * One open lead per client per destination.
     *
     * A client who opens Courchevel twice in an afternoon wants one answer,
     * not two, and a queue holding the same intention twice is a queue people
     * stop trusting. A closed lead does not block a fresh one later.
     */
    uniqueIndex("lead_open_per_destination_unique")
      .on(t.customerId, t.destination)
      .where(sql`status not in ('won', 'dropped')`),
  ],
).enableRLS();

export const leadRelations = relations(leads, ({ one, many }) => ({
  customer: one(customers, {
    fields: [leads.customerId],
    references: [customers.id],
  }),
  assignee: one(users, {
    fields: [leads.assigneeId],
    references: [users.id],
  }),
  tasks: many(tasks),
}));

export type Lead = typeof leads.$inferSelect;

/* ------------------------------------------------------------------ */
/* Trips                                                               */
/* ------------------------------------------------------------------ */

/**
 * One journey a client took, is taking or is planning.
 *
 * The one new table the Tern work needed, and it earns it: a trip has its own
 * status, dates, party and curator, and "who departs next week" or "who has
 * been to Japan" are questions asked across trips, not of one client.
 *
 * What hangs off a trip does not get a table. The itinerary and the travellers
 * are read for one trip, rewritten whole every time the trip is populated, and
 * ordered, which is `dos`/`donts` reasoning: they are `jsonb` on the row. The
 * GIN index on `travelers` still answers "every trip this companion was on".
 */
export const trips = pgTable(
  "trip",
  {
    id: uuid("id").primaryKey().default(sql`vara5_uuid_v7()`),

    /** The client the trip is for: Tern's primary traveller. */
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "set null",
    }),

    title: text("title").notNull(),
    status: tripStatusEnum("status").notNull().default("planning"),

    /**
     * Parsed where Tern's wording allows it, and Tern's own wording kept
     * beside them: "Multiple Date Ranges" has no single start, and a parse
     * that guessed one would be a wrong date the desk trusted.
     */
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    datesText: text("dates_text"),

    partySize: integer("party_size"),
    currency: text("currency"),
    /** Who planned it in Tern. A name, because they need not have a Blackbook account. */
    curatorName: text("curator_name"),

    /**
     * `[{ name, ternContactId, customerId, primary, email, phone, birthday }]`.
     * `customerId` is set when the traveller is also a Blackbook client, so a
     * companion's history can be found without making them a client.
     */
    travelers: jsonb("travelers").notNull().default(sql`'[]'::jsonb`),

    /**
     * `[{ day, title, location, items: [{ kind, title, time, price, airline,
     * flightNumber, from, to, texts }] }]`, in the order Tern shows it.
     */
    itinerary: jsonb("itinerary").notNull().default(sql`'[]'::jsonb`),

    /**
     * Reasons this may not be a real trip — "no_dates", "test_name",
     * "placeholder_travelers" — set on import for a person to judge. Nothing
     * is dropped on a flag: a guess that deleted a real client's trip would
     * be worse than a list somebody has to glance at.
     */
    flags: text("flags").array().notNull().default(sql`'{}'`),

    ternId: text("tern_id"),
    /** Every section of Tern's trip page, whole, for anything not mapped yet. */
    ternRaw: jsonb("tern_raw"),
    ternSyncedAt: timestamp("tern_synced_at", { withTimezone: true }),

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
    index("trip_customer_idx").on(t.customerId, t.startsOn),
    index("trip_status_idx").on(t.status, t.startsOn),
    index("trip_travelers_idx").using("gin", sql`${t.travelers} jsonb_path_ops`),
    // One Blackbook trip per Tern trip, so populating twice updates.
    uniqueIndex("trip_tern_id_unique").on(t.ternId).where(sql`tern_id is not null`),
  ],
).enableRLS();

export const tripRelations = relations(trips, ({ one }) => ({
  customer: one(customers, {
    fields: [trips.customerId],
    references: [customers.id],
  }),
  household: one(households, {
    fields: [trips.householdId],
    references: [households.id],
  }),
}));

export type Trip = typeof trips.$inferSelect;

/* ------------------------------------------------------------------ */
/* Documents                                                          */
/* ------------------------------------------------------------------ */

/**
 * A file attached to a client, or to one of their trips.
 *
 * The bytes live in object storage, not here; this row is the record of one —
 * its name, its size, where its bytes are, and who put it there. A table
 * rather than an array on the client because a document carries its own fields
 * and "which passports expire this year" or "every itinerary for this trip" are
 * real questions, and because the storage key must be unique across the book.
 *
 * `storedAt` is null until the browser's upload is confirmed: an upload URL is
 * issued and this row written first, then the row is marked stored once the
 * object is really there. A pending row whose upload was abandoned is swept.
 */
export const documents = pgTable(
  "document",
  {
    id: uuid("id").primaryKey().default(sql`vara5_uuid_v7()`),

    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** Set when the document belongs to a specific trip rather than the client at large. */
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),

    /** The object's key in the bucket. Unique so two rows cannot claim one file. */
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes"),

    /** A loose label the desk reads by: "Passport", "Itinerary", "Visa". */
    kind: text("kind"),
    /** How it arrived. Uploaded by hand, or pulled from Tern during an import. */
    source: text("source").notNull().default("upload"),

    storedAt: timestamp("stored_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("document_customer_idx").on(t.customerId, t.createdAt),
    index("document_trip_idx").on(t.tripId),
    uniqueIndex("document_storage_key_unique").on(t.storageKey),
  ],
).enableRLS();

export const documentRelations = relations(documents, ({ one }) => ({
  customer: one(customers, { fields: [documents.customerId], references: [customers.id] }),
  trip: one(trips, { fields: [documents.tripId], references: [trips.id] }),
}));

export type Document = typeof documents.$inferSelect;

export const taskLeadRelations = relations(tasks, ({ one }) => ({
  lead: one(leads, {
    fields: [tasks.leadId],
    references: [leads.id],
  }),
}));
