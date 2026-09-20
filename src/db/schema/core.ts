import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  date,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import {
  bookingLeadTimeEnum,
  budgetRangeEnum,
  cabinClassEnum,
  clientStatusEnum,
  dietaryPreferenceEnum,
  directFlightPreferenceEnum,
  experienceStyleEnum,
  fineDiningPreferenceEnum,
  genderEnum,
  householdRoleEnum,
  householdTravelPatternEnum,
  travelFrequencyEnum,
  travellingPartyEnum,
} from "./enums";

/**
 * Human-facing reference IDs (VARA-482193 for a client, HH-00125 for a
 * household).
 *
 * A client's is six random digits from `vara5_member_ref()`, because it is read
 * out, printed and one day typed as a member number on vara5.com. Counting
 * up would publish how many clients Vara5 has and let anyone walk the list by
 * adding one. Uniqueness comes from the unique index, which the function
 * redraws against, never from the odds alone.
 *
 * A household's is still counted, by a database sequence so two concurrent
 * writers cannot mint the same one, and formatted by vara5_ref(), because
 * lpad() alone truncates a number wider than five digits: household 100,000
 * would have come out as HH-10000, a duplicate. Nobody outside the team sees a
 * household reference.
 *
 * Keys are separate from references and never shown to a person. They default
 * to vara5_uuid_v7(), a time-ordered UUID, so new rows append to the end of the
 * primary key index. It is a pure SQL function because production runs
 * Postgres 17, which has no built-in uuidv7(). New tables use it too.
 */
export const customerRefSeq = pgSequence("customer_ref_seq", {
  startWith: 100,
  increment: 1,
});

export const householdRefSeq = pgSequence("household_ref_seq", {
  startWith: 100,
  increment: 1,
});

/**
 * An executive assistant, on a client and on a household.
 *
 * Some clients are only ever reached through their assistant, and one assistant
 * often looks after a whole family. At most one per client and one per
 * household, so plain columns rather than a table. The phone is kept as typed
 * plus digits only, like a client's mobile, so a partial number finds it. It is
 * not unique: one assistant can serve several clients.
 *
 * A function, because each table needs its own column builders.
 */
function executiveAssistantColumns() {
  return {
    eaName: text("ea_name"),
    eaEmail: text("ea_email"),
    eaPhone: text("ea_phone"),
    eaPhoneNormalized: text("ea_phone_normalized").generatedAlwaysAs(
      sql`nullif(regexp_replace(coalesce(ea_phone, ''), '[^0-9]', '', 'g'), '')`,
    ),
    eaNotes: text("ea_notes"),
  };
}

/* ------------------------------------------------------------------ */
/* Households                                                          */
/* ------------------------------------------------------------------ */

export const households = pgTable(
  "household",
  {
    id: uuid("id").primaryKey().default(sql`vara5_uuid_v7()`),
    ref: text("ref")
      .notNull()
      .unique()
      .default(sql`vara5_ref('HH-', nextval('household_ref_seq'))`),

    name: text("name").notNull(),
    city: text("city"),

    /** Head of the household. Nullable because the household row is created first. */
    primaryCustomerId: uuid("primary_customer_id").references(
      (): AnyPgColumn => customers.id,
      { onDelete: "set null" },
    ),

    travelPattern: householdTravelPatternEnum("travel_pattern"),
    notes: text("notes"),

    ...executiveAssistantColumns(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Soft delete. Concierge data is archived, never destroyed. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("household_name_idx").on(t.name),
    index("household_city_idx").on(t.city),
    index("household_archived_idx").on(t.archivedAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export const customers = pgTable(
  "customer",
  {
    id: uuid("id").primaryKey().default(sql`vara5_uuid_v7()`),
    ref: text("ref")
      .notNull()
      .unique()
      .default(sql`vara5_member_ref()`),

    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "set null",
    }),
    /** Relationship to the household's primary client. */
    householdRole: householdRoleEnum("household_role"),

    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    preferredName: text("preferred_name"),

    mobile: text("mobile"),
    /** Digits only, for duplicate detection and partial-number search. */
    mobileNormalized: text("mobile_normalized").generatedAlwaysAs(
      sql`nullif(regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g'), '')`,
    ),
    whatsapp: text("whatsapp"),
    whatsappNormalized: text("whatsapp_normalized").generatedAlwaysAs(
      sql`nullif(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), '')`,
    ),
    email: text("email"),

    dateOfBirth: date("date_of_birth"),
    gender: genderEnum("gender"),
    /** ISO 3166-1 alpha-2. */
    nationality: text("nationality"),

    city: text("city"),
    address: text("address"),
    /** Google Maps pin, stored as the shared URL plus parsed coordinates. */
    locationUrl: text("location_url"),
    locationLat: text("location_lat"),
    locationLng: text("location_lng"),

    ...executiveAssistantColumns(),

    primaryRmId: text("primary_rm_id").references(() => users.id, {
      onDelete: "set null",
    }),
    customerSince: date("customer_since").notNull().defaultNow(),
    status: clientStatusEnum("status").notNull().default("active"),

    /** Free-text "Know Me" narrative. Hero content on the Client 360 screen. */
    clientDna: text("client_dna"),

    /**
     * Must-dos and deal-breakers, in the order the desk wrote them.
     *
     * Arrays rather than rows: they are only ever read for one client, only
     * ever written all at once, and the position in the array is the running
     * order the editor already sends. A table bought nothing for that and cost
     * a join, an enum and a sort column.
     */
    dos: text("dos").array().notNull().default(sql`'{}'`),
    donts: text("donts").array().notNull().default(sql`'{}'`),

    /**
     * Anything that fits nowhere else: a note from a call, a caution, a standing
     * arrangement. Client DNA is the narrative of who they are and the section
     * notes are about travel; this is the catch-all the desk asked for, edited
     * with the rest of the identity fields.
     */
    remarks: text("remarks"),

    /** Denormalised for dashboard follow-up queries. Maintained by the service layer. */
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
    /** Distinct from updatedAt: only bumped by meaningful profile edits. */
    profileUpdatedAt: timestamp("profile_updated_at", { withTimezone: true }),

    /* ---------------------------------------------------------------- */
    /* Preference profile                                                 */
    /* ---------------------------------------------------------------- */

    /**
     * The single-valued half of a client's preferences.
     *
     * These were a table of their own, one row per client, created eagerly so
     * that every edit could be an update rather than an upsert. A row that is
     * always present, never repeats and carries no fields of its own is a set
     * of columns; keeping it apart cost a join on the screen that reads it and
     * a second write on every save. The plural half — destinations, hotels,
     * airlines, memberships — stays in `customer_preference`, because each of
     * those rows points at a catalogue option and carries a polarity, a note
     * and a rank, and because "who avoids large resorts" is a real query.
     */
    travelTypicalTripNights: integer("travel_typical_trip_nights"),
    travelParty: travellingPartyEnum("travel_party"),
    travelFrequency: travelFrequencyEnum("travel_frequency"),
    travelBudgetRange: budgetRangeEnum("travel_budget_range"),
    travelBookingLeadTime: bookingLeadTimeEnum("travel_booking_lead_time"),
    travelNotes: text("travel_notes"),
    hotelNotes: text("hotel_notes"),
    flightCabin: cabinClassEnum("flight_cabin"),
    flightDirectPreference: directFlightPreferenceEnum(
      "flight_direct_preference",
    ),
    flightNotes: text("flight_notes"),
    diningDietary: dietaryPreferenceEnum("dining_dietary"),
    diningFineDining: fineDiningPreferenceEnum("dining_fine_dining"),
    diningNotes: text("dining_notes"),
    lifestyleExperienceStyle: experienceStyleEnum("lifestyle_experience_style"),
    lifestyleNotes: text("lifestyle_notes"),

    /**
     * Kept distinct from `profileUpdatedAt`, which also moves when the Client
     * DNA narrative is saved. On the day these merged they already disagreed
     * on 29 of 39 clients, so they are two facts, not one written twice.
     */
    preferencesUpdatedAt: timestamp("preferences_updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    preferencesUpdatedBy: text("preferences_updated_by").references(
      () => users.id,
      { onDelete: "set null" },
    ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("customer_household_idx").on(t.householdId),
    index("customer_rm_idx").on(t.primaryRmId),
    index("customer_status_idx").on(t.status),
    index("customer_archived_idx").on(t.archivedAt),
    index("customer_last_interaction_idx").on(t.lastInteractionAt),
    index("customer_mobile_normalized_idx").on(t.mobileNormalized),
    // The website's private access lookup matches either number exactly.
    index("customer_whatsapp_normalized_idx").on(t.whatsappNormalized),
    /**
     * One active client per phone number. Duplicate clients are the single
     * most expensive data problem to retrofit, so it is enforced from day one.
     */
    uniqueIndex("customer_mobile_unique_active")
      .on(t.mobileNormalized)
      .where(sql`archived_at is null and mobile_normalized is not null`),
  ],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const householdRelations = relations(households, ({ one, many }) => ({
  primaryCustomer: one(customers, {
    fields: [households.primaryCustomerId],
    references: [customers.id],
    relationName: "household_primary_customer",
  }),
  members: many(customers, { relationName: "household_members" }),
}));

export const customerRelations = relations(customers, ({ one }) => ({
  household: one(households, {
    fields: [customers.householdId],
    references: [households.id],
    relationName: "household_members",
  }),
  primaryRm: one(users, {
    fields: [customers.primaryRmId],
    references: [users.id],
  }),
}));

export type Household = typeof households.$inferSelect;
export type Customer = typeof customers.$inferSelect;
