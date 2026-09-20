import { eq, sql as sqlOp } from "drizzle-orm";
import { ZodError } from "zod";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { uuidv7 } from "@/domain/shared";
import { activityLog, customerPreferenceProfile, customers } from "@/db/schema";
import {
  CLIENT_SORT_DEFAULT_DIRECTION,
  executiveAssistantFor,
} from "@/domain/customers";
import {
  archiveCustomer,
  createCustomer,
  DomainError,
  eraseCustomer,
  getClient360,
  restoreCustomer,
  reassignClients,
  searchClients,
  updateCustomer,
} from "@/services/client-service";
import { createHousehold } from "@/services/household-service";
import {
  actingAs,
  resetData,
  seedCatalogue,
  seedStaff,
  type StaffFixtures,
} from "./helpers";

/**
 * Requirements document, section 1: CUSTOMER MASTER.
 */
describe("customer master", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
  });

  describe("unique customer ID", () => {
    it("is auto-generated as VARA and six digits", async () => {
      const created = await createCustomer({
        firstName: "Rishabh",
        customerSince: "2021-03-01",
      });
      expect(created.ref).toMatch(/^VARA-[1-9]\d{5}$/);
    });

    /**
     * Drawn at random, never counted. A counted reference would publish how many
     * clients Vara5 has and let anyone walk the list by adding one, and this is
     * the number a client reads out and will one day type to sign in.
     */
    it("does not count up, so one reference never reveals the next", async () => {
      const refs: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const created = await createCustomer({
          firstName: `Client${i}`,
          customerSince: "2026-01-01",
        });
        refs.push(created.ref);
      }

      expect(new Set(refs).size).toBe(5);
      const numbers = refs.map((ref) => Number(ref.slice("VARA-".length)));
      expect(numbers.some((number, index) => index > 0 && number !== numbers[index - 1] + 1)).toBe(true);
    });

    /** Numbers a stranger would try first are never issued. */
    it("never issues an obvious number", async () => {
      const refs: string[] = [];
      for (let i = 0; i < 20; i += 1) {
        const created = await createCustomer({
          firstName: `Pattern${i}`,
          customerSince: "2026-01-01",
        });
        refs.push(created.ref.slice("VARA-".length));
      }

      for (const digits of refs) {
        expect(digits, digits).not.toMatch(/^(.)\1{5}$/);
        expect(digits, digits).not.toMatch(/^(..)\1{2}$/);
        expect(digits, digits).not.toMatch(/^(...)\1$/);
        expect(["123456", "234567", "654321", "543210"], digits).not.toContain(digits);
      }
    });

    it("stays unique when clients are created concurrently", async () => {
      const created = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          createCustomer({
            firstName: `Concurrent${i}`,
            customerSince: "2026-01-01",
          }),
        ),
      );
      const refs = created.map((row) => row.ref);
      expect(new Set(refs).size).toBe(8);
    });

    /**
     * Households are still counted, and the sequence is nowhere near this in a
     * test, so the formatter is asked directly. The old default padded with
     * lpad(n, 5), which truncates, and would have turned household 100,000 into
     * a duplicate of household 10,000.
     */
    it("widens a household reference past 99,999 instead of colliding", async () => {
      const [row] = await db.execute<{
        small: string;
        last: string;
        next: string;
      }>(sqlOp`select
        vara5_ref('HH-', 7) as small,
        vara5_ref('HH-', 99999) as last,
        vara5_ref('HH-', 100000) as next`);

      expect(row).toEqual({
        small: "HH-00007",
        last: "HH-99999",
        next: "HH-100000",
      });
    });

    it("keys new clients and households with time-ordered UUIDv7s", async () => {
      const earlier = await createCustomer({
        firstName: "Earlier",
        customerSince: "2026-01-01",
      });
      const household = await createHousehold({ name: "Later Family", city: "Delhi" });
      const later = await createCustomer({
        firstName: "Later",
        customerSince: "2026-01-01",
      });

      // The version is the first digit of the third group.
      for (const id of [earlier.id, household.id, later.id]) {
        expect(id[14]).toBe("7");
      }

      // The first 48 bits are milliseconds since the epoch, so a key minted
      // later never sorts before one minted earlier.
      const millis = (id: string) => id.replace(/-/g, "").slice(0, 12);
      expect(millis(later.id) >= millis(earlier.id)).toBe(true);
    });

    /**
     * Staff accounts and Better Auth's sessions get their keys in TypeScript,
     * so the generator there has to agree with vara5_uuid_v7() in the database.
     */
    it("mints the same kind of key in application code", () => {
      const at = Date.UTC(2026, 8, 14, 12, 0, 0);
      const id = uuidv7(at);

      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      // The first 48 bits read back as the moment it was minted.
      expect(Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(at);
      expect(uuidv7(at + 1) > uuidv7(at)).toBe(true);
    });
  });

  describe("every documented field round-trips", () => {
    it("stores the whole customer master record", async () => {
      const household = await createHousehold({ name: "Sharma Family" });

      const created = await createCustomer({
        householdId: household.id,
        householdRole: "primary",
        firstName: "Rishabh",
        lastName: "Sharma",
        preferredName: "Rishabh",
        mobile: "+91 98100 11223",
        whatsapp: "+91 98100 99887",
        email: "Rishabh.Sharma@Example.com",
        dateOfBirth: "1982-04-18",
        gender: "male",
        nationality: "IN",
        city: "Delhi",
        address: "12 Amrita Shergill Marg, New Delhi",
        locationUrl: "https://maps.app.goo.gl/example",
        primaryRmId: staff.rm.id,
        customerSince: "2021-03-01",
        status: "active",
      });

      expect(created).toMatchObject({
        householdId: household.id,
        householdRole: "primary",
        firstName: "Rishabh",
        lastName: "Sharma",
        preferredName: "Rishabh",
        mobile: "+91 98100 11223",
        whatsapp: "+91 98100 99887",
        dateOfBirth: "1982-04-18",
        gender: "male",
        nationality: "IN",
        city: "Delhi",
        address: "12 Amrita Shergill Marg, New Delhi",
        locationUrl: "https://maps.app.goo.gl/example",
        primaryRmId: staff.rm.id,
        customerSince: "2021-03-01",
        status: "active",
      });
      // Email is normalised so a search or a duplicate check is case-blind.
      expect(created.email).toBe("rishabh.sharma@example.com");
    });

    it.each([
      ["male"],
      ["female"],
      ["other"],
      ["prefer_not_to_say"],
    ] as const)("accepts gender %s", async (gender) => {
      const created = await createCustomer({
        firstName: "Gendered",
        gender,
        customerSince: "2026-01-01",
      });
      expect(created.gender).toBe(gender);
    });

    it.each([["active"], ["inactive"]] as const)(
      "accepts client status %s",
      async (status) => {
        const created = await createCustomer({
          firstName: "Statused",
          status,
          customerSince: "2026-01-01",
        });
        expect(created.status).toBe(status);
      },
    );

    it("defaults status to active when not supplied", async () => {
      const created = await createCustomer({
        firstName: "Defaulted",
        customerSince: "2026-01-01",
      });
      expect(created.status).toBe("active");
    });

    it("treats an empty optional field as not recorded rather than empty text", async () => {
      const created = await createCustomer({
        firstName: "Sparse",
        lastName: "",
        email: "",
        mobile: "",
        city: "",
        dateOfBirth: "",
        customerSince: "2026-01-01",
      });
      expect(created.lastName).toBeNull();
      expect(created.email).toBeNull();
      expect(created.mobile).toBeNull();
      expect(created.city).toBeNull();
      expect(created.dateOfBirth).toBeNull();
    });

    it("opens a preference profile row with the client", async () => {
      const created = await createCustomer({
        firstName: "Profiled",
        customerSince: "2026-01-01",
      });
      const profile = await db.query.customerPreferenceProfile.findFirst({
        where: eq(customerPreferenceProfile.customerId, created.id),
      });
      expect(profile).toBeDefined();
    });
  });

  describe("validation", () => {
    it("requires a first name", async () => {
      await expect(
        createCustomer({ firstName: "  ", customerSince: "2026-01-01" }),
      ).rejects.toThrow(ZodError);
    });

    it("requires a client-since date", async () => {
      await expect(
        createCustomer({ firstName: "NoDate" } as never),
      ).rejects.toThrow(ZodError);
    });

    it.each([
      ["not-an-email"],
      ["missing@"],
      ["@missing.com"],
    ])("rejects the invalid email %s", async (email) => {
      await expect(
        createCustomer({
          firstName: "BadEmail",
          email,
          customerSince: "2026-01-01",
        }),
      ).rejects.toThrow(ZodError);
    });

    it.each([["abc"], ["12"], ["+"]])(
      "rejects the implausible phone number %s",
      async (mobile) => {
        await expect(
          createCustomer({
            firstName: "BadPhone",
            mobile,
            customerSince: "2026-01-01",
          }),
        ).rejects.toThrow(ZodError);
      },
    );

    /**
     * A number without its country code is refused rather than guessed at.
     * "65 8123 4567" is ten digits, an Indian mobile's length, so assuming +91
     * would file a Singapore client's number as someone else's.
     */
    it.each([["98100 11223"], ["919810011223"], ["09810011223"], ["65 8123 4567"]])(
      "refuses the number %s without its country code",
      async (mobile) => {
        await expect(
          createCustomer({
            firstName: "NoCountry",
            mobile,
            customerSince: "2026-01-01",
          }),
        ).rejects.toThrow(/country code/);
      },
    );

    it.each([
      ["+91-98100-11223", "+91 98100 11223"],
      ["+6581234567", "+65 8123 4567"],
      ["+1 (415) 555-0123", "+1 415 555 0123"],
    ])("stores %s in international format as %s", async (mobile, stored) => {
      const created = await createCustomer({
        firstName: "Formatted",
        mobile,
        customerSince: "2026-01-01",
      });
      expect(created.mobile).toBe(stored);
    });

    it.each([["18-04-1982"], ["1982/04/18"], ["April 18 1982"]])(
      "rejects the malformed date of birth %s",
      async (dateOfBirth) => {
        await expect(
          createCustomer({
            firstName: "BadDate",
            dateOfBirth,
            customerSince: "2026-01-01",
          }),
        ).rejects.toThrow(ZodError);
      },
    );

    it("rejects a household that does not exist", async () => {
      await expect(
        createCustomer({
          firstName: "Orphan",
          householdId: "00000000-0000-4000-8000-000000000000",
          customerSince: "2026-01-01",
        }),
      ).rejects.toThrow(DomainError);
    });
  });

  describe("duplicate detection on phone numbers", () => {
    beforeEach(async () => {
      await createCustomer({
        firstName: "Rishabh",
        lastName: "Sharma",
        mobile: "+91 98100 11223",
        customerSince: "2021-03-01",
      });
    });

    it.each([
      ["+91 98100 11223"],
      ["+919810011223"],
      ["+91-98100-11223"],
      ["+91 (98100) 11223"],
      ["+91.98100.11223"],
    ])("catches the duplicate written as %s", async (mobile) => {
      await expect(
        createCustomer({
          firstName: "Impostor",
          mobile,
          customerSince: "2026-01-01",
        }),
      ).rejects.toThrow(DomainError);
    });

    it("names the existing client in the error, so ops can go and look", async () => {
      await expect(
        createCustomer({
          firstName: "Impostor",
          mobile: "+919810011223",
          customerSince: "2026-01-01",
        }),
      ).rejects.toThrow(/Rishabh Sharma \(VARA-\d{6}\)/);
    });

    it("catches a number reused as a WhatsApp number", async () => {
      await expect(
        createCustomer({
          firstName: "Impostor",
          whatsapp: "+91 98100 11223",
          customerSince: "2026-01-01",
        }),
      ).rejects.toThrow(DomainError);
    });

    it("allows a genuinely different number", async () => {
      const created = await createCustomer({
        firstName: "Different",
        mobile: "+91 99200 55667",
        customerSince: "2026-01-01",
      });
      expect(created.ref).toMatch(/^VARA-[1-9]\d{5}$/);
    });

    it("frees the number once the original client is archived", async () => {
      const [original] = await db
        .select()
        .from(customers)
        .where(eq(customers.firstName, "Rishabh"));
      await archiveCustomer(original.id);

      const reused = await createCustomer({
        firstName: "Successor",
        mobile: "+91 98100 11223",
        customerSince: "2026-01-01",
      });
      expect(reused.mobile).toBe("+91 98100 11223");
    });

    it("refuses to restore an archived client whose number was taken meanwhile", async () => {
      const [original] = await db
        .select()
        .from(customers)
        .where(eq(customers.firstName, "Rishabh"));
      await archiveCustomer(original.id);
      await createCustomer({
        firstName: "Successor",
        mobile: "+91 98100 11223",
        customerSince: "2026-01-01",
      });

      await expect(restoreCustomer(original.id)).rejects.toThrow(DomainError);
    });

    it("does not blank fields the edit form did not submit", async () => {
      const [original] = await db
        .select()
        .from(customers)
        .where(eq(customers.firstName, "Rishabh"));

      await updateCustomer({
        id: original.id,
        email: "rishabh@example.com",
        city: "Delhi",
        preferredName: "Rish",
      });

      // A later edit that only touches the city must leave the rest alone.
      const updated = await updateCustomer({
        id: original.id,
        city: "Gurgaon",
      });

      expect(updated.city).toBe("Gurgaon");
      expect(updated.email).toBe("rishabh@example.com");
      expect(updated.preferredName).toBe("Rish");
      expect(updated.lastName).toBe("Sharma");
      expect(updated.mobile).toBe("+91 98100 11223");
    });

    it("still clears a field that was explicitly submitted empty", async () => {
      const [original] = await db
        .select()
        .from(customers)
        .where(eq(customers.firstName, "Rishabh"));

      await updateCustomer({ id: original.id, city: "Delhi" });
      const cleared = await updateCustomer({ id: original.id, city: "" });

      expect(cleared.city).toBeNull();
    });

    it("lets a client keep their own number when edited", async () => {
      const [original] = await db
        .select()
        .from(customers)
        .where(eq(customers.firstName, "Rishabh"));

      const updated = await updateCustomer({
        id: original.id,
        mobile: "+91 98100 11223",
        city: "Gurgaon",
      });
      expect(updated.city).toBe("Gurgaon");
    });
  });

  describe("household link", () => {
    it("connects the client to a household and reads back on the profile", async () => {
      const household = await createHousehold({ name: "Sharma Family" });
      const created = await createCustomer({
        firstName: "Rishabh",
        householdId: household.id,
        householdRole: "primary",
        customerSince: "2021-03-01",
      });

      const record = await getClient360(created.id);
      expect(record?.household?.ref).toMatch(/^HH-\d{5}$/);
      expect(record?.household?.name).toBe("Sharma Family");
    });

    it.each([
      ["primary"],
      ["spouse"],
      ["partner"],
      ["child"],
      ["parent"],
      ["sibling"],
      ["other"],
    ] as const)("accepts the household role %s", async (householdRole) => {
      const household = await createHousehold({ name: "Roles" });
      const created = await createCustomer({
        firstName: "Member",
        householdId: household.id,
        householdRole,
        customerSince: "2026-01-01",
      });
      expect(created.householdRole).toBe(householdRole);
    });
  });

  describe("customer since and status lifecycle", () => {
    it("records the supplied client-since date rather than today", async () => {
      const created = await createCustomer({
        firstName: "Longstanding",
        customerSince: "2018-07-04",
      });
      expect(created.customerSince).toBe("2018-07-04");
    });

    it("marks an archived client inactive and keeps the row", async () => {
      const created = await createCustomer({
        firstName: "Leaving",
        customerSince: "2026-01-01",
      });
      const archived = await archiveCustomer(created.id);

      expect(archived.archivedAt).toBeInstanceOf(Date);
      expect(archived.status).toBe("inactive");

      const stillThere = await db.query.customers.findFirst({
        where: eq(customers.id, created.id),
      });
      expect(stillThere).toBeDefined();
    });

    it("erases a client permanently, once archived", async () => {
      const created = await createCustomer({
        firstName: "Forgotten",
        mobile: "+91 90000 00009",
        customerSince: "2026-01-01",
      });
      await archiveCustomer(created.id);

      const { ref } = await eraseCustomer(
        created.id,
        "Client exercised their right to erasure",
      );
      expect(ref).toBe(created.ref);

      const gone = await db.query.customers.findFirst({
        where: eq(customers.id, created.id),
      });
      expect(gone).toBeUndefined();
    });

    it("refuses to erase a client that is not archived first", async () => {
      const created = await createCustomer({
        firstName: "Active",
        customerSince: "2026-01-01",
      });
      await expect(
        eraseCustomer(created.id, "Client exercised their right to erasure"),
      ).rejects.toThrow(DomainError);
    });

    it("requires a recorded reason for an erasure", async () => {
      const created = await createCustomer({
        firstName: "Unjustified",
        customerSince: "2026-01-01",
      });
      await archiveCustomer(created.id);

      await expect(eraseCustomer(created.id, "oops")).rejects.toThrow(
        DomainError,
      );
    });

    it("keeps the record that an erasure happened, with its reason", async () => {
      const created = await createCustomer({
        firstName: "Forgotten",
        customerSince: "2026-01-01",
      });
      await archiveCustomer(created.id);
      await eraseCustomer(created.id, "Client exercised their right to erasure");

      const [row] = await db
        .select()
        .from(activityLog)
        .where(
          sqlOp`${activityLog.summary} like ${"%permanently erased%"}`,
        );

      expect(row.summary).toContain(created.ref);
      expect(row.summary).toContain("right to erasure");
      // The reference is cleared as the client row goes; the entry survives.
      expect(row.customerId).toBeNull();
    });

    it("frees the erased client's phone number", async () => {
      const created = await createCustomer({
        firstName: "Recycled",
        mobile: "+91 90000 00010",
        customerSince: "2026-01-01",
      });
      await archiveCustomer(created.id);
      await eraseCustomer(created.id, "Client exercised their right to erasure");

      const reused = await createCustomer({
        firstName: "Successor",
        mobile: "+91 90000 00010",
        customerSince: "2026-01-01",
      });
      expect(reused.mobile).toBe("+91 90000 00010");
    });

    it("returns an archived client to active on restore", async () => {
      const created = await createCustomer({
        firstName: "Returning",
        customerSince: "2026-01-01",
      });
      await archiveCustomer(created.id);
      const restored = await restoreCustomer(created.id);

      expect(restored.archivedAt).toBeNull();
      expect(restored.status).toBe("active");
    });
  });

  /**
   * Some clients are only ever reached through an executive assistant, so the
   * team needs the assistant on the record and must find the client by them.
   */
  /** The catch-all box, for anything that belongs nowhere else on the record. */
  describe("remarks", () => {
    it("stores remarks and keeps them through an edit that does not send them", async () => {
      const created = await createCustomer({
        firstName: "Remarked",
        customerSince: "2026-01-01",
        remarks: "Prefers to be called after 6pm.\nNever books in monsoon.",
      });
      expect(created.remarks).toBe(
        "Prefers to be called after 6pm.\nNever books in monsoon.",
      );

      const updated = await updateCustomer({ id: created.id, city: "Mumbai" });
      expect(updated.remarks).toBe(
        "Prefers to be called after 6pm.\nNever books in monsoon.",
      );

      const cleared = await updateCustomer({ id: created.id, remarks: "" });
      expect(cleared.remarks).toBeNull();
    });
  });

  describe("executive assistant", () => {
    const since = "2026-01-01";
    const assistant = {
      eaName: "Priya Kapoor",
      eaEmail: "Priya.Kapoor@Example.com",
      eaPhone: "+91 98111 22334",
      eaNotes: "Call between 10 and 6. Copy her on every itinerary.",
    };

    it("stores the assistant a client is reached through", async () => {
      const created = await createCustomer({ firstName: "Ananya", customerSince: since, ...assistant });

      expect(created).toMatchObject({
        eaName: "Priya Kapoor",
        eaEmail: "priya.kapoor@example.com",
        eaPhone: "+91 98111 22334",
        eaPhoneNormalized: "919811122334",
        eaNotes: "Call between 10 and 6. Copy her on every itinerary.",
      });
    });

    it("keeps the assistant when an edit does not send those fields", async () => {
      const created = await createCustomer({ firstName: "Ananya", customerSince: since, ...assistant });
      const updated = await updateCustomer({ id: created.id, city: "Mumbai" });
      expect(updated.eaName).toBe("Priya Kapoor");
      expect(updated.eaPhone).toBe("+91 98111 22334");
    });

    it("lets one assistant look after several clients without a duplicate warning", async () => {
      await createCustomer({ firstName: "One", customerSince: since, eaPhone: "+91 98111 22334" });
      await expect(
        createCustomer({ firstName: "Two", customerSince: since, eaPhone: "+91 98111 22334" }),
      ).resolves.toMatchObject({ firstName: "Two" });
    });

    it.each([["Priya Kapoor"], ["kapoor"], ["98111 22334"], ["22334"]])(
      "finds the client by their assistant: %s",
      async (term) => {
        const created = await createCustomer({ firstName: "Ananya", customerSince: since, ...assistant });
        await createCustomer({ firstName: "Unrelated", customerSince: since });

        const { rows } = await searchClients({ q: term });
        expect(rows.map((row) => row.id)).toEqual([created.id]);
      },
    );

    it("finds every member of a household by the household's assistant", async () => {
      const household = await createHousehold({
        name: "Mehra Family",
        eaName: "Rohan Desai",
        eaPhone: "+91 99887 76655",
      });
      const member = await createCustomer({
        firstName: "Vikram",
        customerSince: since,
        householdId: household.id,
        householdRole: "primary",
      });
      await createCustomer({ firstName: "Unrelated", customerSince: since });

      for (const term of ["Rohan Desai", "76655"]) {
        const { rows } = await searchClients({ q: term });
        expect(rows.map((row) => row.id), term).toEqual([member.id]);
      }
    });

    it("shows the household's assistant unless the client has their own", async () => {
      const none = { eaName: null, eaEmail: null, eaPhone: null, eaNotes: null };
      const householdAssistant = { ...none, eaName: "Rohan Desai" };
      const ownAssistant = { ...none, eaName: "Priya Kapoor" };

      expect(executiveAssistantFor(none, householdAssistant)).toMatchObject({
        name: "Rohan Desai",
        fromHousehold: true,
      });
      expect(executiveAssistantFor(ownAssistant, householdAssistant)).toMatchObject({
        name: "Priya Kapoor",
        fromHousehold: false,
      });
      expect(executiveAssistantFor(none, null)).toBeNull();
    });
  });
});

describe("ordering the client list", () => {
  let staff: StaffFixtures;
  const since = "2024-01-01";

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
  });

  async function book() {
    // Deliberately not alphabetical, and deliberately sharing a city, so the
    // tiebreaker is exercised rather than assumed.
    const ayesha = await createCustomer({
      firstName: "Ayesha",
      mobile: "+91 98100 10001",
      city: "Mumbai",
      customerSince: since,
    });
    const bhavna = await createCustomer({
      firstName: "Bhavna",
      mobile: "+91 98100 10002",
      city: "Delhi",
      customerSince: since,
    });
    const chirag = await createCustomer({
      firstName: "Chirag",
      mobile: "+91 98100 10003",
      customerSince: since,
    });
    return { ayesha, bhavna, chirag };
  }

  const names = async (sort: string, dir: "asc" | "desc") =>
    (await searchClients({ sort: sort as never, dir })).rows.map(
      (row) => row.firstName,
    );

  it("reverses when the same column is asked for the other way round", async () => {
    await book();

    expect(await names("name", "asc")).toEqual(["Ayesha", "Bhavna", "Chirag"]);
    expect(await names("name", "desc")).toEqual(["Chirag", "Bhavna", "Ayesha"]);
  });

  /**
   * Postgres sorts nulls first descending and last ascending, so without an
   * explicit rule a client with no city would lead the list on one click and
   * trail it on the next. A blank is not an answer to "who is in Mumbai".
   */
  it("keeps a client with no city at the bottom whichever way the column points", async () => {
    await book();

    const ascending = await names("city", "asc");
    const descending = await names("city", "desc");

    expect(ascending).toEqual(["Bhavna", "Ayesha", "Chirag"]);
    expect(descending).toEqual(["Ayesha", "Bhavna", "Chirag"]);
    expect(ascending.at(-1)).toBe("Chirag");
    expect(descending.at(-1)).toBe("Chirag");
  });

  it("puts the most recently contacted first, and the never contacted last", async () => {
    const { ayesha, bhavna } = await book();

    await db
      .update(customers)
      .set({ lastInteractionAt: new Date("2026-01-10T00:00:00Z") })
      .where(eq(customers.id, ayesha.id));
    await db
      .update(customers)
      .set({ lastInteractionAt: new Date("2026-06-01T00:00:00Z") })
      .where(eq(customers.id, bhavna.id));

    expect(await names("last_interaction", "desc")).toEqual([
      "Bhavna",
      "Ayesha",
      "Chirag",
    ]);
    expect(await names("last_interaction", "asc")).toEqual([
      "Ayesha",
      "Bhavna",
      "Chirag",
    ]);
  });

  it("opens each column the way that column is usually asked", async () => {
    // Names read from A; a date column is asked "who most recently".
    expect(CLIENT_SORT_DEFAULT_DIRECTION.name).toBe("asc");
    expect(CLIENT_SORT_DEFAULT_DIRECTION.city).toBe("asc");
    expect(CLIENT_SORT_DEFAULT_DIRECTION.last_interaction).toBe("desc");
    expect(CLIENT_SORT_DEFAULT_DIRECTION.recent).toBe("desc");
  });
});

describe("handing several clients to a colleague", () => {
  let staff: StaffFixtures;
  const since = "2024-01-01";

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
  });

  async function three() {
    return Promise.all([
      createCustomer({ firstName: "One", mobile: "+91 98100 20001", customerSince: since }),
      createCustomer({ firstName: "Two", mobile: "+91 98100 20002", customerSince: since }),
      createCustomer({ firstName: "Three", mobile: "+91 98100 20003", customerSince: since }),
    ]);
  }

  it("moves them all and writes one audit row each, not one about a batch", async () => {
    const clients = await three();

    const { moved } = await reassignClients({
      customerIds: clients.map((client) => client.id),
      primaryRmId: staff.rm.id,
    });
    expect(moved).toBe(3);

    for (const client of clients) {
      const row = await db.query.customers.findFirst({
        where: eq(customers.id, client.id),
      });
      expect(row?.primaryRmId).toBe(staff.rm.id);

      const trail = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.customerId, client.id));
      const reassignments = trail.filter((entry) =>
        entry.summary.includes("Relationship manager changed"),
      );
      expect(reassignments).toHaveLength(1);
    }
  });

  it("skips the ones already with that colleague, so the trail records what changed", async () => {
    const clients = await three();
    await reassignClients({
      customerIds: [clients[0].id],
      primaryRmId: staff.rm.id,
    });

    const { moved } = await reassignClients({
      customerIds: clients.map((client) => client.id),
      primaryRmId: staff.rm.id,
    });
    expect(moved).toBe(2);
  });

  it("hands them back to nobody", async () => {
    const clients = await three();
    await reassignClients({
      customerIds: clients.map((client) => client.id),
      primaryRmId: staff.rm.id,
    });

    const { moved } = await reassignClients({
      customerIds: clients.map((client) => client.id),
      primaryRmId: null,
    });
    expect(moved).toBe(3);

    const row = await db.query.customers.findFirst({
      where: eq(customers.id, clients[0].id),
    });
    expect(row?.primaryRmId).toBeNull();
  });

  /**
   * The same capability as changing one, because it is the same act repeated.
   * A bulk path that asked for less would be the way round the check.
   */
  it("refuses anybody who may not reassign a single client", async () => {
    const clients = await three();

    for (const role of ["viewer", "rm"] as const) {
      actingAs(staff[role]);
      await expect(
        reassignClients({
          customerIds: clients.map((client) => client.id),
          primaryRmId: staff.rm.id,
        }),
      ).rejects.toThrow();
    }

    const row = await db.query.customers.findFirst({
      where: eq(customers.id, clients[0].id),
    });
    expect(row?.primaryRmId).toBeNull();
  });

  it("refuses a colleague who no longer has an account", async () => {
    const clients = await three();

    await expect(
      reassignClients({
        customerIds: [clients[0].id],
        primaryRmId: uuidv7(),
      }),
    ).rejects.toThrow(DomainError);
  });

  /** Nothing about a client's own details is touched by moving their manager. */
  it("leaves every phone number exactly as it was", async () => {
    const clients = await three();
    const before = await db
      .select({ id: customers.id, mobile: customers.mobile, whatsapp: customers.whatsapp })
      .from(customers);

    await reassignClients({
      customerIds: clients.map((client) => client.id),
      primaryRmId: staff.rm.id,
    });

    const after = await db
      .select({ id: customers.id, mobile: customers.mobile, whatsapp: customers.whatsapp })
      .from(customers);

    expect(after).toEqual(before);
  });
});
