/**
 * Pure preference vocabulary.
 *
 * Deliberately free of database imports: both client components and server
 * services read from here, so labels never drift between the two and the
 * browser bundle never pulls in the Postgres driver.
 */

export const PREFERENCE_KINDS = [
  "destination",
  "travel_style",
  "travel_season",
  "hotel_brand",
  "hotel_property",
  "room_type",
  "bed_preference",
  "view_preference",
  "airline",
  "loyalty_programme",
  "seat_preference",
  "flight_timing",
  "cuisine",
  "restaurant",
  "allergy",
  "beverage_preference",
  "interest",
  "activity",
  "luxury_brand",
] as const;

export type PreferenceKind = (typeof PREFERENCE_KINDS)[number];

export const POLARITIES = ["prefer", "wishlist", "avoid"] as const;

export type Polarity = (typeof POLARITIES)[number];

export const POLARITY_LABELS: Record<Polarity, string> = {
  prefer: "Prefers",
  wishlist: "Wishlist",
  avoid: "Avoids",
};

/**
 * Facets where a selection is a membership the client holds, not a taste. They
 * carry a membership number and a tier, and read as "Member of Bonvoy" rather
 * than "Prefers Bonvoy".
 */
export const MEMBERSHIP_KINDS: PreferenceKind[] = ["loyalty_programme"];

export function isMembershipKind(kind: string): boolean {
  return MEMBERSHIP_KINDS.includes(kind as PreferenceKind);
}

const MEMBERSHIP_POLARITY_LABELS: Record<Polarity, string> = {
  prefer: "Member of",
  wishlist: "Wants to join",
  avoid: "Avoids",
};

export function polarityLabel(kind: string, polarity: Polarity): string {
  return isMembershipKind(kind)
    ? MEMBERSHIP_POLARITY_LABELS[polarity]
    : POLARITY_LABELS[polarity];
}

/** Section headings for each facet, taken from the requirements document. */
export const KIND_LABELS: Record<PreferenceKind, string> = {
  destination: "Destinations",
  travel_style: "Travel Style",
  travel_season: "Preferred Seasons",
  hotel_brand: "Hotel Brands",
  hotel_property: "Specific Hotels",
  room_type: "Room Type",
  bed_preference: "Room and Bed Preferences",
  view_preference: "View Preference",
  airline: "Airlines",
  loyalty_programme: "Loyalty Programmes",
  seat_preference: "Seat Preference",
  flight_timing: "Flight Timing",
  cuisine: "Cuisines",
  restaurant: "Favourite Restaurants",
  allergy: "Allergies and Restrictions",
  beverage_preference: "Bar and Wine Preferences",
  interest: "Interests",
  activity: "Favourite Activities",
  luxury_brand: "Shopping and Luxury Brands",
};

export type CatalogueOption = {
  id: string;
  kind: PreferenceKind;
  label: string;
  grouping: string | null;
};

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Explicit labels for the scalar preference enums.
 *
 * Generic underscore-to-space humanising turns "25l_50l" into "25l 50l", which
 * is wrong for money and clumsy for the rest, so these are spelled out.
 */
export const SCALAR_LABELS: Record<string, string> = {
  // travelling party
  solo: "Solo",
  couple: "Couple",
  family_young_children: "Family with young children",
  family_teens: "Family with teenagers",
  multi_generational: "Multi-generational",
  friends: "Friends",
  business: "Business",

  // frequency
  less_than_once_a_year: "Less than once a year",
  one_to_two_per_year: "1 to 2 trips a year",
  three_to_four_per_year: "3 to 4 trips a year",
  five_plus_per_year: "5 or more trips a year",

  // budget, per trip, in Indian rupees
  upto_5l: "Up to ₹5 lakh",
  "5l_10l": "₹5 to ₹10 lakh",
  "10l_25l": "₹10 to ₹25 lakh",
  "25l_50l": "₹25 to ₹50 lakh",
  "50l_plus": "₹50 lakh and above",
  no_ceiling: "No fixed ceiling",

  // booking lead time
  last_minute: "Last minute",
  under_1_month: "Under a month",
  one_to_three_months: "1 to 3 months",
  three_to_six_months: "3 to 6 months",
  six_months_plus: "6 months or more",

  // cabin
  economy: "Economy",
  premium_economy: "Premium economy",
  first: "First",
  private: "Private aviation",

  // direct flights
  always_direct: "Always direct",
  prefer_direct: "Prefers direct",
  no_preference: "No preference",

  // dietary
  no_restriction: "No restriction",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  jain: "Jain",
  halal: "Halal",
  kosher: "Kosher",
  pescatarian: "Pescatarian",
  gluten_free: "Gluten free",
  other: "Other",

  // fine dining
  essential: "Essential to the trip",
  enjoys: "Enjoys it",
  occasional: "Occasionally",
  prefers_casual: "Prefers casual",

  // experience style
  private_bespoke: "Private and bespoke",
  small_group: "Small group",
  exclusive_access: "Exclusive access",
  off_the_beaten_path: "Off the beaten path",
  classic_highlights: "Classic highlights",
  relaxed_unstructured: "Relaxed and unstructured",
};

/** Falls back to sentence-casing the raw value when no explicit label exists. */
export function scalarLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return (
    SCALAR_LABELS[value] ??
    value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}
