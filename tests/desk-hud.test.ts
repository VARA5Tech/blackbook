import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: vi.fn(async () => ({ sent: true })),
}));

import { db } from "@/db";
import { leads } from "@/db/schema";
import { createCustomer, recordPrivateAccessInterest } from "@/services/client-service";
import { deskStatus } from "@/services/lead-service";
import { createMilestone } from "@/services/milestone-service";
import { createTask } from "@/services/task-service";
import {
  actingAs,
  resetData,
  seedCatalogue,
  seedStaff,
  type StaffFixtures,
} from "./helpers";

/**
 * The panel that is on every screen and cannot be dismissed.
 *
 * Its whole value is the order: somebody reads it for two seconds between one
 * thing and the next, so the most pressing item has to be the first one. That
 * is a rule about data, not about styling, which is why it is tested here and
 * not left to whoever next edits the component.
 */
describe("the desk panel", () => {
  let staff: StaffFixtures;
  const since = "2026-01-01";

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
  });

  const client = async (firstName: string) =>
    createCustomer({ firstName, customerSince: since, primaryRmId: staff.rm.id });

  const ask = (customerId: string, title: string) =>
    recordPrivateAccessInterest({
      customerId,
      destination: title.toLowerCase(),
      title,
      kind: "cta_clicked",
      seconds: 0,
    });

  it("puts what is late above what is merely coming", async () => {
    const soon = await client("Soon");
    const overdue = await client("Overdue");

    await ask(soon.id, "Courchevel");
    await ask(overdue.id, "Antarctica");

    // Drag one lead's answer-by into the past, which is what the sweep sees.
    await db
      .update(leads)
      .set({ dueAt: sql`now() - interval '3 hours'` })
      .where(eq(leads.customerId, overdue.id));

    const { signals } = await deskStatus();

    expect(signals[0].title).toBe("Antarctica");
    expect(signals[0].tone).toBe("late");
    expect(signals.find((signal) => signal.title === "Courchevel")?.tone).not.toBe(
      "late",
    );
  });

  /**
   * A date on a client's record is not a lead and nobody is chased about one,
   * but it is missed the same way: by being somewhere nobody looked.
   */
  it("carries a milestone that is close, and not one that is months away", async () => {
    const soon = await client("Birthday");
    const far = await client("Faraway");

    const today = new Date();
    const inTwoDays = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
    const inHalfAYear = new Date(today.getTime() + 182 * 24 * 60 * 60 * 1000);
    const asDate = (date: Date) => `1985-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

    await createMilestone({
      customerId: soon.id,
      type: "birthday",
      title: "A birthday",
      date: asDate(inTwoDays),
    });
    await createMilestone({
      customerId: far.id,
      type: "birthday",
      title: "A distant birthday",
      date: asDate(inHalfAYear),
    });

    const { signals } = await deskStatus();
    const titles = signals.map((signal) => signal.title);

    expect(titles).toContain("A birthday");
    expect(titles).not.toContain("A distant birthday");
  });

  /**
   * One lead with three follow-ups is one thing to answer. Listing the
   * follow-ups as rows of their own makes a quiet desk look like a busy one,
   * and pushes everything else off the panel.
   */
  it("hangs a lead's tasks under the lead instead of repeating them", async () => {
    const asked = await client("Nested");
    await ask(asked.id, "Kyushu");

    const [lead] = await db.select().from(leads);

    await createTask({
      title: "Hold two cabins",
      customerId: asked.id,
      leadId: lead.id,
      dueDate: new Date().toISOString().slice(0, 10),
    });

    const { signals } = await deskStatus();

    const leadSignal = signals.find((signal) => signal.kind === "lead");
    expect(leadSignal?.tasks.map((task) => task.title)).toContain("Hold two cabins");

    // The task the lead already carries is not also a row of its own.
    expect(
      signals.filter((signal) => signal.kind === "task" && signal.title === "Hold two cabins"),
    ).toHaveLength(0);
  });

  it("shows a curator their own work and a manager the whole desk", async () => {
    const mine = await client("Mine");
    const theirs = await createCustomer({
      firstName: "Theirs",
      customerSince: since,
      primaryRmId: staff.manager.id,
    });

    await ask(mine.id, "Kyoto");
    await ask(theirs.id, "Oslo");

    actingAs(staff.rm);
    const curator = await deskStatus();
    expect(curator.wholeDesk).toBe(false);
    expect(curator.signals.map((signal) => signal.title)).toEqual(["Kyoto"]);

    actingAs(staff.manager);
    const manager = await deskStatus();
    expect(manager.wholeDesk).toBe(true);
    expect(manager.signals.map((signal) => signal.title).sort()).toEqual([
      "Kyoto",
      "Oslo",
    ]);
  });
});
