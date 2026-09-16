import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CATALOGUE } from "@/db/catalogue";
import { KIND_LABELS, PREFERENCE_KINDS } from "@/domain/preferences";
import {
  createCustomer,
  getClient360,
  searchClients,
  DomainError,
} from "@/services/client-service";
import {
  createPreferenceOption,
  getCatalogue,
  listOptionsByKind,
  setPreferences,
  updatePreferenceProfile,
} from "@/services/preference-service";
import {
  actingAs,
  optionId,
  resetData,
  seedCatalogue,
  seedStaff,
  type StaffFixtures,
} from "./helpers";

/**
 * Requirements document, sections 4, 5 and 6:
 * TRAVEL PREFERENCES, HOTEL & AIR PREFERENCES, DINING & LIFESTYLE.
 */
describe("preferences", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
  });

  async function makeClient(firstName = "Rishabh") {
    return createCustomer({ firstName, customerSince: "2026-01-01" });
  }

  /** Reads back one facet of a client's preferences, grouped by polarity. */
  async function readFacet(customerId: string, kind: string) {
    const record = await getClient360(customerId);
    const rows = (record?.preferences ?? []).filter((row) => row.kind === kind);
    return {
      prefer: rows.filter((r) => r.polarity === "prefer").map((r) => r.label),
      wishlist: rows.filter((r) => r.polarity === "wishlist").map((r) => r.label),
      avoid: rows.filter((r) => r.polarity === "avoid").map((r) => r.label),
    };
  }

  describe("catalogue covers every documented facet", () => {
    it("has a label for every facet the schema allows", () => {
      for (const kind of PREFERENCE_KINDS) {
        expect(KIND_LABELS[kind]).toBeTruthy();
      }
    });

    it("seeds options for every facet ops will use on day one", async () => {
      const catalogue = await getCatalogue();
      const expected = [
        "destination",
        "travel_style",
        "travel_season",
        "hotel_brand",
        "room_type",
        "bed_preference",
        "view_preference",
        "airline",
        "loyalty_programme",
        "seat_preference",
        "flight_timing",
        "cuisine",
        "allergy",
        "beverage_preference",
        "interest",
        "activity",
        "luxury_brand",
      ];

      for (const kind of expected) {
        expect(catalogue.get(kind)?.length ?? 0).toBeGreaterThan(0);
      }
    });

    it("ships no seeded options for the free-form facets", () => {
      // Specific hotels and restaurants are client-specific, so seeding a list
      // would be guesswork. Staff add them at runtime instead, which is why
      // this asserts the seed rather than the live table.
      const seeded = CATALOGUE.map((entry) => entry.kind);
      expect(seeded).not.toContain("hotel_property");
      expect(seeded).not.toContain("restaurant");
    });

    it("carries all thirteen documented travel styles", async () => {
      const styles = (await listOptionsByKind("travel_style")).map(
        (o) => o.label,
      );
      expect(styles).toEqual(
        expect.arrayContaining([
          "Luxury",
          "Adventure",
          "Wellness",
          "Beach",
          "Safari",
          "Culture",
          "Gastronomy",
          "Shopping",
          "Ski",
          "Family",
          "Romantic",
          "Art and Design",
          "Sports and Events",
        ]),
      );
      expect(styles).toHaveLength(13);
    });

    it("has no duplicate slug within a facet", () => {
      const seen = new Set<string>();
      for (const entry of CATALOGUE) {
        const key = `${entry.kind}:${entry.slug}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
  });

  describe("destinations, in all three documented senses", () => {
    it("records favourites, wishlist and to-avoid on one client at once", async () => {
      const client = await makeClient();

      await setPreferences({
        customerId: client.id,
        kind: "destination",
        selections: [
          { optionId: await optionId("destination", "japan"), polarity: "prefer" },
          { optionId: await optionId("destination", "maldives"), polarity: "prefer" },
          { optionId: await optionId("destination", "italy"), polarity: "wishlist" },
          {
            optionId: await optionId("destination", "united_arab_emirates"),
            polarity: "avoid",
            note: "Been too often for work.",
          },
        ],
      });

      const facet = await readFacet(client.id, "destination");
      expect(facet.prefer.sort()).toEqual(["Japan", "Maldives"]);
      expect(facet.wishlist).toEqual(["Italy"]);
      expect(facet.avoid).toEqual(["United Arab Emirates"]);
    });

    it("keeps the note attached to the individual choice", async () => {
      const client = await makeClient();
      await setPreferences({
        customerId: client.id,
        kind: "destination",
        selections: [
          {
            optionId: await optionId("destination", "japan"),
            polarity: "prefer",
            note: "Cherry blossom only",
          },
        ],
      });

      const record = await getClient360(client.id);
      const japan = record?.preferences.find((p) => p.label === "Japan");
      expect(japan?.note).toBe("Cherry blossom only");
    });

    it("lets the same destination move from wishlist to favourite", async () => {
      const client = await makeClient();
      const japan = await optionId("destination", "japan");

      await setPreferences({
        customerId: client.id,
        kind: "destination",
        selections: [{ optionId: japan, polarity: "wishlist" }],
      });
      expect((await readFacet(client.id, "destination")).wishlist).toEqual([
        "Japan",
      ]);

      await setPreferences({
        customerId: client.id,
        kind: "destination",
        selections: [{ optionId: japan, polarity: "prefer" }],
      });

      const facet = await readFacet(client.id, "destination");
      expect(facet.prefer).toEqual(["Japan"]);
      expect(facet.wishlist).toEqual([]);
    });

    it("records preferred travel seasons separately from destinations", async () => {
      const client = await makeClient();
      await setPreferences({
        customerId: client.id,
        kind: "travel_season",
        selections: [
          {
            optionId: await optionId("travel_season", "cherry_blossom"),
            polarity: "prefer",
          },
          {
            optionId: await optionId("travel_season", "monsoon"),
            polarity: "avoid",
          },
        ],
      });

      const facet = await readFacet(client.id, "travel_season");
      expect(facet.prefer).toEqual(["Cherry Blossom"]);
      expect(facet.avoid).toEqual(["Monsoon"]);
    });
  });

  describe("saving one facet leaves the others alone", () => {
    it("does not wipe dining when travel is saved", async () => {
      const client = await makeClient();

      await setPreferences({
        customerId: client.id,
        kind: "cuisine",
        selections: [
          { optionId: await optionId("cuisine", "japanese"), polarity: "prefer" },
        ],
      });
      await setPreferences({
        customerId: client.id,
        kind: "destination",
        selections: [
          { optionId: await optionId("destination", "japan"), polarity: "prefer" },
        ],
      });

      expect((await readFacet(client.id, "cuisine")).prefer).toEqual([
        "Japanese",
      ]);
      expect((await readFacet(client.id, "destination")).prefer).toEqual([
        "Japan",
      ]);
    });

    it("clears a facet when saved with an empty selection", async () => {
      const client = await makeClient();
      await setPreferences({
        customerId: client.id,
        kind: "cuisine",
        selections: [
          { optionId: await optionId("cuisine", "japanese"), polarity: "prefer" },
        ],
      });

      await setPreferences({
        customerId: client.id,
        kind: "cuisine",
        selections: [],
      });

      expect((await readFacet(client.id, "cuisine")).prefer).toEqual([]);
    });

    it("refuses an option that belongs to a different facet", async () => {
      const client = await makeClient();
      await expect(
        setPreferences({
          customerId: client.id,
          kind: "cuisine",
          selections: [
            {
              optionId: await optionId("destination", "japan"),
              polarity: "prefer",
            },
          ],
        }),
      ).rejects.toThrow(DomainError);
    });

    it("refuses preferences for a client who does not exist", async () => {
      await expect(
        setPreferences({
          customerId: "00000000-0000-4000-8000-000000000000",
          kind: "cuisine",
          selections: [],
        }),
      ).rejects.toThrow(DomainError);
    });
  });

  describe("hotel preferences", () => {
    it("records preferred brands, brands to avoid, room, bed and view", async () => {
      const client = await makeClient();

      await setPreferences({
        customerId: client.id,
        kind: "hotel_brand",
        selections: [
          {
            optionId: await optionId("hotel_brand", "aman"),
            polarity: "prefer",
            note: "First choice wherever they operate.",
          },
          {
            optionId: await optionId("hotel_brand", "ritz_carlton"),
            polarity: "avoid",
          },
        ],
      });
      await setPreferences({
        customerId: client.id,
        kind: "room_type",
        selections: [
          { optionId: await optionId("room_type", "suite"), polarity: "prefer" },
        ],
      });
      await setPreferences({
        customerId: client.id,
        kind: "bed_preference",
        selections: [
          {
            optionId: await optionId("bed_preference", "king_bed"),
            polarity: "prefer",
          },
        ],
      });
      await setPreferences({
        customerId: client.id,
        kind: "view_preference",
        selections: [
          {
            optionId: await optionId("view_preference", "quiet_side"),
            polarity: "prefer",
          },
        ],
      });

      const brands = await readFacet(client.id, "hotel_brand");
      expect(brands.prefer).toEqual(["Aman"]);
      expect(brands.avoid).toEqual(["Ritz-Carlton"]);
      expect((await readFacet(client.id, "room_type")).prefer).toEqual(["Suite"]);
      expect((await readFacet(client.id, "bed_preference")).prefer).toEqual([
        "King Bed",
      ]);
      expect((await readFacet(client.id, "view_preference")).prefer).toEqual([
        "Quiet Side",
      ]);
    });

    it("records a specific property the client asked for by name", async () => {
      const client = await makeClient();
      const created = await createPreferenceOption({
        kind: "hotel_property",
        label: "Aman Tokyo",
      });

      await setPreferences({
        customerId: client.id,
        kind: "hotel_property",
        selections: [{ optionId: created.id, polarity: "prefer" }],
      });

      expect((await readFacet(client.id, "hotel_property")).prefer).toEqual([
        "Aman Tokyo",
      ]);
      expect(created.isCustom).toBe(true);
    });

    it("stores other hotel preferences as free text", async () => {
      const client = await makeClient();
      await updatePreferenceProfile({
        customerId: client.id,
        hotelNotes: "Always a suite for stays longer than four nights.",
      });

      const record = await getClient360(client.id);
      expect(record?.profile?.hotelNotes).toBe(
        "Always a suite for stays longer than four nights.",
      );
    });
  });

  describe("flight preferences", () => {
    it("records airlines, loyalty programmes, seat and timing", async () => {
      const client = await makeClient();

      await setPreferences({
        customerId: client.id,
        kind: "airline",
        selections: [
          {
            optionId: await optionId("airline", "singapore_airlines"),
            polarity: "prefer",
          },
        ],
      });
      await setPreferences({
        customerId: client.id,
        kind: "loyalty_programme",
        selections: [
          {
            optionId: await optionId("loyalty_programme", "singapore_krisflyer"),
            polarity: "prefer",
            note: "PPS Club",
          },
        ],
      });
      await setPreferences({
        customerId: client.id,
        kind: "seat_preference",
        selections: [
          {
            optionId: await optionId("seat_preference", "aisle_seat"),
            polarity: "prefer",
            note: "Long-haul especially.",
          },
        ],
      });
      await setPreferences({
        customerId: client.id,
        kind: "flight_timing",
        selections: [
          {
            optionId: await optionId("flight_timing", "early_morning"),
            polarity: "avoid",
          },
        ],
      });

      expect((await readFacet(client.id, "airline")).prefer).toEqual([
        "Singapore Airlines",
      ]);
      expect((await readFacet(client.id, "loyalty_programme")).prefer).toEqual([
        "Singapore KrisFlyer",
      ]);
      expect((await readFacet(client.id, "seat_preference")).prefer).toEqual([
        "Aisle Seat",
      ]);
      expect((await readFacet(client.id, "flight_timing")).avoid).toEqual([
        "Early Morning",
      ]);
    });

    /**
     * A loyalty programme is a membership the client holds, not a taste, so the
     * number and the tier are their own fields rather than a sentence in the
     * note. A client holds several at once, one row each.
     */
    it("records the membership number and tier for every programme a client holds", async () => {
      const client = await makeClient();

      await setPreferences({
        customerId: client.id,
        kind: "loyalty_programme",
        selections: [
          {
            optionId: await optionId("loyalty_programme", "singapore_krisflyer"),
            polarity: "prefer",
            membershipNumber: "KF 1234 5678",
            membershipTier: "PPS Club",
          },
          {
            optionId: await optionId("loyalty_programme", "marriott_bonvoy"),
            polarity: "prefer",
            membershipNumber: "600123456",
            membershipTier: "Titanium",
            note: "Suite upgrades usually honoured.",
          },
          {
            optionId: await optionId("loyalty_programme", "hilton_honors"),
            polarity: "wishlist",
          },
        ],
      });

      const record = await getClient360(client.id);
      const held = record?.preferences.filter(
        (row) => row.kind === "loyalty_programme",
      );

      expect(held).toHaveLength(3);
      expect(held?.find((row) => row.label === "Singapore KrisFlyer")).toMatchObject({
        membershipNumber: "KF 1234 5678",
        membershipTier: "PPS Club",
      });
      expect(held?.find((row) => row.label === "Marriott Bonvoy")).toMatchObject({
        membershipNumber: "600123456",
        membershipTier: "Titanium",
        note: "Suite upgrades usually honoured.",
      });
      // A programme they want but have not joined carries neither.
      expect(held?.find((row) => row.label === "Hilton Honors")).toMatchObject({
        membershipNumber: null,
        membershipTier: null,
      });
    });

    it("finds the client from a membership number, however it is written", async () => {
      const client = await makeClient("Memberful");
      await makeClient("Unrelated");

      await setPreferences({
        customerId: client.id,
        kind: "loyalty_programme",
        selections: [
          {
            optionId: await optionId("loyalty_programme", "marriott_bonvoy"),
            polarity: "prefer",
            membershipNumber: "600 123-456",
          },
        ],
      });

      for (const term of ["600 123-456", "600123456", "123456"]) {
        const { rows } = await searchClients({ q: term });
        expect(rows.map((row) => row.firstName), term).toEqual(["Memberful"]);
      }
    });

    it.each([
      ["economy"],
      ["premium_economy"],
      ["business"],
      ["first"],
      ["private"],
    ] as const)("records preferred cabin %s", async (flightCabin) => {
      const client = await makeClient(`Cabin ${flightCabin}`);
      await updatePreferenceProfile({ customerId: client.id, flightCabin });

      const record = await getClient360(client.id);
      expect(record?.profile?.flightCabin).toBe(flightCabin);
    });

    it.each([["always_direct"], ["prefer_direct"], ["no_preference"]] as const)(
      "records direct flight preference %s",
      async (flightDirectPreference) => {
        const client = await makeClient(`Direct ${flightDirectPreference}`);
        await updatePreferenceProfile({
          customerId: client.id,
          flightDirectPreference,
        });

        const record = await getClient360(client.id);
        expect(record?.profile?.flightDirectPreference).toBe(
          flightDirectPreference,
        );
      },
    );
  });

  describe("dining", () => {
    it.each([
      ["no_restriction"],
      ["vegetarian"],
      ["vegan"],
      ["jain"],
      ["halal"],
      ["kosher"],
      ["pescatarian"],
      ["gluten_free"],
      ["other"],
    ] as const)("records dietary preference %s", async (diningDietary) => {
      const client = await makeClient(`Diet ${diningDietary}`);
      await updatePreferenceProfile({ customerId: client.id, diningDietary });

      const record = await getClient360(client.id);
      expect(record?.profile?.diningDietary).toBe(diningDietary);
    });

    it("records allergies and restrictions with severity notes", async () => {
      const client = await makeClient();
      await setPreferences({
        customerId: client.id,
        kind: "allergy",
        selections: [
          {
            optionId: await optionId("allergy", "shellfish"),
            polarity: "avoid",
            note: "Severe. Must be flagged to every property.",
          },
          { optionId: await optionId("allergy", "tree_nuts"), polarity: "avoid" },
        ],
      });

      const record = await getClient360(client.id);
      const shellfish = record?.preferences.find((p) => p.label === "Shellfish");
      expect(shellfish?.polarity).toBe("avoid");
      expect(shellfish?.note).toBe("Severe. Must be flagged to every property.");
      expect((await readFacet(client.id, "allergy")).avoid).toHaveLength(2);
    });

    it("records favourite cuisines, restaurants and bar preferences", async () => {
      const client = await makeClient();
      const restaurant = await createPreferenceOption({
        kind: "restaurant",
        label: "Sukiyabashi Jiro",
      });

      await setPreferences({
        customerId: client.id,
        kind: "cuisine",
        selections: [
          { optionId: await optionId("cuisine", "japanese"), polarity: "prefer" },
          { optionId: await optionId("cuisine", "french"), polarity: "prefer" },
        ],
      });
      await setPreferences({
        customerId: client.id,
        kind: "restaurant",
        selections: [{ optionId: restaurant.id, polarity: "prefer" }],
      });
      await setPreferences({
        customerId: client.id,
        kind: "beverage_preference",
        selections: [
          {
            optionId: await optionId("beverage_preference", "single_malt_whisky"),
            polarity: "prefer",
          },
        ],
      });

      expect((await readFacet(client.id, "cuisine")).prefer.sort()).toEqual([
        "French",
        "Japanese",
      ]);
      expect((await readFacet(client.id, "restaurant")).prefer).toEqual([
        "Sukiyabashi Jiro",
      ]);
      expect(
        (await readFacet(client.id, "beverage_preference")).prefer,
      ).toEqual(["Single Malt Whisky"]);
    });

    it.each([["essential"], ["enjoys"], ["occasional"], ["prefers_casual"]] as const)(
      "records fine dining preference %s",
      async (diningFineDining) => {
        const client = await makeClient(`Fine ${diningFineDining}`);
        await updatePreferenceProfile({
          customerId: client.id,
          diningFineDining,
        });

        const record = await getClient360(client.id);
        expect(record?.profile?.diningFineDining).toBe(diningFineDining);
      },
    );
  });

  describe("lifestyle and experiences", () => {
    it("records interests, activities and luxury brands", async () => {
      const client = await makeClient();

      await setPreferences({
        customerId: client.id,
        kind: "interest",
        selections: [
          { optionId: await optionId("interest", "art"), polarity: "prefer" },
        ],
      });
      await setPreferences({
        customerId: client.id,
        kind: "activity",
        selections: [
          {
            optionId: await optionId("activity", "private_guided_tours"),
            polarity: "prefer",
          },
          {
            optionId: await optionId("activity", "skiing"),
            polarity: "avoid",
          },
        ],
      });
      await setPreferences({
        customerId: client.id,
        kind: "luxury_brand",
        selections: [
          { optionId: await optionId("luxury_brand", "hermes"), polarity: "prefer" },
        ],
      });

      expect((await readFacet(client.id, "interest")).prefer).toEqual(["Art"]);
      const activities = await readFacet(client.id, "activity");
      expect(activities.prefer).toEqual(["Private Guided Tours"]);
      expect(activities.avoid).toEqual(["Skiing"]);
      expect((await readFacet(client.id, "luxury_brand")).prefer).toEqual([
        "Hermes",
      ]);
    });

    it.each([
      ["private_bespoke"],
      ["small_group"],
      ["exclusive_access"],
      ["off_the_beaten_path"],
      ["classic_highlights"],
      ["relaxed_unstructured"],
    ] as const)(
      "records preferred experience style %s",
      async (lifestyleExperienceStyle) => {
        const client = await makeClient(`Style ${lifestyleExperienceStyle}`);
        await updatePreferenceProfile({
          customerId: client.id,
          lifestyleExperienceStyle,
        });

        const record = await getClient360(client.id);
        expect(record?.profile?.lifestyleExperienceStyle).toBe(
          lifestyleExperienceStyle,
        );
      },
    );
  });

  describe("travel behaviour", () => {
    it("records every documented behaviour field in one save", async () => {
      const client = await makeClient();

      await updatePreferenceProfile({
        customerId: client.id,
        travelTypicalTripNights: 7,
        travelParty: "couple",
        travelFrequency: "three_to_four_per_year",
        travelBudgetRange: "25l_50l",
        travelBookingLeadTime: "three_to_six_months",
        travelNotes: "Prefers to lock dates early, flexible on destination.",
      });

      const record = await getClient360(client.id);
      expect(record?.profile).toMatchObject({
        travelTypicalTripNights: 7,
        travelParty: "couple",
        travelFrequency: "three_to_four_per_year",
        travelBudgetRange: "25l_50l",
        travelBookingLeadTime: "three_to_six_months",
        travelNotes: "Prefers to lock dates early, flexible on destination.",
      });
    });

    it.each([
      ["solo"],
      ["couple"],
      ["family_young_children"],
      ["family_teens"],
      ["multi_generational"],
      ["friends"],
      ["business"],
    ] as const)("records travelling party %s", async (travelParty) => {
      const client = await makeClient(`Party ${travelParty}`);
      await updatePreferenceProfile({ customerId: client.id, travelParty });

      const record = await getClient360(client.id);
      expect(record?.profile?.travelParty).toBe(travelParty);
    });

    it.each([
      ["upto_5l"],
      ["5l_10l"],
      ["10l_25l"],
      ["25l_50l"],
      ["50l_plus"],
      ["no_ceiling"],
    ] as const)("records budget range %s", async (travelBudgetRange) => {
      const client = await makeClient(`Budget ${travelBudgetRange}`);
      await updatePreferenceProfile({
        customerId: client.id,
        travelBudgetRange,
      });

      const record = await getClient360(client.id);
      expect(record?.profile?.travelBudgetRange).toBe(travelBudgetRange);
    });

    it.each([
      ["last_minute"],
      ["under_1_month"],
      ["one_to_three_months"],
      ["three_to_six_months"],
      ["six_months_plus"],
    ] as const)("records booking lead time %s", async (travelBookingLeadTime) => {
      const client = await makeClient(`Lead ${travelBookingLeadTime}`);
      await updatePreferenceProfile({
        customerId: client.id,
        travelBookingLeadTime,
      });

      const record = await getClient360(client.id);
      expect(record?.profile?.travelBookingLeadTime).toBe(travelBookingLeadTime);
    });

    it("updates one section without clearing the others", async () => {
      const client = await makeClient();
      await updatePreferenceProfile({
        customerId: client.id,
        travelNotes: "Travel note",
      });
      await updatePreferenceProfile({
        customerId: client.id,
        diningNotes: "Dining note",
      });

      const record = await getClient360(client.id);
      expect(record?.profile?.travelNotes).toBe("Travel note");
      expect(record?.profile?.diningNotes).toBe("Dining note");
    });
  });

  describe("extending the catalogue at runtime", () => {
    it("adds a new option ops typed in", async () => {
      const created = await createPreferenceOption({
        kind: "hotel_brand",
        label: "Nihi Hotels",
      });

      expect(created.slug).toBe("nihi_hotels");
      expect(created.isCustom).toBe(true);

      const brands = (await listOptionsByKind("hotel_brand")).map((o) => o.label);
      expect(brands).toContain("Nihi Hotels");
    });

    it("returns the existing option instead of creating a near-duplicate", async () => {
      const first = await createPreferenceOption({
        kind: "hotel_brand",
        label: "Nihi Hotels",
      });
      const second = await createPreferenceOption({
        kind: "hotel_brand",
        label: "nihi hotels",
      });

      expect(second.id).toBe(first.id);
    });

    it("keeps the same label distinct across different facets", async () => {
      const brand = await createPreferenceOption({
        kind: "hotel_brand",
        label: "Aman Tokyo",
      });
      const property = await createPreferenceOption({
        kind: "hotel_property",
        label: "Aman Tokyo",
      });

      expect(brand.id).not.toBe(property.id);
    });
  });
});
