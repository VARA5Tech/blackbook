import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createCustomer,
  getClient360,
  updateClientDna,
} from "@/services/client-service";
import {
  actingAs,
  resetData,
  seedCatalogue,
  seedStaff,
  type StaffFixtures,
} from "./helpers";

/**
 * Requirements document, section 7: IMPORTANT NOTES / CLIENT DNA.
 *
 * A free-text "Know Me" section, plus two separate DO and DON'T fields for
 * critical preferences and deal-breakers.
 */
describe("client DNA", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
  });

  async function makeClient() {
    return createCustomer({ firstName: "Rishabh", customerSince: "2026-01-01" });
  }

  function directives(record: Awaited<ReturnType<typeof getClient360>>) {
    return {
      dos: record?.customer.dos ?? [],
      donts: record?.customer.donts ?? [],
    };
  }

  it("stores the free-text narrative verbatim, including line breaks", async () => {
    const client = await makeClient();
    const text =
      "Doesn't like large resorts.\nAlways prefers boutique properties.\nLoves Japanese food.";

    await updateClientDna({ customerId: client.id, clientDna: text, dos: [], donts: [] });

    const record = await getClient360(client.id);
    expect(record?.customer.clientDna).toBe(text);
  });

  it("keeps DO and DON'T as two separate lists", async () => {
    const client = await makeClient();

    await updateClientDna({
      customerId: client.id,
      clientDna: "Appreciates intimate properties.",
      dos: [
        "Boutique hotels",
        "Direct flights",
        "Personal service",
      ],
      donts: ["Large resorts", "Early departures", "Tourist-trap dining"],
    });

    const record = await getClient360(client.id);
    const { dos, donts } = directives(record);

    expect(dos).toEqual(["Boutique hotels", "Direct flights", "Personal service"]);
    expect(donts).toEqual([
      "Large resorts",
      "Early departures",
      "Tourist-trap dining",
    ]);
  });

  it("preserves the order the ops team entered", async () => {
    const client = await makeClient();
    await updateClientDna({
      customerId: client.id,
      clientDna: null,
      dos: ["First", "Second", "Third", "Fourth"],
      donts: [],
    });

    const record = await getClient360(client.id);
    expect(directives(record).dos).toEqual([
      "First",
      "Second",
      "Third",
      "Fourth",
    ]);
  });

  it("replaces the lists on save rather than appending", async () => {
    const client = await makeClient();

    await updateClientDna({
      customerId: client.id,
      clientDna: null,
      dos: ["Old one", "Old two"],
      donts: ["Old avoid"],
    });
    await updateClientDna({
      customerId: client.id,
      clientDna: null,
      dos: ["New one"],
      donts: [],
    });

    const record = await getClient360(client.id);
    const { dos, donts } = directives(record);
    expect(dos).toEqual(["New one"]);
    expect(donts).toEqual([]);
  });

  it("drops blank entries rather than storing empty rows", async () => {
    const client = await makeClient();
    await updateClientDna({
      customerId: client.id,
      clientDna: null,
      dos: ["Real entry", "   ", ""],
      donts: [""],
    });

    const record = await getClient360(client.id);
    const { dos, donts } = directives(record);
    expect(dos).toEqual(["Real entry"]);
    expect(donts).toEqual([]);
  });

  it("allows a narrative with no lists, and lists with no narrative", async () => {
    const narrativeOnly = await makeClient();
    await updateClientDna({
      customerId: narrativeOnly.id,
      clientDna: "Just the nuance, no rules yet.",
      dos: [],
      donts: [],
    });

    const listsOnly = await createCustomer({
      firstName: "Lists",
      customerSince: "2026-01-01",
    });
    await updateClientDna({
      customerId: listsOnly.id,
      clientDna: null,
      dos: ["Aisle seat on long-haul"],
      donts: [],
    });

    const first = await getClient360(narrativeOnly.id);
    expect(first?.customer.clientDna).toBe("Just the nuance, no rules yet.");
    expect(directives(first).dos).toEqual([]);

    const second = await getClient360(listsOnly.id);
    expect(second?.customer.clientDna).toBeNull();
    expect(directives(second).dos).toEqual(["Aisle seat on long-haul"]);
  });

  it("clears the narrative when saved empty", async () => {
    const client = await makeClient();
    await updateClientDna({
      customerId: client.id,
      clientDna: "Something",
      dos: [],
      donts: [],
    });
    await updateClientDna({
      customerId: client.id,
      clientDna: "",
      dos: [],
      donts: [],
    });

    const record = await getClient360(client.id);
    expect(record?.customer.clientDna).toBeNull();
  });

  it("records the edit on the client's history", async () => {
    const client = await makeClient();
    await updateClientDna({
      customerId: client.id,
      clientDna: "Noted",
      dos: [],
      donts: [],
    });

    const record = await getClient360(client.id);
    expect(record?.timeline.map((e) => e.summary)).toContain(
      "Client DNA updated",
    );
  });

  it("bumps the profile-updated date", async () => {
    const client = await makeClient();
    const before = (await getClient360(client.id))?.customer.profileUpdatedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));
    await updateClientDna({
      customerId: client.id,
      clientDna: "Later note",
      dos: [],
      donts: [],
    });

    const after = (await getClient360(client.id))?.customer.profileUpdatedAt;
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
  });

  it("keeps each household member's DNA separate", async () => {
    const one = await createCustomer({
      firstName: "One",
      customerSince: "2026-01-01",
    });
    const two = await createCustomer({
      firstName: "Two",
      customerSince: "2026-01-01",
    });

    await updateClientDna({
      customerId: one.id,
      clientDna: "One's nuance",
      dos: ["One do"],
      donts: [],
    });
    await updateClientDna({
      customerId: two.id,
      clientDna: "Two's nuance",
      dos: ["Two do"],
      donts: [],
    });

    const first = await getClient360(one.id);
    const second = await getClient360(two.id);

    expect(first?.customer.clientDna).toBe("One's nuance");
    expect(directives(first).dos).toEqual(["One do"]);
    expect(second?.customer.clientDna).toBe("Two's nuance");
    expect(directives(second).dos).toEqual(["Two do"]);
  });
});
