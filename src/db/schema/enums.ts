import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Domain enums.
 *
 * Anything that is genuinely single-valued and stable lives here.
 * Anything multi-select or open-ended (destinations, airlines, cuisines, ...)
 * lives in the `preference_options` catalogue instead, so ops can extend it
 * at runtime without a migration.
 */

export const userRoleEnum = pgEnum("user_role", [
  "admin", // full access incl. user management
  "manager", // full client access, no user management
  "rm", // relationship manager: full access to own clients, read others
  "viewer", // read-only
]);

/**
 * Where a client stands with the firm, and one value that is not a client at
 * all.
 *
 * `staff` marks a record that exists so somebody at the desk can get through
 * the members' gate and check the site works. They are let in like anybody
 * else, and counted like nobody: the ops figures, the interest table and every
 * analytics screen leave them out, because their browsing is testing rather
 * than interest. A founder who genuinely books through the firm is `active`;
 * their employment lives on their `app_user` row, not here.
 */
export const clientStatusEnum = pgEnum("client_status", [
  "active",
  "inactive",
  "staff",
]);

export const genderEnum = pgEnum("gender", [
  "male",
  "female",
  "other",
  "prefer_not_to_say",
]);

export const householdTravelPatternEnum = pgEnum("household_travel_pattern", [
  "couple",
  "family",
  "multi_generational",
]);

/** Relationship of a customer to the household's primary client. */
export const householdRoleEnum = pgEnum("household_role", [
  "primary",
  "spouse",
  "partner",
  "child",
  "parent",
  "sibling",
  "other",
]);

export const milestoneTypeEnum = pgEnum("milestone_type", [
  "birthday",
  "wedding_anniversary",
  "work_anniversary",
  "religious",
  "memorial",
  "other",
]);

export const milestoneStatusEnum = pgEnum("milestone_status", [
  "active",
  "archived",
]);

export const interactionTypeEnum = pgEnum("interaction_type", [
  "call",
  "whatsapp",
  "email",
  "meeting",
  "trip",
  "note",
  "other",
]);

export const directiveKindEnum = pgEnum("directive_kind", ["do", "dont"]);

export const taskStatusEnum = pgEnum("task_status", [
  "open",
  "in_progress",
  "done",
  "cancelled",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "normal",
  "high",
]);

export const activityEntityEnum = pgEnum("activity_entity", [
  "customer",
  "household",
  "milestone",
  "interaction",
  "task",
  "preference",
]);

export const activityActionEnum = pgEnum("activity_action", [
  "created",
  "updated",
  "archived",
  "restored",
  "linked",
  "unlinked",
  "interaction_logged",
  "preference_updated",
]);

/* ---------- preference facets ---------- */

/**
 * Facet of the preference catalogue. One row in `preference_options` belongs to
 * exactly one facet, e.g. kind = 'airline', label = 'Singapore Airlines'.
 */
export const preferenceKindEnum = pgEnum("preference_kind", [
  // travel
  "destination",
  "travel_style",
  "travel_season",
  // hotels
  "hotel_brand",
  "hotel_property",
  "room_type",
  "bed_preference",
  "view_preference",
  // air
  "airline",
  "loyalty_programme",
  "seat_preference",
  "flight_timing",
  // dining
  "cuisine",
  "restaurant",
  "allergy",
  "beverage_preference",
  // lifestyle
  "interest",
  "activity",
  "luxury_brand",
]);

/**
 * How the client feels about a catalogue option.
 *  prefer   - favourite / preferred / always
 *  wishlist - wants to do, has not yet
 *  avoid    - dislikes / deal-breaker
 */
export const preferencePolarityEnum = pgEnum("preference_polarity", [
  "prefer",
  "wishlist",
  "avoid",
]);

export const travellingPartyEnum = pgEnum("travelling_party", [
  "solo",
  "couple",
  "family_young_children",
  "family_teens",
  "multi_generational",
  "friends",
  "business",
]);

export const travelFrequencyEnum = pgEnum("travel_frequency", [
  "less_than_once_a_year",
  "one_to_two_per_year",
  "three_to_four_per_year",
  "five_plus_per_year",
]);

export const budgetRangeEnum = pgEnum("budget_range", [
  "upto_5l",
  "5l_10l",
  "10l_25l",
  "25l_50l",
  "50l_plus",
  "no_ceiling",
]);

export const bookingLeadTimeEnum = pgEnum("booking_lead_time", [
  "last_minute",
  "under_1_month",
  "one_to_three_months",
  "three_to_six_months",
  "six_months_plus",
]);

export const cabinClassEnum = pgEnum("cabin_class", [
  "economy",
  "premium_economy",
  "business",
  "first",
  "private",
]);

export const directFlightPreferenceEnum = pgEnum("direct_flight_preference", [
  "always_direct",
  "prefer_direct",
  "no_preference",
]);

export const dietaryPreferenceEnum = pgEnum("dietary_preference", [
  "no_restriction",
  "vegetarian",
  "vegan",
  "jain",
  "halal",
  "kosher",
  "pescatarian",
  "gluten_free",
  "other",
]);

export const fineDiningPreferenceEnum = pgEnum("fine_dining_preference", [
  "essential",
  "enjoys",
  "occasional",
  "prefers_casual",
]);

export const experienceStyleEnum = pgEnum("experience_style", [
  "private_bespoke",
  "small_group",
  "exclusive_access",
  "off_the_beaten_path",
  "classic_highlights",
  "relaxed_unstructured",
]);

/**
 * What a client did with a journey on vara5.com. Reported by the website
 * through the signed private-access channel, never entered by staff.
 */
export const interestKindEnum = pgEnum("interest_kind", [
  "opened",
  "read",
  "photos",
  "video",
  "cta_clicked",
]);
