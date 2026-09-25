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
import { customers, type Customer } from "./core";
import { preferenceKindEnum, preferencePolarityEnum } from "./enums";

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
    /**
     * The tiers this programme actually has, in the order the programme ranks
     * them: Delta's Silver, Gold, Platinum, Diamond Medallion.
     *
     * An array on the option rather than a table of its own, because a tier is
     * a name and nothing else, it is only ever read for the one programme, and
     * it is written whole when the catalogue is refreshed. Empty for every
     * facet other than a loyalty programme, and for a programme with a single
     * undifferentiated membership.
     */
    tiers: text("tiers").array().notNull().default(sql`'{}'`),

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

export type PreferenceOption = typeof preferenceOptions.$inferSelect;
export type CustomerPreference = typeof customerPreferences.$inferSelect;
/**
 * The single-valued preferences, now columns on `customer`.
 *
 * Named separately because the editor and the Client 360 sections are built
 * around this grouping: the storage moved onto the client row, the shape the
 * screens read did not.
 */
export const PREFERENCE_PROFILE_FIELDS = [
  "travelTypicalTripNights",
  "travelParty",
  "travelFrequency",
  "travelBudgetRange",
  "travelBookingLeadTime",
  "travelNotes",
  "hotelNotes",
  "flightCabin",
  "flightDirectPreference",
  "flightNotes",
  "flightSeat",
  "flightBulkhead",
  "hotelRoomFloor",
  "hotelRoomElevator",
  "cruiseDeck",
  "cruiseCabinPosition",
  "diningDietary",
  "diningFineDining",
  "diningNotes",
  "lifestyleExperienceStyle",
  "lifestyleNotes",
  "preferencesUpdatedAt",
  "preferencesUpdatedBy",
] as const satisfies readonly (keyof Customer)[];

export type CustomerPreferenceProfile = Pick<
  Customer,
  (typeof PREFERENCE_PROFILE_FIELDS)[number]
>;
