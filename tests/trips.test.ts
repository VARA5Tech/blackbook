import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The bridge is replaced with canned answers shaped exactly like what it
 * returned from live Tern. Tern itself is exercised separately, end to end;
 * here the question is what Blackbook does with an answer.
 */
const bridge = vi.hoisted(() => ({
  contact: vi.fn(),
  trip: vi.fn(),
  searchContacts: vi.fn(),
}));
vi.mock("@/lib/tern", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tern")>()),
  ternConfigured: () => true,
  ternBridge: { ...bridge, health: vi.fn(), searchTrips: vi.fn(), catalogue: vi.fn() },
}));

import { db } from "@/db";
import { activityLog, customerPreferences, customers, milestones, trips } from "@/db/schema";
import {
  emailsFromTern,
  foodDrinkKind,
  itineraryItem,
  parseTernDates,
  partySize,
  phonesFromTern,
  preferenceChipsFromTern,
  splitHonorific,
  suggestInternational,
  tripSummaryFromRow,
  travelDocumentsFromTern,
  travelPreferencesFromTern,
  tripFlags,
  tripStatusFromTern,
  type StoredTravelDocument,
} from "@/domain/trips";
import { lastFour, open, seal } from "@/lib/sealed";
import { exportClients, createCustomer } from "@/services/client-service";
import {
  applyTernImport,
  populateClientFromTern,
  populateTripFromTern,
  previewTernClient,
  revealTravelDocument,
  travelDocumentsForScreen,
  tripsForClient,
} from "@/services/tern-service";
import { actingAs, resetData, seedCatalogue, seedStaff, type StaffFixtures } from "./helpers";

/* ------------------------------------------------------------ reading Tern's words */

describe("reading Tern's dates", () => {
  it.each([
    ["17 - 26 Mar 2026", "2026-03-17", "2026-03-26"],
    ["29 Mar - 1 Apr 2026", "2026-03-29", "2026-04-01"],
    ["17 Dec 2026 - 8 Jan 2027", "2026-12-17", "2027-01-08"],
    ["4 - 5 Jan 2026", "2026-01-04", "2026-01-05"],
    ["Jul 15 - 18, 2025", "2025-07-15", "2025-07-18"],
    ["Dec 30, 2025 - Jan 2, 2026", "2025-12-30", "2026-01-02"],
    ["17 Mar 2026", "2026-03-17", "2026-03-17"],
  ])("reads %s", (text, start, end) => {
    expect(parseTernDates(text)).toEqual({ startsOn: start, endsOn: end });
  });

  /** A wrong date the desk trusts is worse than no date and Tern's own words. */
  it.each(["Multiple Date Ranges", "", "soon", "31 Feb 2026", "TBC 2026"])("gives no date for %j", (text) => {
    expect(parseTernDates(text)).toEqual({ startsOn: null, endsOn: null });
  });

  it("reads a party size and a status", () => {
    expect(partySize("(10 people)")).toBe(10);
    expect(partySize("(1 person)")).toBe(1);
    expect(partySize("")).toBeNull();
    expect(tripStatusFromTern("Traveled")).toBe("traveled");
    expect(tripStatusFromTern("Somewhere")).toBeNull();
  });
});

describe("reading an itinerary row", () => {
  it("finds the flight in the title and the time beside it", () => {
    const item = itineraryItem(["Flight from DEL to ZRH (LX147)", "1:45AM IST - 6:20AM CET", "3", "€0"], "99");
    expect(item).toMatchObject({
      kind: "flight", airline: "LX", flightNumber: "LX147", from: "DEL", to: "ZRH",
      time: "1:45AM IST - 6:20AM CET", ternId: "99",
    });
    // Tern's zero is a placeholder, not a price.
    expect(item?.price).toBeNull();
  });

  it("knows hotels by brand and Tern's proposals by name", () => {
    expect(itineraryItem(["The Oberoi Rajvilas, Jaipur"])?.kind).toBe("hotel");
    expect(itineraryItem(["Multiple Options"])?.kind).toBe("options");
    expect(itineraryItem(["Dinner at Nobu"])?.kind).toBe("dining");
    expect(itineraryItem(["Something unnamed"])?.kind).toBe("other");
  });
});

describe("flagging trips that may not be real", () => {
  it("marks, and never drops", () => {
    expect(tripFlags({ title: "Test trip", startsOn: null, datesText: null, travelers: [{ name: "Guest 1" }] }))
      .toEqual(["no_dates", "test_name", "placeholder_travelers"]);
    expect(tripFlags({ title: "Kyushu", startsOn: "2026-03-01", datesText: "1 - 5 Mar 2026", travelers: [{ name: "Meera Iyer" }] }))
      .toEqual([]);
    // Several ranges is a real trip with no single date, not a missing one.
    expect(tripFlags({ title: "Europe", startsOn: null, datesText: "Multiple Date Ranges", travelers: [{ name: "A" }] }))
      .toEqual([]);
  });
});

describe("reading a Tern contact", () => {
  /**
   * Blackbook never supplies a country. Tern often stores "91 9910086263",
   * the code without its plus, and that comes back to be confirmed.
   */
  it("keeps numbers without a country code out, for a person to confirm", () => {
    const phones = phonesFromTern([
      { phone: "91 9910086263", primary: ["Set as Primary Phone"] },
      { phone: "+44 7700 900123" },
    ]);
    expect(phones.map((p) => [p.phone, p.needsCountry, p.primary])).toEqual([
      ["91 9910086263", true, true],
      ["+44 7700 900123", false, false],
    ]);
  });

  it("puts the primary email first", () => {
    expect(emailsFromTern([{ email: "b@x.com" }, { email: "A@X.com", primary: ["Set as Primary Email"] }]).map((e) => e.email))
      .toEqual(["a@x.com", "b@x.com"]);
  });

  it("maps the six small preferences and ignores words it does not know", () => {
    expect(travelPreferencesFromTern({
      flight_seating: "Window", flight_bulkhead: "No Preference", room_floor: "Higher Floor",
      room_elevator: "Far from Elevator", cabin_floor: "Lower Deck", cabin_location: "Somewhere",
    })).toEqual({
      flightSeat: "window", flightBulkhead: "no_preference", hotelRoomFloor: "higher",
      hotelRoomElevator: "far", cruiseDeck: "lower",
    });
  });

  it("reads the preference chips between their labels", () => {
    const chips = preferenceChipsFromTern([{
      heading: "Preferences",
      tokens: [
        { text: "Activities & Interests", role: "label" },
        { text: "Skiing", role: "value" },
        { text: "Food, Drink & Allergy Preferences", role: "label" },
        { text: "Nut allergy", role: "value" },
        { text: "Champagne", role: "value" },
        { text: "Other Travel Preferences", role: "label" },
        { text: "Window", role: "value" },
      ],
    }]);
    expect(chips).toEqual({ interests: ["Skiing"], foodDrink: ["Nut allergy", "Champagne"] });
  });

  /** An allergy filed as a cuisine is the one mistake here that can hurt somebody. */
  it("errs towards allergy", () => {
    expect(foodDrinkKind("Nut allergy")).toBe("allergy");
    expect(foodDrinkKind("Gluten-free")).toBe("allergy");
    expect(foodDrinkKind("Champagne")).toBe("beverage_preference");
    expect(foodDrinkKind("Japanese")).toBe("cuisine");
  });

  it("splits an honorific from a name", () => {
    expect(splitHonorific("Mr. Arpit Goyal")).toEqual({ prefix: "Mr.", name: "Arpit Goyal" });
    expect(splitHonorific("Arpit Goyal")).toEqual({ prefix: null, name: "Arpit Goyal" });
  });

  it("reads passports and the secure numbers, and trusts only ISO dates", () => {
    const docs = travelDocumentsFromTern(
      [{ passport_number: "Z1234567", nationality: "INDIAN", expiration_date: "2031-05-01", ternId: "5" }],
      { known_traveler_number: "KTN998877", known_traveler_number_expiration_date: "05/01/2030" },
    );
    expect(docs.map((d) => [d.kind, d.number, d.expiresOn, d.source])).toEqual([
      ["passport", "Z1234567", "2031-05-01", "tern"],
      ["known_traveler", "KTN998877", null, "tern"],
    ]);
  });
});

describe("sealing a travel document", () => {
  it("opens what it sealed, and nothing else", () => {
    const sealed = seal("Z1234567");
    expect(sealed).not.toContain("Z1234567");
    expect(open(sealed)).toBe("Z1234567");
    // A fresh nonce every time: the same number never seals the same way twice.
    expect(seal("Z1234567")).not.toBe(sealed);
    expect(lastFour("Z12 34567")).toBe("4567");
  });

  it("refuses a value altered in the database", () => {
    const [v, nonce, tag, body] = seal("Z1234567").split(".");
    /*
     * The first character, not the last. The last base64 character of a short
     * value carries padding bits the decoder ignores, so changing it sometimes
     * changes nothing at all — and the test then failed at random, depending on
     * the nonce. Every bit of the first character is real ciphertext.
     */
    const flipped = (body.startsWith("A") ? "B" : "A") + body.slice(1);
    expect(() => open([v, nonce, tag, flipped].join("."))).toThrow();
  });
});

/* ------------------------------------------------------------ populating */

function ternContact(overrides: Partial<{ id: string; first: string; last: string; email: string; phone: string; passport: string }> = {}) {
  const o = { id: "700001", first: "Meera", last: "Iyer", email: "meera@example.com", phone: "+91 98100 55667", passport: "Z7654321", ...overrides };
  return {
    ternId: o.id,
    fetchedAt: "2026-09-24T00:00:00Z",
    forms: {
      identity: { prefix: "Ms.", first_name: o.first, last_name: o.last, born_at: "1985-04-18", gender: "Female", anniversary_month: "February", anniversary_day: "14", anniversary_year: "2012" },
      travel_information: { known_traveler_number: "KTN123" },
      other_travel_preferences: { flight_seating: "Aisle" },
    },
    items: {
      emails: [{ ternId: "1", email: o.email, primary: ["Set as Primary Email"] }],
      phones: [{ ternId: "2", phone: o.phone, primary: ["Set as Primary Phone"] }, { ternId: "3", phone: "91 9999988888" }],
      passports: [{ ternId: "4", passport_number: o.passport, nationality: "INDIAN", expiration_date: "2031-01-01" }],
    },
    profile: [{
      heading: "Preferences",
      tokens: [
        { text: "Activities & Interests", role: "label", contact: null, trip: null, href: null },
        { text: "Skiing", role: "value", contact: null, trip: null, href: null },
        { text: "Food, Drink & Allergy Preferences", role: "label", contact: null, trip: null, href: null },
        { text: "Shellfish allergy", role: "value", contact: null, trip: null, href: null },
      ],
    }],
    tabs: { trips: { sections: [], trips: ["900001"] } },
  };
}

function ternTrip(id = "900001", overrides: Record<string, unknown> = {}) {
  return {
    ternId: id,
    fetchedAt: "2026-09-24T00:00:00Z",
    title: "Kyushu in Spring",
    overview: [{ heading: "Itinerary", tokens: [
      { text: "Kyushu", role: "value", contact: null, trip: null, href: null },
      { text: "17 - 26 Mar 2026", role: "value", contact: null, trip: null, href: null },
    ] }],
    travelers: [
      { name: "Ms. Meera Iyer", contactId: "700001", primary: true, email: null, phone: null, birthday: null },
      { name: "Mr. Arjun Iyer", contactId: "700002", primary: false, email: null, phone: null, birthday: null },
    ],
    settings: { status_id: "Booked", currency: "Japanese Yen (JPY)" },
    days: [{ ternId: "1", title: null, location: "Fukuoka", items: [{ ternId: "11", texts: ["Flight from DEL to FUK (JL44)", "9:10AM IST - 6:40PM JST"] }] }],
    ...overrides,
  };
}

describe("populating a client from Tern", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.manager);
    vi.clearAllMocks();
    bridge.contact.mockResolvedValue({ ok: true, data: ternContact() });
    bridge.trip.mockResolvedValue({ ok: true, data: ternTrip() });
  });

  it("creates the client, seals the passport, and records it on the trail", async () => {
    const result = await populateClientFromTern({ ternId: "700001" });
    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result).toMatchObject({ created: true, tripIds: ["900001"], travelDocuments: 2, travelDocumentsSkipped: false });
    // The number without a plus is held back, never stored with a guessed country.
    expect(result.phonesToConfirm).toEqual(["91 9999988888"]);

    const row = await db.query.customers.findFirst({ where: eq(customers.id, result.customerId) });
    expect(row).toMatchObject({
      ternId: "700001", prefix: "Ms.", firstName: "Meera", lastName: "Iyer",
      email: "meera@example.com", mobile: "+91 98100 55667", dateOfBirth: "1985-04-18",
      gender: "female", flightSeat: "aisle",
    });

    // Nowhere in the row, sealed column or Tern's copy, is the number readable.
    expect(JSON.stringify(row)).not.toContain("Z7654321");
    expect(JSON.stringify(row)).not.toContain("KTN123");
    const docs = row!.travelDocuments as StoredTravelDocument[];
    expect(docs.map((d) => [d.kind, d.last4])).toEqual([["passport", "4321"], ["known_traveler", "N123"]]);
    expect(open(docs[0].sealed)).toBe("Z7654321");

    const dates = await db.select({ type: milestones.type, date: milestones.date }).from(milestones).where(eq(milestones.customerId, result.customerId));
    expect(dates).toEqual(expect.arrayContaining([
      { type: "birthday", date: "1985-04-18" },
      { type: "wedding_anniversary", date: "2012-02-14" },
    ]));

    const prefs = await db.select().from(customerPreferences).where(eq(customerPreferences.customerId, result.customerId));
    expect(prefs).toHaveLength(2);

    const trail = await db.select().from(activityLog).where(eq(activityLog.customerId, result.customerId));
    expect(trail.map((t) => t.summary)).toContain("Brought over from Tern");
  });

  /** The desk's own entries are the record; Tern only fills what is empty. */
  it("never overwrites what the desk entered", async () => {
    const mine = await createCustomer({ firstName: "Meera", lastName: "Iyer", email: "desk@example.com", customerSince: "2026-01-01" });
    const result = await populateClientFromTern({ ternId: "700001", customerId: mine.id });
    expect(result.status).toBe("done");

    const row = await db.query.customers.findFirst({ where: eq(customers.id, mine.id) });
    expect(row?.email).toBe("desk@example.com");
    expect(row?.dateOfBirth).toBe("1985-04-18");
    expect(row?.ternId).toBe("700001");
  });

  /** Nothing is merged on a guess. */
  it("asks before joining a likely match, and joins or creates on the answer", async () => {
    const mine = await createCustomer({ firstName: "Someone", email: "meera@example.com", customerSince: "2026-01-01" });

    const first = await populateClientFromTern({ ternId: "700001" });
    expect(first).toMatchObject({ status: "possible_match", candidates: [{ id: mine.id, reason: "same email" }] });

    const joined = await populateClientFromTern({ ternId: "700001", linkExisting: mine.id });
    expect(joined).toMatchObject({ status: "done", customerId: mine.id, created: false });
  });

  it("refuses to link a Tern contact already linked to another client", async () => {
    const done = await populateClientFromTern({ ternId: "700001", createNew: true });
    const other = await createCustomer({ firstName: "Other", customerSince: "2026-01-01" });
    const second = await populateClientFromTern({ ternId: "700001", customerId: other.id });
    expect(done.status).toBe("done");
    expect(second.status).toBe("failed");
  });

  it("does not store a passport it cannot seal", async () => {
    const key = process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_ENCRYPTION_KEY;
    try {
      const result = await populateClientFromTern({ ternId: "700001" });
      expect(result).toMatchObject({ status: "done", travelDocuments: 0, travelDocumentsSkipped: true });
      if (result.status !== "done") return;
      const row = await db.query.customers.findFirst({ where: eq(customers.id, result.customerId) });
      expect(row?.travelDocuments).toEqual([]);
      expect(JSON.stringify(row)).not.toContain("Z7654321");
    } finally {
      process.env.PII_ENCRYPTION_KEY = key;
    }
  });

  it("brings a trip over once, however many times it is populated", async () => {
    const client = await populateClientFromTern({ ternId: "700001" });
    if (client.status !== "done") throw new Error("setup");

    await populateTripFromTern({ ternId: "900001", customerId: client.customerId });
    bridge.trip.mockResolvedValue({ ok: true, data: ternTrip("900001", { settings: { status_id: "Traveled", currency: "Japanese Yen (JPY)" } }) });
    await populateTripFromTern({ ternId: "900001", customerId: client.customerId });

    const rows = await db.select().from(trips).where(eq(trips.customerId, client.customerId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Kyushu in Spring", status: "traveled", startsOn: "2026-03-17", endsOn: "2026-03-26",
      currency: "JPY", partySize: 2, flags: [],
    });
    const itinerary = rows[0].itinerary as { location: string; items: { flightNumber: string }[] }[];
    expect(itinerary[0].location).toBe("Fukuoka");
    expect(itinerary[0].items[0].flightNumber).toBe("JL44");
  });

  /** A companion's history without making them a client. */
  it("shows a trip on a companion's page once they are a client", async () => {
    const meera = await populateClientFromTern({ ternId: "700001" });
    if (meera.status !== "done") throw new Error("setup");
    await populateTripFromTern({ ternId: "900001", customerId: meera.customerId });

    bridge.contact.mockResolvedValue({ ok: true, data: ternContact({ id: "700002", first: "Arjun", email: "arjun@example.com", phone: "+91 98100 11122", passport: "P1112223" }) });
    const arjun = await populateClientFromTern({ ternId: "700002", createNew: true });
    if (arjun.status !== "done") throw new Error("setup");
    // Re-reading the trip ties the companion to his new client record.
    await populateTripFromTern({ ternId: "900001", customerId: meera.customerId });

    const his = await tripsForClient(arjun.customerId);
    expect(his.map((t) => t.title)).toEqual(["Kyushu in Spring"]);
    expect(his[0].customerId).toBe(meera.customerId);
  });
});

/* ------------------------------------------------------------ preview, then choose */

describe("previewing a Tern import before anything is written", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.manager);
    vi.clearAllMocks();
    bridge.contact.mockResolvedValue({ ok: true, data: ternContact() });
  });

  it("reads a trip row and suggests a country for a bare number", () => {
    expect(tripSummaryFromRow(["Kyushu in Spring", "Booked", "17 - 26 Mar 2026"])).toMatchObject({
      title: "Kyushu in Spring", status: "booked", startsOn: "2026-03-17", endsOn: "2026-03-26",
    });
    expect(suggestInternational("91 9910086263")).toBe("+91 99100 86263");
    expect(suggestInternational("12")).toBeNull();
  });

  it("compares every field with the client and writes nothing", async () => {
    const mine = await createCustomer({ firstName: "Meera", lastName: "Iyer", email: "desk@example.com", customerSince: "2026-01-01" });
    const before = JSON.stringify(await db.query.customers.findFirst({ where: eq(customers.id, mine.id) }));

    const plan = await previewTernClient({ ternId: "700001", customerId: mine.id });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const state = Object.fromEntries(plan.fields.map((f) => [f.field, f.state]));
    expect(state).toMatchObject({ firstName: "same", lastName: "same", email: "differs", dateOfBirth: "new", flightSeat: "new" });
    expect(plan.fields.find((f) => f.field === "email")).toMatchObject({ tern: "meera@example.com", current: "desk@example.com" });
    expect(plan.phones).toEqual([{ raw: "91 9999988888", suggestion: "+91 99999 88888" }]);
    expect(plan.preferences.map((p) => p.label)).toEqual(["Skiing", "Shellfish allergy"]);
    expect(plan.milestones.map((m) => m.type)).toEqual(["birthday", "wedding_anniversary"]);

    // The browser sees the last four, never the number.
    expect(JSON.stringify(plan)).not.toContain("Z7654321");
    expect(plan.travelDocuments.items[0]).toMatchObject({ kind: "passport", last4: "4321" });

    const after = JSON.stringify(await db.query.customers.findFirst({ where: eq(customers.id, mine.id) }));
    expect(after).toBe(before);
  });

  /** Overwriting is a choice somebody makes, field by field, and the trail says what changed. */
  it("overwrites only the fields chosen, takes only what is ticked, and records it", async () => {
    const mine = await createCustomer({ firstName: "Meera", lastName: "Iyer", email: "desk@example.com", customerSince: "2026-01-01" });
    const plan = await previewTernClient({ ternId: "700001", customerId: mine.id });
    if (!plan.ok) throw new Error("setup");

    await applyTernImport({
      ternId: "700001",
      target: { mode: "existing", customerId: mine.id },
      fields: { email: "take", dateOfBirth: "keep", flightSeat: "take" },
      phones: ["+91 99999 88888"],
      preferences: [plan.preferences[0].key],
      milestones: ["wedding_anniversary"],
      travelDocuments: [],
    });

    const row = await db.query.customers.findFirst({ where: eq(customers.id, mine.id) });
    expect(row).toMatchObject({ email: "meera@example.com", dateOfBirth: null, flightSeat: "aisle", mobile: "+91 99999 88888" });
    expect(row?.travelDocuments).toEqual([]);

    const prefs = await db.select().from(customerPreferences).where(eq(customerPreferences.customerId, mine.id));
    expect(prefs).toHaveLength(1);
    const dates = await db.select({ type: milestones.type }).from(milestones).where(eq(milestones.customerId, mine.id));
    expect(dates.map((d) => d.type)).toEqual(["wedding_anniversary"]);

    const trail = await db.select().from(activityLog).where(eq(activityLog.customerId, mine.id));
    const update = trail.find((t) => t.summary === "Updated from Tern");
    expect(update?.changes).toMatchObject({ email: { from: "desk@example.com", to: "meera@example.com" } });
  });

  it("offers a likely match and imports into the one chosen", async () => {
    const mine = await createCustomer({ firstName: "Someone", email: "meera@example.com", customerSince: "2026-01-01" });
    const plan = await previewTernClient({ ternId: "700001" });
    if (!plan.ok) throw new Error("setup");
    expect(plan.target).toEqual({ mode: "new" });
    expect(plan.candidates).toMatchObject([{ id: mine.id, reason: "same email" }]);

    const done = await applyTernImport({ ternId: "700001", target: { mode: "existing", customerId: mine.id }, fields: { lastName: "take" } });
    expect(done).toMatchObject({ customerId: mine.id, created: false });
    const row = await db.query.customers.findFirst({ where: eq(customers.id, mine.id) });
    expect(row).toMatchObject({ firstName: "Someone", lastName: "Iyer", ternId: "700001" });
  });

  it("will not create a second client for a contact already brought over", async () => {
    await applyTernImport({ ternId: "700001", target: { mode: "new" }, fields: { firstName: "take" } });
    await expect(applyTernImport({ ternId: "700001", target: { mode: "new" }, fields: { firstName: "take" } })).rejects.toThrow(/already linked/);
  });
});

describe("revealing a travel document", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
    bridge.contact.mockResolvedValue({ ok: true, data: ternContact() });
  });

  it("opens for an administrator and a founder, writes the trail, and refuses a manager", async () => {
    const client = await populateClientFromTern({ ternId: "700001" });
    if (client.status !== "done") throw new Error("setup");

    expect(await revealTravelDocument({ customerId: client.customerId, index: 0 })).toBe("Z7654321");
    actingAs(staff.founder);
    expect(await revealTravelDocument({ customerId: client.customerId, index: 0 })).toBe("Z7654321");

    actingAs(staff.manager);
    await expect(revealTravelDocument({ customerId: client.customerId, index: 0 })).rejects.toThrow();

    const trail = await db.select().from(activityLog).where(eq(activityLog.customerId, client.customerId));
    expect(trail.filter((t) => t.summary.includes("revealed"))).toHaveLength(2);
  });

  it("never hands the sealed number to the screen", async () => {
    const client = await populateClientFromTern({ ternId: "700001" });
    if (client.status !== "done") throw new Error("setup");
    const row = await db.query.customers.findFirst({ where: eq(customers.id, client.customerId) });
    const shown = travelDocumentsForScreen(row!.travelDocuments);
    expect(shown[0]).not.toHaveProperty("sealed");
    expect(shown[0]).toMatchObject({ last4: "4321", expiry: "ok" });
  });

  it("leaves travel documents and Tern's copy out of the spreadsheet", async () => {
    await populateClientFromTern({ ternId: "700001" });
    const file = await exportClients({});
    expect(file.columns.join("|")).not.toMatch(/Travel documents|Tern raw/i);
    expect(JSON.stringify(file.rows)).not.toContain("v1.");
  });
});

/* A schema-level guard: the table this work added is closed to the API roles. */
describe("the trip table", () => {
  it("has row security on", async () => {
    const [row] = await db.execute<{ on: boolean }>(sql`select relrowsecurity as on from pg_class where relname = 'trip'`);
    expect(row.on).toBe(true);
  });
});
