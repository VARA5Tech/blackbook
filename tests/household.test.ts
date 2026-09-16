import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { households } from "@/db/schema";
import {
  archiveCustomer,
  createCustomer,
  DomainError,
  getClient360,
} from "@/services/client-service";
import {
  addHouseholdMember,
  createHousehold,
  getHousehold,
  listHouseholdOptions,
  listHouseholds,
  removeHouseholdMember,
  updateHousehold,
} from "@/services/household-service";
import {
  actingAs,
  resetData,
  seedCatalogue,
  seedStaff,
  type StaffFixtures,
} from "./helpers";

/**
 * Requirements document, section 2: HOUSEHOLD PROFILE.
 *
 * "A household should be a separate entity from the individual customer" and
 * "manage the family as a unit while retaining individual preferences".
 */
describe("household profile", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
  });

  it("auto-generates a household ID in the documented HH-000NN form", async () => {
    const first = await createHousehold({ name: "Sharma Family" });
    const second = await createHousehold({ name: "Mehta Family" });

    expect(first.ref).toBe("HH-00100");
    expect(second.ref).toBe("HH-00101");
  });

  it("is a separate record that exists before it has any members", async () => {
    const household = await createHousehold({ name: "Empty Family" });
    const loaded = await getHousehold(household.id);

    expect(loaded?.household.name).toBe("Empty Family");
    expect(loaded?.members).toHaveLength(0);
  });

  it("stores every documented household field", async () => {
    const household = await createHousehold({
      name: "Sharma Family",
      city: "Delhi",
      travelPattern: "multi_generational",
      notes: "Travel as a couple for anniversaries, whole family in holidays.",
    });

    expect(household).toMatchObject({
      name: "Sharma Family",
      city: "Delhi",
      travelPattern: "multi_generational",
      notes: "Travel as a couple for anniversaries, whole family in holidays.",
    });
  });

  it("stores the household's executive assistant, and keeps it through a partial edit", async () => {
    const household = await createHousehold({
      name: "Sharma Family",
      eaName: "Rohan Desai",
      eaEmail: "Rohan@Example.com",
      eaPhone: "+91 99887 76655",
      eaNotes: "Handles every family booking.",
    });

    expect(household).toMatchObject({
      eaName: "Rohan Desai",
      eaEmail: "rohan@example.com",
      eaPhone: "+91 99887 76655",
      eaPhoneNormalized: "919988776655",
      eaNotes: "Handles every family booking.",
    });

    const updated = await updateHousehold({ id: household.id, city: "Delhi" });
    expect(updated).toMatchObject({ city: "Delhi", eaName: "Rohan Desai" });
  });

  it.each([["couple"], ["family"], ["multi_generational"]] as const)(
    "accepts the family travel pattern %s",
    async (travelPattern) => {
      const household = await createHousehold({
        name: `Pattern ${travelPattern}`,
        travelPattern,
      });
      expect(household.travelPattern).toBe(travelPattern);
    },
  );

  it("requires a household name", async () => {
    await expect(createHousehold({ name: "   " })).rejects.toThrow(ZodError);
  });

  describe("the documented example hierarchy", () => {
    /** HH-00125 with a primary client, a spouse and two children. */
    async function buildSharmaHousehold() {
      const household = await createHousehold({
        name: "Sharma Family",
        city: "Delhi",
        travelPattern: "family",
      });

      const rishabh = await createCustomer({
        firstName: "Rishabh",
        lastName: "Sharma",
        householdId: household.id,
        householdRole: "primary",
        customerSince: "2021-03-01",
      });
      const spouse = await createCustomer({
        firstName: "Neha",
        lastName: "Sharma",
        householdId: household.id,
        householdRole: "spouse",
        customerSince: "2021-03-01",
      });
      const child1 = await createCustomer({
        firstName: "Aarav",
        lastName: "Sharma",
        householdId: household.id,
        householdRole: "child",
        customerSince: "2021-03-01",
      });
      const child2 = await createCustomer({
        firstName: "Anaya",
        lastName: "Sharma",
        householdId: household.id,
        householdRole: "child",
        customerSince: "2021-03-01",
      });

      await updateHousehold({
        id: household.id,
        primaryCustomerId: rishabh.id,
      });

      return { household, rishabh, spouse, child1, child2 };
    }

    it("links four family members to one household", async () => {
      const { household } = await buildSharmaHousehold();
      const loaded = await getHousehold(household.id);

      expect(loaded?.members).toHaveLength(4);
      expect(loaded?.members.map((m) => m.firstName).sort()).toEqual([
        "Aarav",
        "Anaya",
        "Neha",
        "Rishabh",
      ]);
    });

    it("gives each member their own customer ID", async () => {
      const { rishabh, spouse, child1, child2 } = await buildSharmaHousehold();
      const refs = [rishabh.ref, spouse.ref, child1.ref, child2.ref];

      expect(new Set(refs).size).toBe(4);
      for (const ref of refs) expect(ref).toMatch(/^VARA-[1-9]\d{5}$/);
    });

    it("counts members correctly on the household list", async () => {
      await buildSharmaHousehold();
      const list = await listHouseholds();

      expect(list).toHaveLength(1);
      expect(list[0].memberCount).toBe(4);
      // No preferred name is set, so the full name is the display name.
      expect(list[0].primaryCustomerName).toBe("Rishabh Sharma");
    });

    it("shows the household from any member's own profile", async () => {
      const { household, child1 } = await buildSharmaHousehold();
      const record = await getClient360(child1.id);

      expect(record?.household?.id).toBe(household.id);
      expect(record?.householdMembers).toHaveLength(4);
    });

    it("keeps preferences individual, not merged into the household", async () => {
      const { rishabh, spouse } = await buildSharmaHousehold();

      const rishabhRecord = await getClient360(rishabh.id);
      const spouseRecord = await getClient360(spouse.id);

      expect(rishabhRecord?.customer.id).not.toBe(spouseRecord?.customer.id);
      expect(rishabhRecord?.preferences).toEqual([]);
      expect(spouseRecord?.preferences).toEqual([]);
    });
  });

  describe("membership rules", () => {
    it("links an existing unattached client into a household", async () => {
      const household = await createHousehold({ name: "Growing Family" });
      const client = await createCustomer({
        firstName: "Joiner",
        customerSince: "2026-01-01",
      });

      await addHouseholdMember({
        householdId: household.id,
        customerId: client.id,
        householdRole: "spouse",
      });

      const loaded = await getHousehold(household.id);
      expect(loaded?.members).toHaveLength(1);
      expect(loaded?.members[0].householdRole).toBe("spouse");
    });

    it("refuses to put one client in two households at once", async () => {
      const first = await createHousehold({ name: "First Family" });
      const second = await createHousehold({ name: "Second Family" });
      const client = await createCustomer({
        firstName: "Contested",
        householdId: first.id,
        customerSince: "2026-01-01",
      });

      await expect(
        addHouseholdMember({
          householdId: second.id,
          customerId: client.id,
          householdRole: "other",
        }),
      ).rejects.toThrow(DomainError);
    });

    it("allows the move once the client is removed from the first household", async () => {
      const first = await createHousehold({ name: "First Family" });
      const second = await createHousehold({ name: "Second Family" });
      const client = await createCustomer({
        firstName: "Moving",
        householdId: first.id,
        customerSince: "2026-01-01",
      });

      await removeHouseholdMember(first.id, client.id);
      await addHouseholdMember({
        householdId: second.id,
        customerId: client.id,
        householdRole: "spouse",
      });

      const loaded = await getHousehold(second.id);
      expect(loaded?.members).toHaveLength(1);
    });

    it("refuses to remove a client who is not in that household", async () => {
      const household = await createHousehold({ name: "Unrelated" });
      const client = await createCustomer({
        firstName: "Outsider",
        customerSince: "2026-01-01",
      });

      await expect(
        removeHouseholdMember(household.id, client.id),
      ).rejects.toThrow(DomainError);
    });

    it("refuses a primary client who is not a member", async () => {
      const household = await createHousehold({ name: "Strangers" });
      const outsider = await createCustomer({
        firstName: "Outsider",
        customerSince: "2026-01-01",
      });

      await expect(
        updateHousehold({ id: household.id, primaryCustomerId: outsider.id }),
      ).rejects.toThrow(DomainError);
    });

    it("clears the primary client when that member is removed", async () => {
      const household = await createHousehold({ name: "Losing Head" });
      const head = await createCustomer({
        firstName: "Head",
        householdId: household.id,
        customerSince: "2026-01-01",
      });
      await updateHousehold({ id: household.id, primaryCustomerId: head.id });

      await removeHouseholdMember(household.id, head.id);

      const after = await db.query.households.findFirst({
        where: eq(households.id, household.id),
      });
      expect(after?.primaryCustomerId).toBeNull();
    });

    it("clears the primary client when that member is archived", async () => {
      const household = await createHousehold({ name: "Archiving Head" });
      const head = await createCustomer({
        firstName: "Head",
        householdId: household.id,
        customerSince: "2026-01-01",
      });
      await updateHousehold({ id: household.id, primaryCustomerId: head.id });

      await archiveCustomer(head.id);

      const after = await db.query.households.findFirst({
        where: eq(households.id, household.id),
      });
      expect(after?.primaryCustomerId).toBeNull();
    });

    it("excludes archived members from the household view and count", async () => {
      const household = await createHousehold({ name: "Shrinking Family" });
      const staying = await createCustomer({
        firstName: "Staying",
        householdId: household.id,
        customerSince: "2026-01-01",
      });
      const leaving = await createCustomer({
        firstName: "Leaving",
        householdId: household.id,
        customerSince: "2026-01-01",
      });

      await archiveCustomer(leaving.id);

      const loaded = await getHousehold(household.id);
      expect(loaded?.members.map((m) => m.id)).toEqual([staying.id]);

      const list = await listHouseholds();
      expect(list[0].memberCount).toBe(1);
    });

    it("counts a household with no members as zero, not one", async () => {
      await createHousehold({ name: "Nobody Home" });
      const list = await listHouseholds();
      expect(list[0].memberCount).toBe(0);
    });
  });

  describe("household lookup", () => {
    beforeEach(async () => {
      await createHousehold({ name: "Sharma Family", city: "Delhi" });
      await createHousehold({ name: "Mehta Family", city: "Mumbai" });
    });

    it.each([
      ["sharma", "Sharma Family"],
      ["SHARMA", "Sharma Family"],
      ["mehta", "Mehta Family"],
      ["HH-00100", "Sharma Family"],
      ["delhi", "Sharma Family"],
    ])("finds a household by %s", async (term, expected) => {
      const results = await listHouseholds(term);
      expect(results.map((r) => r.name)).toContain(expected);
    });

    it("tolerates a misspelled household name", async () => {
      const results = await listHouseholds("Sharmaa");
      expect(results.map((r) => r.name)).toContain("Sharma Family");
    });

    it("returns nothing for a term that matches no household", async () => {
      const results = await listHouseholds("Khanna");
      expect(results).toHaveLength(0);
    });

    it("finds a household by its executive assistant's name or number", async () => {
      await createHousehold({
        name: "Kapoor Family",
        eaName: "Rohan Desai",
        eaPhone: "+91 99887 76655",
      });

      for (const term of ["rohan", "Desai", "76655"]) {
        const results = await listHouseholds(term);
        expect(results.map((r) => r.name), term).toEqual(["Kapoor Family"]);
      }
    });

    it("offers every household to the client form picker", async () => {
      const options = await listHouseholdOptions();
      expect(options.map((o) => o.name).sort()).toEqual([
        "Mehta Family",
        "Sharma Family",
      ]);
    });
  });
});
