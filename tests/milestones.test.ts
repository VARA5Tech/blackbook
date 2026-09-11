import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/db";
import { occurrenceNumber } from "@/domain/milestones";
import { createCustomer } from "@/services/client-service";
import { createHousehold } from "@/services/household-service";
import {
  archiveMilestone,
  countUpcoming,
  createMilestone,
  getUpcomingMilestones,
  listMilestonesForCustomer,
  updateMilestone,
} from "@/services/milestone-service";
import { archiveCustomer } from "@/services/client-service";
import {
  actingAs,
  birthdayDaysFromNow,
  resetData,
  seedCatalogue,
  seedStaff,
  type StaffFixtures,
} from "./helpers";

/**
 * Requirements document, section 3: MILESTONES.
 *
 * "Milestones should be searchable and capable of generating future
 * reminders/alerts."
 */
describe("milestones", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
  });

  async function makeClient(firstName: string) {
    return createCustomer({ firstName, customerSince: "2026-01-01" });
  }

  describe("the documented milestone kinds", () => {
    it("records a client birthday", async () => {
      const client = await makeClient("Rishabh");
      const milestone = await createMilestone({
        customerId: client.id,
        type: "birthday",
        title: "Rishabh's birthday",
        date: "1982-04-18",
      });
      expect(milestone.type).toBe("birthday");
      expect(milestone.date).toBe("1982-04-18");
    });

    it("records a wedding anniversary against the household, not one person", async () => {
      const household = await createHousehold({ name: "Sharma Family" });
      const milestone = await createMilestone({
        householdId: household.id,
        type: "wedding_anniversary",
        title: "Rishabh and Neha wedding anniversary",
        date: "2010-10-11",
      });

      expect(milestone.householdId).toBe(household.id);
      expect(milestone.customerId).toBeNull();
    });

    it("records a spouse birthday as that spouse's own milestone", async () => {
      const household = await createHousehold({ name: "Sharma Family" });
      const spouse = await createCustomer({
        firstName: "Neha",
        householdId: household.id,
        householdRole: "spouse",
        customerSince: "2026-01-01",
      });

      const milestone = await createMilestone({
        customerId: spouse.id,
        type: "birthday",
        title: "Neha's birthday",
        date: "1985-09-27",
      });
      expect(milestone.customerId).toBe(spouse.id);
    });

    it("records any number of children's birthdays without extra columns", async () => {
      const household = await createHousehold({ name: "Large Family" });

      for (let i = 1; i <= 5; i += 1) {
        const child = await createCustomer({
          firstName: `Child${i}`,
          householdId: household.id,
          householdRole: "child",
          customerSince: "2026-01-01",
        });
        await createMilestone({
          customerId: child.id,
          type: "birthday",
          title: `Child${i} birthday`,
          date: `2010-0${i}-1${i}`,
        });
      }

      const upcoming = await getUpcomingMilestones(366, 100);
      expect(upcoming.filter((m) => m.type === "birthday")).toHaveLength(5);
    });

    it.each([
      ["birthday"],
      ["wedding_anniversary"],
      ["work_anniversary"],
      ["religious"],
      ["memorial"],
      ["other"],
    ] as const)("accepts the milestone type %s", async (type) => {
      const client = await makeClient(`Typed ${type}`);
      const milestone = await createMilestone({
        customerId: client.id,
        type,
        title: `A ${type}`,
        date: "2015-06-15",
      });
      expect(milestone.type).toBe(type);
    });

    it("stores the preferred celebration style and notes", async () => {
      const household = await createHousehold({ name: "Private Family" });
      const milestone = await createMilestone({
        householdId: household.id,
        type: "wedding_anniversary",
        title: "Anniversary",
        date: "2010-10-11",
        celebrationStyle: "Private dinner, no public celebration or cake parade.",
        notes: "Intimate, never commercial.",
      });

      expect(milestone.celebrationStyle).toBe(
        "Private dinner, no public celebration or cake parade.",
      );
      expect(milestone.notes).toBe("Intimate, never commercial.");
    });

    it("carries a default reminder schedule that ops can override", async () => {
      const client = await makeClient("Reminded");
      const defaulted = await createMilestone({
        customerId: client.id,
        type: "birthday",
        title: "Default reminders",
        date: "1990-01-01",
      });
      expect(defaulted.reminderDaysBefore).toEqual([30, 7, 1]);

      const custom = await createMilestone({
        customerId: client.id,
        type: "other",
        title: "Custom reminders",
        date: "1990-02-02",
        reminderDaysBefore: [60, 14],
      });
      expect(custom.reminderDaysBefore).toEqual([60, 14]);
    });
  });

  describe("ownership rule", () => {
    it("refuses a milestone that belongs to nobody", async () => {
      await expect(
        createMilestone({
          type: "other",
          title: "Orphan",
          date: "2020-01-01",
        }),
      ).rejects.toThrow();
    });

    it("refuses a milestone that belongs to both a client and a household", async () => {
      const household = await createHousehold({ name: "Both" });
      const client = await makeClient("Both");

      await expect(
        createMilestone({
          customerId: client.id,
          householdId: household.id,
          type: "other",
          title: "Ambiguous",
          date: "2020-01-01",
        }),
      ).rejects.toThrow();
    });
  });

  describe("future reminders", () => {
    it("surfaces a milestone falling inside the window and orders by proximity", async () => {
      const soon = await makeClient("Soon");
      const later = await makeClient("Later");

      await createMilestone({
        customerId: later.id,
        type: "birthday",
        title: "Later birthday",
        date: birthdayDaysFromNow(40),
      });
      await createMilestone({
        customerId: soon.id,
        type: "birthday",
        title: "Soon birthday",
        date: birthdayDaysFromNow(5),
      });

      const upcoming = await getUpcomingMilestones(60, 50);
      expect(upcoming.map((m) => m.title)).toEqual([
        "Soon birthday",
        "Later birthday",
      ]);
      expect(upcoming[0].daysUntil).toBe(5);
      expect(upcoming[1].daysUntil).toBe(40);
    });

    it("excludes a milestone beyond the window", async () => {
      const client = await makeClient("Distant");
      await createMilestone({
        customerId: client.id,
        type: "birthday",
        title: "Distant birthday",
        date: birthdayDaysFromNow(120),
      });

      expect(await getUpcomingMilestones(30, 50)).toHaveLength(0);
      expect((await getUpcomingMilestones(150, 50)).length).toBe(1);
    });

    it("includes a milestone falling today", async () => {
      const client = await makeClient("Today");
      await createMilestone({
        customerId: client.id,
        type: "birthday",
        title: "Today birthday",
        date: birthdayDaysFromNow(0),
      });

      const upcoming = await getUpcomingMilestones(30, 50);
      expect(upcoming).toHaveLength(1);
      expect(upcoming[0].daysUntil).toBe(0);
    });

    it("rolls a date that has already passed this year into next year", async () => {
      const client = await makeClient("Passed");
      await createMilestone({
        customerId: client.id,
        type: "birthday",
        title: "Passed birthday",
        date: birthdayDaysFromNow(-30),
      });

      // Not upcoming in the next 60 days, but is within twelve months.
      expect(await getUpcomingMilestones(60, 50)).toHaveLength(0);
      const yearAhead = await getUpcomingMilestones(366, 50);
      expect(yearAhead).toHaveLength(1);
      expect(yearAhead[0].daysUntil).toBeGreaterThan(300);
    });

    it("counts upcoming milestones by type for the dashboard", async () => {
      const client = await makeClient("Counted");
      const household = await createHousehold({ name: "Counted Family" });

      await createMilestone({
        customerId: client.id,
        type: "birthday",
        title: "Birthday soon",
        date: birthdayDaysFromNow(3),
      });
      await createMilestone({
        householdId: household.id,
        type: "wedding_anniversary",
        title: "Anniversary soon",
        date: birthdayDaysFromNow(20, 16),
      });

      expect(await countUpcoming(7, "birthday")).toBe(1);
      expect(await countUpcoming(7, "wedding_anniversary")).toBe(0);
      expect(await countUpcoming(30, "wedding_anniversary")).toBe(1);
      expect(await countUpcoming(30)).toBe(2);
    });

    it("stops reminding about an archived client", async () => {
      const client = await makeClient("Departing");
      await createMilestone({
        customerId: client.id,
        type: "birthday",
        title: "Departing birthday",
        date: birthdayDaysFromNow(5),
      });

      expect(await getUpcomingMilestones(30, 50)).toHaveLength(1);
      await archiveCustomer(client.id);
      expect(await getUpcomingMilestones(30, 50)).toHaveLength(0);
    });

    it("stops reminding about a removed milestone", async () => {
      const client = await makeClient("Cancelled");
      const milestone = await createMilestone({
        customerId: client.id,
        type: "birthday",
        title: "Cancelled birthday",
        date: birthdayDaysFromNow(5),
      });

      await archiveMilestone(milestone.id);
      expect(await getUpcomingMilestones(30, 50)).toHaveLength(0);
    });

    it("names the client or the household on each reminder", async () => {
      const client = await createCustomer({
        firstName: "Neha",
        lastName: "Sharma",
        customerSince: "2026-01-01",
      });
      const household = await createHousehold({ name: "Sharma Family" });

      await createMilestone({
        customerId: client.id,
        type: "birthday",
        title: "Neha birthday",
        date: birthdayDaysFromNow(2),
      });
      await createMilestone({
        householdId: household.id,
        type: "wedding_anniversary",
        title: "Sharma anniversary",
        date: birthdayDaysFromNow(4, 16),
      });

      const upcoming = await getUpcomingMilestones(30, 50);
      expect(upcoming[0].customerName).toBe("Neha Sharma");
      expect(upcoming[0].householdName).toBeNull();
      expect(upcoming[1].householdName).toBe("Sharma Family");
      expect(upcoming[1].customerName).toBeNull();
    });
  });

  describe("date arithmetic edge cases", () => {
    it.each([
      [2027, "2027-02-28"],
      [2028, "2028-02-29"],
    ])(
      "clamps a 29 February anniversary correctly in %i",
      async (year, expected) => {
        const [row] = await sql.unsafe(
          `select vara5_next_occurrence(2, 29, date '${year}-01-01')::text as d`,
        );
        expect(row.d).toBe(expected);
      },
    );

    it("handles the 31st of a month with 31 days", async () => {
      const [row] = await sql.unsafe(
        `select vara5_next_occurrence(12, 31, date '2026-06-01')::text as d`,
      );
      expect(row.d).toBe("2026-12-31");
    });

    it("returns today when the date is today", async () => {
      const [row] = await sql.unsafe(
        `select vara5_days_until(6, 15, date '2026-06-15') as days`,
      );
      expect(Number(row.days)).toBe(0);
    });

    it("wraps to next year when the date has passed", async () => {
      const [row] = await sql.unsafe(
        `select vara5_next_occurrence(1, 5, date '2026-06-15')::text as d`,
      );
      expect(row.d).toBe("2027-01-05");
    });

    it("computes the ordinal occurrence, so a 40th birthday reads as one", () => {
      expect(occurrenceNumber("1986-10-11", "2026-10-11")).toBe(40);
      expect(occurrenceNumber("2010-10-11", "2026-10-11")).toBe(16);
      // A date in the current year has no ordinal yet.
      expect(occurrenceNumber("2026-10-11", "2026-10-11")).toBeNull();
    });
  });

  describe("editing", () => {
    it("updates a milestone and recomputes when it next falls", async () => {
      const client = await makeClient("Moving");
      const milestone = await createMilestone({
        customerId: client.id,
        type: "birthday",
        title: "Original",
        date: birthdayDaysFromNow(100),
      });

      expect(await getUpcomingMilestones(30, 50)).toHaveLength(0);

      await updateMilestone({
        id: milestone.id,
        title: "Corrected",
        date: birthdayDaysFromNow(10),
      });

      const upcoming = await getUpcomingMilestones(30, 50);
      expect(upcoming).toHaveLength(1);
      expect(upcoming[0].title).toBe("Corrected");
      expect(upcoming[0].daysUntil).toBe(10);
    });

    it("lists a client's own milestones ordered by proximity", async () => {
      const client = await makeClient("Listed");
      await createMilestone({
        customerId: client.id,
        type: "other",
        title: "Further",
        date: birthdayDaysFromNow(200),
      });
      await createMilestone({
        customerId: client.id,
        type: "birthday",
        title: "Nearer",
        date: birthdayDaysFromNow(9),
      });

      const list = await listMilestonesForCustomer(client.id);
      expect(list.map((m) => m.title)).toEqual(["Nearer", "Further"]);
    });
  });
});
