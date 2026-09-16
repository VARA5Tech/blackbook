import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { customers } from "./core";
import {
  bookingLeadTimeEnum,
  budgetRangeEnum,
  cabinClassEnum,
  dietaryPreferenceEnum,
  directFlightPreferenceEnum,
  experienceStyleEnum,
  fineDiningPreferenceEnum,
  preferenceKindEnum,
  preferencePolarityEnum,
  travelFrequencyEnum,
  travellingPartyEnum,
} from "./enums";

/* ------------------------------------------------------------------ */
/* Preference catalogue                                                */
/* ------------------------------------------------------------------ */

/**
 * The controlled vocabulary behind every multi-select in the requirements:
 * destinations, travel styles, hotel brands, airlines, cuisines, allergies,
 * interests, luxury brands and so on.
 *
 * Seeded from the operations document, extensible by staff at runtime
 * (isCustom = true) so a new hotel brand never needs a migration.
 */
export const preferenceOptions = pgTable(
  "preference_option",
  {
    id: uuid("id").primaryKey().default(sql`vara5_uuid_v7()`),
    kind: preferenceKindEnum("kind").notNull(),
    /** Stable machine key, unique within a kind. */
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    /** Optional grouping, e.g. destination -> "Asia", airline -> "Star Alliance". */
    grouping: text("grouping"),
    /** True when a staff member added it, false for seeded catalogue entries. */
    isCustom: boolean("is_custom").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("preference_option_kind_slug_unique").on(t.kind, t.slug),
    index("preference_option_kind_idx").on(t.kind, t.sortOrder),
    index("preference_option_label_idx").on(t.label),
  ],
);

/**
 * A client's stance on one catalogue option.
 *
 * Polarity collapses what the requirements document lists as separate fields.
 * "Favourite Destinations", "Wishlist Destinations" and "Destinations to Avoid"
 * are the same relation at three polarities, which makes a query like
 * "likes Safari but avoids large resorts" a single indexed join.
 */
export const customerPreferences = pgTable(
  "customer_preference",
  {
    id: uuid("id").primaryKey().default(sql`vara5_uuid_v7()`),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    optionId: uuid("option_id")
      .notNull()
      .references(() => preferenceOptions.id, { onDelete: "cascade" }),
    polarity: preferencePolarityEnum("polarity").notNull().default("prefer"),
    /** Free-text qualifier, e.g. "Aman - always a suite" or "mild allergy". */
    note: text("note"),
    /**
     * A membership held rather than a taste: the client's own number and tier
     * in a loyalty programme, so "Bonvoy 1234, Titanium" is two fields staff can
     * read back and search rather than a sentence in the note.
     *
     * They sit on this row because a client holds many memberships, one per
     * programme, which is exactly the shape this table already has.
     */
    membershipNumber: text("membership_number"),
    membershipTier: text("membership_tier"),
    /** Lower sorts first. Lets ops rank top destinations. */
    rank: integer("rank").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("customer_preference_unique").on(
      t.customerId,
      t.optionId,
      t.polarity,
    ),
    index("customer_preference_customer_idx").on(t.customerId),
    /** "Which client is Bonvoy 1234?" is a question the desk actually asks. */
    index("customer_preference_membership_idx").on(t.membershipNumber),
    /** Drives "which clients like Aman?" without scanning the client table. */
    index("customer_preference_option_idx").on(t.optionId, t.polarity),
  ],
);

/* ------------------------------------------------------------------ */
/* Scalar preference profile                                           */
/* ------------------------------------------------------------------ */

/**
 * One row per client holding every genuinely single-valued preference plus the
 * per-section free-text notes from the requirements document.
 *
 * Kept out of the customer table so identity stays narrow, and kept as one
 * table rather than five so Client 360 needs one join, not five.
 */
export const customerPreferenceProfile = pgTable(
  "customer_preference_profile",
  {
    customerId: uuid("customer_id")
      .primaryKey()
      .references(() => customers.id, { onDelete: "cascade" }),

    /* travel behaviour */
    travelTypicalTripNights: integer("travel_typical_trip_nights"),
    travelParty: travellingPartyEnum("travel_party"),
    travelFrequency: travelFrequencyEnum("travel_frequency"),
    travelBudgetRange: budgetRangeEnum("travel_budget_range"),
    travelBookingLeadTime: bookingLeadTimeEnum("travel_booking_lead_time"),
    travelNotes: text("travel_notes"),

    /* hotels */
    hotelNotes: text("hotel_notes"),

    /* flights */
    flightCabin: cabinClassEnum("flight_cabin"),
    flightDirectPreference: directFlightPreferenceEnum(
      "flight_direct_preference",
    ),
    flightNotes: text("flight_notes"),

    /* dining */
    diningDietary: dietaryPreferenceEnum("dining_dietary"),
    diningFineDining: fineDiningPreferenceEnum("dining_fine_dining"),
    diningNotes: text("dining_notes"),

    /* lifestyle */
    lifestyleExperienceStyle: experienceStyleEnum("lifestyle_experience_style"),
    lifestyleNotes: text("lifestyle_notes"),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const preferenceOptionRelations = relations(
  preferenceOptions,
  ({ many }) => ({
    customerPreferences: many(customerPreferences),
  }),
);

export const customerPreferenceRelations = relations(
  customerPreferences,
  ({ one }) => ({
    customer: one(customers, {
      fields: [customerPreferences.customerId],
      references: [customers.id],
    }),
    option: one(preferenceOptions, {
      fields: [customerPreferences.optionId],
      references: [preferenceOptions.id],
    }),
  }),
);

export const customerPreferenceProfileRelations = relations(
  customerPreferenceProfile,
  ({ one }) => ({
    customer: one(customers, {
      fields: [customerPreferenceProfile.customerId],
      references: [customers.id],
    }),
  }),
);

export type PreferenceOption = typeof preferenceOptions.$inferSelect;
export type CustomerPreference = typeof customerPreferences.$inferSelect;
export type CustomerPreferenceProfile =
  typeof customerPreferenceProfile.$inferSelect;
