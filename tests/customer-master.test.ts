import { eq, sql as sqlOp } from "drizzle-orm";
import { ZodError } from "zod";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { activityLog, customerPreferenceProfile, customers } from "@/db/schema";
import {
  archiveCustomer,
  createCustomer,
  DomainError,
  eraseCustomer,
  getClient360,
  restoreCustomer,
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
    it("is auto-generated in the documented CUST-000NN form", async () => {
      const created = await createCustomer({
        firstName: "Rishabh",
        customerSince: "2021-03-01",
      });
      expect(created.ref).toMatch(/^CUST-\d{5}$/);
      expect(created.ref).toBe("CUST-00100");
    });

    it("increments per client and never repeats", async () => {
      const refs: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const created = await createCustomer({
          firstName: `Client${i}`,
          customerSince: "2026-01-01",
        });
        refs.push(created.ref);
      }
      expect(refs).toEqual([
        "CUST-00100",
        "CUST-00101",
        "CUST-00102",
        "CUST-00103",
        "CUST-00104",
      ]);
      expect(new Set(refs).size).toBe(5);
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
      ["919810011223"],
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
      ).rejects.toThrow(/Rishabh Sharma \(CUST-00100\)/);
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
      expect(created.ref).toBe("CUST-00101");
    });

    it("frees the number once the original client is archived", async () => {
      const [original] = await db
        .select()
        .from(customers)
        .where(eq(customers.ref, "CUST-00100"));
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
        .where(eq(customers.ref, "CUST-00100"));
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
        .where(eq(customers.ref, "CUST-00100"));

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
        .where(eq(customers.ref, "CUST-00100"));

      await updateCustomer({ id: original.id, city: "Delhi" });
      const cleared = await updateCustomer({ id: original.id, city: "" });

      expect(cleared.city).toBeNull();
    });

    it("lets a client keep their own number when edited", async () => {
      const [original] = await db
        .select()
        .from(customers)
        .where(eq(customers.ref, "CUST-00100"));

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
});
