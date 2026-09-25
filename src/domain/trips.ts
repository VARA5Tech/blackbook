import { parseInternationalPhone } from "./shared";

/**
 * Trips, and how a trip or a client read from Tern becomes Blackbook's.
 *
 * Everything here is a pure function of what the Tern bridge returned: no
 * database, no network. That is deliberate. Reading Tern is the fragile part,
 * and the only way to trust it is to test each rule against the shapes Tern
 * actually sends, which is what `tests/trips.test.ts` does.
 *
 * Where Tern's wording cannot be read with certainty the rule is to keep the
 * wording and leave the field empty. A date nobody can be sure of, a phone
 * number without its country, a preference that could be two things: each is
 * kept as Tern wrote it and shown to a person, never guessed into a field the
 * desk will then trust.
 */

/* ------------------------------------------------------------ statuses */

export const TRIP_STATUSES = [
  "inbound",
  "planning",
  "booked",
  "traveling",
  "traveled",
  "cancelled",
  "archived",
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  inbound: "Enquiry",
  planning: "Planning",
  booked: "Booked",
  traveling: "Travelling",
  traveled: "Travelled",
  cancelled: "Cancelled",
  archived: "Archived",
};

/** Ahead of the client, as opposed to history. */
export const OPEN_TRIP_STATUSES: TripStatus[] = ["inbound", "planning", "booked", "traveling"];

export function tripStatusFromTern(text: string | null | undefined): TripStatus | null {
  const key = (text ?? "").trim().toLowerCase();
  return (TRIP_STATUSES as readonly string[]).includes(key) ? (key as TripStatus) : null;
}

/* ------------------------------------------------------------ dates */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const month = (word: string | undefined) => (word ? MONTHS[word.slice(0, 3).toLowerCase()] ?? null : null);
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function valid(y: number, m: number | null, d: number): boolean {
  if (!m || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Tern's trip dates, as it writes them, into a start and an end.
 *
 * Tern writes them two ways. The trips table is day-first — "17 - 26 Mar
 * 2026", "17 Dec 2026 - 8 Jan 2027" — and older trip pages were month-first —
 * "Jul 15 - 18, 2025". Both are read. Anything else, "Multiple Date Ranges"
 * above all, gives no dates: the original wording is stored beside them, so a
 * person still sees exactly what Tern said.
 */
export function parseTernDates(text: string | null | undefined): { startsOn: string | null; endsOn: string | null } {
  const none = { startsOn: null, endsOn: null };
  const t = (text ?? "").replace(/\s+/g, " ").replace(/[–—]/g, "-").trim();
  if (!t) return none;

  // 17 - 26 Mar 2026 | 29 Mar - 1 Apr 2026 | 17 Dec 2026 - 8 Jan 2027 | 17 Mar 2026
  let m = t.match(/^(\d{1,2})(?: ([A-Za-z]{3,}))?(?: (\d{4}))?(?: - (\d{1,2}) ([A-Za-z]{3,}) (\d{4}))?$/);
  if (m) {
    const [, d1, m1, y1, d2, m2, y2] = m;
    if (!d2) {
      const mo = month(m1);
      return y1 && valid(+y1, mo, +d1) ? { startsOn: iso(+y1, mo!, +d1), endsOn: iso(+y1, mo!, +d1) } : none;
    }
    const endMonth = month(m2);
    const startMonth = month(m1) ?? endMonth;
    const endYear = +y2;
    // No year on the start: the same year, unless that would put it after the end.
    let startYear = y1 ? +y1 : endYear;
    if (!y1 && startMonth && endMonth && startMonth > endMonth) startYear = endYear - 1;
    if (valid(startYear, startMonth, +d1) && valid(endYear, endMonth, +d2)) {
      return { startsOn: iso(startYear, startMonth!, +d1), endsOn: iso(endYear, endMonth!, +d2) };
    }
    return none;
  }

  // Jul 15 - 18, 2025 | Jul 30 - Aug 2, 2025 | Dec 30, 2025 - Jan 2, 2026
  m = t.match(/^([A-Za-z]{3,}) (\d{1,2})(?:, (\d{4}))? - (?:([A-Za-z]{3,}) )?(\d{1,2}), (\d{4})$/);
  if (m) {
    const [, m1, d1, y1, m2, d2, y2] = m;
    const startMonth = month(m1);
    const endMonth = month(m2) ?? startMonth;
    const endYear = +y2;
    let startYear = y1 ? +y1 : endYear;
    if (!y1 && startMonth && endMonth && startMonth > endMonth) startYear = endYear - 1;
    if (valid(startYear, startMonth, +d1) && valid(endYear, endMonth, +d2)) {
      return { startsOn: iso(startYear, startMonth!, +d1), endsOn: iso(endYear, endMonth!, +d2) };
    }
  }
  return none;
}

/** "(10 people)" or "(1 person)" into 10 or 1. */
export function partySize(text: string | null | undefined): number | null {
  const m = (text ?? "").match(/(\d+)\s*(?:people|person)/);
  return m ? Number(m[1]) : null;
}

/* ------------------------------------------------------------ itinerary */

export const ITINERARY_KINDS = [
  "flight", "hotel", "transfer", "dining", "experience", "business", "options", "information", "other",
] as const;
export type ItineraryKind = (typeof ITINERARY_KINDS)[number];

export const ITINERARY_KIND_LABELS: Record<ItineraryKind, string> = {
  flight: "Flight",
  hotel: "Stay",
  transfer: "Transfer",
  dining: "Dining",
  experience: "Experience",
  business: "Business",
  options: "Options offered",
  information: "Information",
  other: "Other",
};

/*
 * Read from the title, because that is all Tern's itinerary list shows. The
 * order matters: "Multiple Options" is Tern's proposal construct — several
 * choices, none booked — and must be caught before any word in it is read as a
 * hotel. Hotels are named by brand far more often than by the word "hotel".
 */
const KIND_RULES: [ItineraryKind, RegExp][] = [
  ["options", /multiple options/i],
  ["flight", /\bflight\b/i],
  ["hotel", /st\.? regis|oberoi|mandarin oriental|waldorf|four seasons|ritz|\baman|rosewood|peninsula|belmond|six senses|\btaj\b|leela|armani|bulgari|park hyatt|raffles|shangri|nh collection|sofitel|fairmont|kempinski|one ?& ?only|cheval blanc|principi|badrutt|the manner|le bristol|savoy|claridge|dorchester|\bhotel\b|resort|check-?in|stay at|villa|chalet|lodge|suite|palace/i],
  ["transfer", /transfer|chauffeur|\bcar\b|pick-?up|\bdrive\b|train|\brail\b|helicopter|yacht/i],
  ["dining", /dinner|lunch|breakfast|dining|restaurant|\bmeal\b|nobu|\bbar\b|caf[eé]|trattoria|brasserie/i],
  ["business", /forum|boardroom|conference|meeting|summit|tiger 21/i],
  ["experience", /\btour\b|visit|excursion|safari|cruise|\bspa\b|\bski\b|golf|hike|museum/i],
  ["information", /information|preferences|\bnotes?\b|policy|insurance|visa|passport|medical|emergency|contact/i],
];

export function itineraryKind(title: string): ItineraryKind {
  return KIND_RULES.find(([, rule]) => rule.test(title))?.[0] ?? "other";
}

const FLIGHT = /Flight from ([A-Z]{3}) to ([A-Z]{3})\s*\(([A-Z0-9]{2})\s?(\d{1,4})\)/;
const TIME = /\d{1,2}:\d{2}\s?[AP]M/i;
const MONEY = /^(?:[€$£₹]\s?[\d,]+(?:\.\d+)?|[A-Z]{3}\s?[\d,]+(?:\.\d+)?)$/;

export type ItineraryItem = {
  ternId: string | null;
  kind: ItineraryKind;
  title: string;
  time: string | null;
  price: string | null;
  airline: string | null;
  flightNumber: string | null;
  from: string | null;
  to: string | null;
  /** Every other piece of text Tern showed on the row, in order. */
  texts: string[];
};

export type ItineraryDay = {
  day: number;
  title: string | null;
  location: string | null;
  items: ItineraryItem[];
};

export function itineraryItem(texts: string[], ternId: string | null = null): ItineraryItem | null {
  const [title, ...rest] = texts;
  if (!title) return null;
  const flight = title.match(FLIGHT);
  const time = rest.find((t) => TIME.test(t)) ?? null;
  // A price of nothing is Tern's placeholder, not a price.
  const price = rest.find((t) => MONEY.test(t) && !/^[^\d]*0(?:\.0+)?$/.test(t)) ?? null;
  return {
    ternId,
    kind: itineraryKind(title),
    title,
    time,
    price,
    airline: flight?.[3] ?? null,
    flightNumber: flight ? `${flight[3]}${flight[4]}` : null,
    from: flight?.[1] ?? null,
    to: flight?.[2] ?? null,
    texts: rest.filter((t) => t !== time && t !== price),
  };
}

/* ------------------------------------------------------------ flags */

const GUEST = /^guest\s*\d+$/i;

/**
 * Reasons a trip may be a test or a placeholder rather than a real journey.
 *
 * Only reasons, never a verdict: the trip still arrives, marked, for somebody
 * to delete or keep. A rule that dropped trips would one day drop a real one.
 */
export function tripFlags(trip: {
  title: string;
  startsOn: string | null;
  datesText: string | null;
  travelers: { name: string }[];
}): string[] {
  const flags: string[] = [];
  if (!trip.startsOn && !/multiple date ranges/i.test(trip.datesText ?? "")) flags.push("no_dates");
  if (/\b(test|testing|demo|sample|dummy|dup(licate)?)\b/i.test(trip.title)) flags.push("test_name");
  const real = trip.travelers.filter((t) => !GUEST.test(t.name.trim()));
  if (real.length === 0) flags.push("placeholder_travelers");
  return flags;
}

export const TRIP_FLAG_LABELS: Record<string, string> = {
  no_dates: "No dates in Tern",
  test_name: "Named like a test",
  placeholder_travelers: "Only placeholder travellers",
};

/* ------------------------------------------------------------ people */

const HONORIFICS = /^(Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Master|Sir|Dame|Lady|Lord|Hon|Rev|H\.?E)\.?\s+/i;

/** "Mr. Arpit Goyal" into its honorific and the name that follows. */
export function splitHonorific(name: string): { prefix: string | null; name: string } {
  const m = name.match(HONORIFICS);
  return m ? { prefix: m[0].trim(), name: name.slice(m[0].length).trim() } : { prefix: null, name: name.trim() };
}

export const isPlaceholderTraveler = (name: string) => GUEST.test(name.trim());

const GENDER: Record<string, "male" | "female" | "other"> = {
  male: "male",
  female: "female",
  "non binary": "other",
  other: "other",
};

export function genderFromTern(value: unknown): "male" | "female" | "other" | null {
  return typeof value === "string" ? GENDER[value.trim().toLowerCase()] ?? null : null;
}

/* ------------------------------------------------------------ small preferences */

/**
 * Tern's six radio groups, onto Blackbook's six columns. Each is keyed by
 * the words Tern shows, so a label change in Tern shows up as an unmapped
 * value here rather than as a silently wrong one.
 */
export const TRAVEL_PREFERENCE_FIELDS = {
  flightSeat: { tern: "flight_seating", label: "Seat", values: { window: "Window", aisle: "Aisle", no_preference: "No preference" } },
  flightBulkhead: { tern: "flight_bulkhead", label: "Bulkhead", values: { yes: "Yes", no: "No", no_preference: "No preference" } },
  hotelRoomFloor: { tern: "room_floor", label: "Room floor", values: { higher: "Higher floor", lower: "Lower floor", no_preference: "No preference" } },
  hotelRoomElevator: { tern: "room_elevator", label: "Lift", values: { near: "Near the lift", far: "Away from the lift", no_preference: "No preference" } },
  cruiseDeck: { tern: "cabin_floor", label: "Cruise deck", values: { higher: "Higher deck", lower: "Lower deck", no_preference: "No preference" } },
  cruiseCabinPosition: { tern: "cabin_location", label: "Cruise cabin", values: { forward: "Forward", middle: "Middle", rear: "Rear", no_preference: "No preference" } },
} as const;

export type TravelPreferenceField = keyof typeof TRAVEL_PREFERENCE_FIELDS;

const TERN_WORDS: Record<string, string> = {
  window: "window", aisle: "aisle", "no preference": "no_preference",
  yes: "yes", no: "no",
  "higher floor": "higher", "lower floor": "lower",
  "near elevator": "near", "far from elevator": "far",
  "higher deck": "higher", "lower deck": "lower",
  forward: "forward", middle: "middle", rear: "rear",
};

/** Tern's other_travel_preferences form into Blackbook columns. Unknown words are left out. */
export function travelPreferencesFromTern(form: Record<string, unknown> | undefined): Partial<Record<TravelPreferenceField, string>> {
  const out: Partial<Record<TravelPreferenceField, string>> = {};
  if (!form) return out;
  for (const [field, spec] of Object.entries(TRAVEL_PREFERENCE_FIELDS) as [TravelPreferenceField, (typeof TRAVEL_PREFERENCE_FIELDS)[TravelPreferenceField]][]) {
    const raw = form[spec.tern];
    const value = typeof raw === "string" ? TERN_WORDS[raw.trim().toLowerCase()] : undefined;
    if (value && value in spec.values) out[field] = value;
  }
  return out;
}

/* ------------------------------------------------------------ travel documents */

export const TRAVEL_DOCUMENT_KINDS = ["passport", "known_traveler", "redress"] as const;
export type TravelDocumentKind = (typeof TRAVEL_DOCUMENT_KINDS)[number];

export const TRAVEL_DOCUMENT_LABELS: Record<TravelDocumentKind, string> = {
  passport: "Passport",
  known_traveler: "Known Traveler Number",
  redress: "Redress number",
};

/**
 * A travel document as stored on the client. `sealed` is the number, sealed;
 * `last4` is all a screen shows until someone with the capability reveals it.
 */
export type StoredTravelDocument = {
  kind: TravelDocumentKind;
  sealed: string;
  last4: string;
  nationality: string | null;
  surname: string | null;
  givenNames: string | null;
  dateOfBirth: string | null;
  placeOfBirth: string | null;
  issuingAuthority: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  sex: string | null;
  ternId: string | null;
  /**
   * Where it came from. Populating again replaces what came from Tern and
   * leaves anything entered here alone; the Tern id alone cannot say which is
   * which, because the secure numbers have none.
   */
  source: "tern" | "blackbook";
};

/** The same, before sealing: what the mapping produces from Tern. */
export type PlainTravelDocument = Omit<StoredTravelDocument, "sealed" | "last4"> & { number: string };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Tern dates in forms are ISO already; anything else is not trusted as a date. */
const isoDate = (v: unknown) => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

export function travelDocumentsFromTern(
  passports: Record<string, unknown>[] | undefined,
  travelInfo: Record<string, unknown> | undefined,
): PlainTravelDocument[] {
  const out: PlainTravelDocument[] = [];
  for (const p of passports ?? []) {
    const number = str(p.passport_number);
    if (!number) continue;
    out.push({
      kind: "passport",
      number,
      nationality: str(p.nationality),
      surname: str(p.surname),
      givenNames: str(p.given_names),
      dateOfBirth: isoDate(p.date_of_birth),
      placeOfBirth: str(p.place_of_birth),
      issuingAuthority: str(p.issuing_authority),
      issuedOn: isoDate(p.date_of_issue),
      expiresOn: isoDate(p.expiration_date),
      sex: str(p.sex),
      ternId: str(p.ternId),
      source: "tern",
    });
  }
  const blank = { nationality: null, surname: null, givenNames: null, dateOfBirth: null, placeOfBirth: null, issuingAuthority: null, issuedOn: null, sex: null, ternId: null, source: "tern" as const };
  const ktn = str(travelInfo?.known_traveler_number);
  if (ktn) out.push({ ...blank, kind: "known_traveler", number: ktn, expiresOn: isoDate(travelInfo?.known_traveler_number_expiration_date) });
  const redress = str(travelInfo?.redress_number);
  if (redress) out.push({ ...blank, kind: "redress", number: redress, expiresOn: isoDate(travelInfo?.redress_number_expiration_date) });
  return out;
}

/* ------------------------------------------------------------ contact points */

const checked = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v === true || v === "1" || v === "true");

/** Tern's emails, primary first. */
export function emailsFromTern(items: Record<string, unknown>[] | undefined): { email: string; primary: boolean; label: string | null }[] {
  return (items ?? [])
    .map((i) => ({ email: str(i.email)?.toLowerCase() ?? "", primary: checked(i.primary), label: str(i.description) }))
    .filter((e) => e.email.includes("@"))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

/**
 * Tern's phones, primary first, split by whether Blackbook can take them.
 *
 * Blackbook stores a number only with its country code, and never supplies
 * one: "65 8123 4567" is ten digits and would read as an Indian number. Tern
 * often stores "91 9910086263", the code without its plus. Those are not
 * imported; they come back as `needsCountry`, with the reading a person would
 * most likely confirm, for somebody to accept with one press.
 */
export function phonesFromTern(items: Record<string, unknown>[] | undefined): {
  phone: string;
  primary: boolean;
  label: string | null;
  needsCountry: boolean;
}[] {
  return (items ?? [])
    .map((i) => {
      const phone = str(i.phone) ?? "";
      return { phone, primary: checked(i.primary), label: str(i.description), needsCountry: !phone.trim().startsWith("+") };
    })
    .filter((p) => /\d{6,}/.test(p.phone.replace(/\D/g, "")))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

/* ------------------------------------------------------------ preference chips */

/**
 * The chips under "Activities & Interests" and "Food, Drink & Allergy
 * Preferences" on a Tern profile, read in order between their labels.
 */
/** What Tern writes where a list is empty. Not a preference. */
const TERN_PLACEHOLDERS = /^(none( at the moment)?\.?|n\/a|-+|—)$/i;

export function preferenceChipsFromTern(profile: { heading: string | null; tokens: { text: string; role: string }[] }[]): {
  interests: string[];
  foodDrink: string[];
} {
  const out = { interests: [] as string[], foodDrink: [] as string[] };
  const section = profile.find((s) => s.heading === "Preferences");
  if (!section) return out;
  let bucket: string[] | null = null;
  for (const token of section.tokens) {
    if (token.text === "Activities & Interests") bucket = out.interests;
    else if (token.text === "Food, Drink & Allergy Preferences") bucket = out.foodDrink;
    else if (token.text === "Other Travel Preferences") bucket = null;
    else if (bucket && token.role === "value" && !TERN_PLACEHOLDERS.test(token.text)) bucket.push(token.text);
  }
  return out;
}

/**
 * Which Blackbook facet a Tern food-and-drink chip belongs to.
 *
 * Tern keeps food, drink and allergies as one list. Blackbook separates them,
 * because an allergy filed as a cuisine is the one mistake here that can hurt
 * somebody. So the rule errs one way: anything that reads as a restriction is
 * an allergy, anything that reads as a drink is a drink, and the rest are
 * cuisines.
 */
export function foodDrinkKind(label: string): "allergy" | "beverage_preference" | "cuisine" {
  const t = label.toLowerCase();
  if (/allerg|intoleran|-free|\bfree\b|\bno\s|avoid|celiac|coeliac|lactose|gluten|\bnuts?\b|peanut|shellfish|sesame|\beggs?\b|\bsoy\b|dairy/.test(t)) return "allergy";
  if (/wine|champagne|whisk|whiskey|scotch|vodka|gin\b|rum\b|tequila|cocktail|beer|sake|coffee|\btea\b|juice|water|spirits|mocktail|bourbon|cognac|prosecco/.test(t)) return "beverage_preference";
  return "cuisine";
}

/* ------------------------------------------------------------ the import plan */

/**
 * The client fields an import can set, in the order the preview shows them,
 * with the words the preview uses. Everything a Tern contact can fill that
 * Blackbook holds as a single value on the client.
 */
export const IMPORT_FIELDS = [
  ["prefix", "Prefix"],
  ["firstName", "First name"],
  ["middleName", "Middle name"],
  ["lastName", "Last name"],
  ["suffix", "Suffix"],
  ["preferredName", "Known as"],
  ["dateOfBirth", "Date of birth"],
  ["gender", "Gender"],
  ["email", "Email"],
  ["mobile", "Mobile"],
  ["flightSeat", "Seat"],
  ["flightBulkhead", "Bulkhead"],
  ["hotelRoomFloor", "Room floor"],
  ["hotelRoomElevator", "Lift"],
  ["cruiseDeck", "Cruise deck"],
  ["cruiseCabinPosition", "Cruise cabin"],
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number][0];

/**
 * How a Tern value stands against the client's own.
 *
 * `new` — Blackbook has nothing, so taking it costs nothing.
 * `same` — nothing to decide.
 * `differs` — both hold something and they disagree. The desk's entry is kept
 * unless somebody chooses Tern's, one field at a time.
 */
export type FieldState = "new" | "same" | "differs";

export function fieldState(tern: string | null, current: string | null): FieldState | null {
  if (!tern) return null;
  if (!current) return "new";
  return tern.trim().toLowerCase() === current.trim().toLowerCase() ? "same" : "differs";
}

/**
 * A trip as the client's Trips tab lists it: name first, then the status and
 * the dates wherever they fall in the row.
 */
export function tripSummaryFromRow(texts: string[]): {
  title: string;
  status: TripStatus | null;
  datesText: string | null;
  startsOn: string | null;
  endsOn: string | null;
} {
  /*
   * The row also says when the trip was last touched — "Last updated 21 Sep
   * 2026" — and shows a price. Neither is the trip's dates or its name: read as
   * dates, every trip looked undated and was left unticked; read as a name, a
   * trip arrived called "₹11,750.00".
   */
  const notName = (t: string) =>
    Boolean(tripStatusFromTern(t)) || /^last updated/i.test(t) || MONEY_LIKE.test(t) || /^\(?\d+ (people|person)\)?$/i.test(t);
  const isDates = (t: string) => !/^last updated/i.test(t) && (/(19|20)\d{2}|Multiple Date Ranges/.test(t));
  const title = texts.find((t) => !notName(t) && !isDates(t)) ?? "Trip";
  const status = texts.map(tripStatusFromTern).find((s) => s !== null) ?? null;
  const datesText = texts.find(isDates) ?? null;
  return { title, status, datesText, ...parseTernDates(datesText) };
}

/** A price as Tern shows one, in any currency it uses. */
const MONEY_LIKE = /^[€$£₹¥]\s?[\d,]+(\.\d+)?$|^[A-Z]{3}\s?[\d,]+(\.\d+)?$/;

/**
 * The number a person would most likely confirm for a phone Tern stored
 * without its plus: the same digits, read as already carrying their country
 * code. Offered, never applied — somebody presses to accept it.
 */
export function suggestInternational(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return parseInternationalPhone(`+${digits}`)?.international ?? null;
}
