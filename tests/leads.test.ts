import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { leads, tasks } from "@/db/schema";
/*
 * The suite sends no mail — there is no Resend key — but who a message would
 * have been addressed to is exactly what one of these tests is about, so the
 * sender is replaced with something that remembers.
 */
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: vi.fn(async () => ({ sent: true })),
}));

import { sendEmail } from "@/lib/email";
import {
  announceLead,
  acknowledgeLead,
  advanceLead,
  assignLead,
  createLead,
  leadsForClient,
  openLeads,
  remarkOnLead,
  sweepOverdueLeads,
} from "@/services/lead-service";
import {
  createCustomer,
  recordPrivateAccessInterest,
  reassignClients,
} from "@/services/client-service";
import { recordInteraction } from "@/services/interaction-service";
import { LEAD_WINDOW_HOURS } from "@/domain/leads";
import { capabilitiesFor } from "@/auth/permissions";
import { listStaff } from "@/services/user-service";
import {
  actingAs,
  resetData,
  seedCatalogue,
  seedStaff,
  type StaffFixtures,
} from "./helpers";

/**
 * A client asking for something is the only thing the firm promises to answer,
 * so the promise is the thing worth testing: that it is recorded, owned, given
 * a clock, and chased when the clock runs out.
 */
describe("leads", () => {
  let staff: StaffFixtures;
  const since = "2026-01-01";

  const ask = (customerId: string, title = "Courchevel") =>
    recordPrivateAccessInterest({
      customerId,
      destination: title.toLowerCase(),
      title,
      kind: "cta_clicked",
      seconds: 0,
    });

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
  });

  async function client(rm: string | null = staff.rm.id) {
    const made = await createCustomer({
      firstName: "Meera",
      mobile: "+91 98100 44556",
      customerSince: since,
    });
    if (rm) await reassignClients({ customerIds: [made.id], primaryRmId: rm });
    return made;
  }

  describe("raising one", () => {
    it("opens a lead, a task and a clock when a client asks", async () => {
      const made = await client();
      await ask(made.id);

      const [lead] = await db.select().from(leads).where(eq(leads.customerId, made.id));
      expect(lead.status).toBe("new");
      expect(lead.title).toBe("Courchevel");
      // The client's own curator owns it without anybody choosing.
      expect(lead.assigneeId).toBe(staff.rm.id);

      const hours = (lead.dueAt.getTime() - lead.createdAt.getTime()) / 3_600_000;
      expect(Math.round(hours)).toBe(LEAD_WINDOW_HOURS);

      const [task] = await db.select().from(tasks).where(eq(tasks.leadId, lead.id));
      expect(task.assigneeId).toBe(staff.rm.id);
      expect(task.priority).toBe("high");
      expect(task.status).toBe("open");
    });

    /**
     * A client who opens the same journey twice in an afternoon wants one
     * answer. A queue holding the same intention twice is a queue people stop
     * trusting.
     */
    it("does not raise a second lead for the same destination", async () => {
      const made = await client();
      await ask(made.id);
      await ask(made.id);

      const rows = await db.select().from(leads).where(eq(leads.customerId, made.id));
      expect(rows).toHaveLength(1);
    });

    it("raises a separate lead for a different destination", async () => {
      const made = await client();
      await ask(made.id, "Courchevel");
      await ask(made.id, "Antarctica");

      const rows = await db.select().from(leads).where(eq(leads.customerId, made.id));
      expect(rows).toHaveLength(2);
    });

    /** Reading and opening are not asking; only the ask is owed an answer. */
    it("raises nothing for browsing", async () => {
      const made = await client();
      await recordPrivateAccessInterest({
        customerId: made.id,
        destination: "courchevel",
        title: "Courchevel",
        kind: "read",
        seconds: 120,
      });

      const rows = await db.select().from(leads).where(eq(leads.customerId, made.id));
      expect(rows).toHaveLength(0);
    });

    it("leaves the lead unowned when the client has no curator", async () => {
      const made = await client(null);
      await ask(made.id);

      const [lead] = await db.select().from(leads).where(eq(leads.customerId, made.id));
      expect(lead.assigneeId).toBeNull();
    });
  });

  /**
   * An enquiry taken by telephone is no less of an ask than one tapped on the
   * site, and it has to land in the same machinery or half the work sits
   * outside the figures.
   */
  describe("recording one by hand", () => {
    it("gives a telephone enquiry the same clock, task and owner", async () => {
      const made = await client();

      actingAs(staff.rm);
      await createLead({
        customerId: made.id,
        title: "A safari for their anniversary",
        source: "phone",
        note: "Wants August, no camping",
      });

      const [lead] = await db.select().from(leads).where(eq(leads.customerId, made.id));
      expect(lead.source).toBe("phone");
      expect(lead.status).toBe("new");
      expect(lead.assigneeId).toBe(staff.rm.id);
      expect(lead.outcomeNote).toBe("Wants August, no camping");
      // No interest row, because nothing on the members' site caused it.
      expect(lead.interestId).toBeNull();

      const hours = (lead.dueAt.getTime() - lead.createdAt.getTime()) / 3_600_000;
      expect(Math.round(hours)).toBe(LEAD_WINDOW_HOURS);

      const [task] = await db.select().from(tasks).where(eq(tasks.leadId, lead.id));
      expect(task.assigneeId).toBe(staff.rm.id);
      expect(task.priority).toBe("high");
    });

    it("marks a lead from the website as coming from the website", async () => {
      const made = await client();
      await ask(made.id);

      const [lead] = await db.select().from(leads).where(eq(leads.customerId, made.id));
      expect(lead.source).toBe("website");
    });

    it("refuses a second open lead for the same thing", async () => {
      const made = await client();
      actingAs(staff.rm);
      await createLead({ customerId: made.id, title: "Courchevel", source: "phone" });

      await expect(
        createLead({ customerId: made.id, title: "Courchevel", source: "email" }),
      ).rejects.toThrow();
    });

    /** It is chased exactly as a website lead is. */
    it("chases a telephone enquiry nobody answered", async () => {
      const made = await client();
      actingAs(staff.rm);
      await createLead({ customerId: made.id, title: "Kenya", source: "referral" });

      const [lead] = await db.select().from(leads).where(eq(leads.customerId, made.id));
      await db
        .update(leads)
        .set({ dueAt: new Date(Date.now() - 3_600_000) })
        .where(eq(leads.id, lead.id));

      expect((await sweepOverdueLeads()).chased).toBe(1);
    });
  });

  describe("answering one", () => {
    /**
     * The desk writes a call down after it happens. Asking for a second button
     * to say what was just recorded is how a queue stops matching reality.
     */
    it("counts a logged interaction as the answer, and closes the task", async () => {
      const made = await client();
      await ask(made.id);

      actingAs(staff.rm);
      await recordInteraction({
        customerId: made.id,
        type: "whatsapp",
        summary: "Sent Courchevel options",
        occurredAt: new Date(),
      });

      const [lead] = await db.select().from(leads).where(eq(leads.customerId, made.id));
      expect(lead.status).toBe("acknowledged");
      expect(lead.acknowledgedBy).toBe(staff.rm.id);

      const [task] = await db.select().from(tasks).where(eq(tasks.leadId, lead.id));
      expect(task.status).toBe("done");
    });

    it("takes an explicit answer too", async () => {
      const made = await client();
      await ask(made.id);
      const [raised] = await db.select().from(leads).where(eq(leads.customerId, made.id));

      actingAs(staff.rm);
      await acknowledgeLead({ leadId: raised.id, note: "Rang them" });

      const [lead] = await db.select().from(leads).where(eq(leads.id, raised.id));
      expect(lead.status).toBe("acknowledged");
      expect(lead.outcomeNote).toBe("Rang them");
    });

    it("moves through its phases and records why one was dropped", async () => {
      const made = await client();
      await ask(made.id);
      const [raised] = await db.select().from(leads).where(eq(leads.customerId, made.id));

      actingAs(staff.rm);
      await advanceLead({ leadId: raised.id, status: "planning" });
      await advanceLead({ leadId: raised.id, status: "booking" });
      await advanceLead({
        leadId: raised.id,
        status: "dropped",
        droppedReason: "Going with family instead",
      });

      const [lead] = await db.select().from(leads).where(eq(leads.id, raised.id));
      expect(lead.status).toBe("dropped");
      expect(lead.droppedReason).toBe("Going with family instead");
      expect(lead.closedAt).not.toBeNull();
    });

    it("refuses to drop a lead without a reason", async () => {
      const made = await client();
      await ask(made.id);
      const [raised] = await db.select().from(leads).where(eq(leads.customerId, made.id));

      actingAs(staff.rm);
      await expect(
        advanceLead({ leadId: raised.id, status: "dropped" }),
      ).rejects.toThrow();
    });

    /** A closed lead does not block the client asking again later. */
    it("allows a fresh lead once the last one is closed", async () => {
      const made = await client();
      await ask(made.id);
      const [first] = await db.select().from(leads).where(eq(leads.customerId, made.id));

      actingAs(staff.rm);
      await advanceLead({ leadId: first.id, status: "won" });

      actingAs(staff.admin);
      await ask(made.id);

      const rows = await db.select().from(leads).where(eq(leads.customerId, made.id));
      expect(rows).toHaveLength(2);
    });
  });

  /**
   * A remark is not an acknowledgement. Routing one through the acknowledgement
   * meant anything written on a lead past `new` was silently thrown away while
   * the screen said it had saved.
   */
  describe("remarks", () => {
    it("saves a remark on a lead that has already moved on", async () => {
      const made = await client();
      await ask(made.id);
      const [raised] = await db.select().from(leads).where(eq(leads.customerId, made.id));

      actingAs(staff.rm);
      await advanceLead({ leadId: raised.id, status: "booking" });
      await remarkOnLead({ leadId: raised.id, remark: "Waiting on their dates" });

      const [lead] = await db.select().from(leads).where(eq(leads.id, raised.id));
      expect(lead.outcomeNote).toBe("Waiting on their dates");
      // The remark must not quietly move the lead back.
      expect(lead.status).toBe("booking");
    });

    it("refuses an empty remark", async () => {
      const made = await client();
      await ask(made.id);
      const [raised] = await db.select().from(leads).where(eq(leads.customerId, made.id));

      actingAs(staff.rm);
      await expect(
        remarkOnLead({ leadId: raised.id, remark: "   " }),
      ).rejects.toThrow();
    });
  });

  describe("handing one over", () => {
    it("gives an unowned lead a curator and restarts the clock", async () => {
      const made = await client(null);
      await ask(made.id);
      const [raised] = await db.select().from(leads).where(eq(leads.customerId, made.id));

      await assignLead({ leadId: raised.id, assigneeId: staff.rm.id });

      const [lead] = await db.select().from(leads).where(eq(leads.id, raised.id));
      expect(lead.assigneeId).toBe(staff.rm.id);
      expect(lead.assignedBy).toBe(staff.admin.id);
      // The two days are the promise to the client, and it is not fair to hold
      // somebody to a clock that started before the work was theirs.
      expect(lead.dueAt.getTime()).toBeGreaterThan(raised.dueAt.getTime());
      expect(lead.escalationLevel).toBe(0);

      const [task] = await db.select().from(tasks).where(eq(tasks.leadId, lead.id));
      expect(task.assigneeId).toBe(staff.rm.id);
    });

    /**
     * A curator does not pick their own work here, so working a lead and
     * handing one out are different capabilities.
     */
    /**
     * A curator who already has a lead is obliged to answer it. Passing it on
     * would make the two-day promise somebody else's problem.
     */
    it("refuses to reassign a lead that already has a curator", async () => {
      const made = await client();
      await ask(made.id);
      const [raised] = await db.select().from(leads).where(eq(leads.customerId, made.id));

      await expect(
        assignLead({ leadId: raised.id, assigneeId: staff.manager.id }),
      ).rejects.toThrow();
    });

    it("refuses a curator who tries to assign one", async () => {
      const made = await client(null);
      await ask(made.id);
      const [raised] = await db.select().from(leads).where(eq(leads.customerId, made.id));

      actingAs(staff.rm);
      await expect(
        assignLead({ leadId: raised.id, assigneeId: staff.rm.id }),
      ).rejects.toThrow();
    });
  });

  describe("chasing", () => {
    const backdate = (id: string, hours: number) =>
      db
        .update(leads)
        .set({ dueAt: new Date(Date.now() - hours * 3_600_000) })
        .where(eq(leads.id, id));

    it("chases a lead that is past its window, once", async () => {
      const made = await client();
      await ask(made.id);
      const [raised] = await db.select().from(leads).where(eq(leads.customerId, made.id));
      await backdate(raised.id, 1);

      expect((await sweepOverdueLeads()).chased).toBe(1);
      // Raising the level is the claim, so a second run finds nothing to do.
      expect((await sweepOverdueLeads()).chased).toBe(0);
    });

    it("escalates again once it is a further day late", async () => {
      const made = await client();
      await ask(made.id);
      const [raised] = await db.select().from(leads).where(eq(leads.customerId, made.id));

      await backdate(raised.id, 1);
      await sweepOverdueLeads();
      await backdate(raised.id, 30);

      expect((await sweepOverdueLeads()).escalated).toBe(1);

      const [lead] = await db.select().from(leads).where(eq(leads.id, raised.id));
      expect(lead.escalationLevel).toBe(2);
    });

    /** Nobody owns it, so it is handed out at once rather than waited on. */
    it("reports an unowned lead immediately, without waiting for the window", async () => {
      const made = await client(null);
      await ask(made.id);

      expect((await sweepOverdueLeads()).unassigned).toBe(1);
    });

    it("stops chasing once somebody has answered", async () => {
      const made = await client();
      await ask(made.id);
      const [raised] = await db.select().from(leads).where(eq(leads.customerId, made.id));
      await backdate(raised.id, 1);

      actingAs(staff.rm);
      await recordInteraction({
        customerId: made.id,
        type: "call",
        summary: "Spoke to them",
        occurredAt: new Date(),
      });

      expect((await sweepOverdueLeads()).chased).toBe(0);
    });
  });

  describe("reading the queue", () => {
    it("puts the unowned first, then the unanswered", async () => {
      const owned = await client();
      const unowned = await createCustomer({
        firstName: "Unowned",
        mobile: "+91 98100 77889",
        customerSince: since,
      });

      await ask(owned.id, "Courchevel");
      await ask(unowned.id, "Antarctica");

      const queue = await openLeads();
      expect(queue[0].assigneeId).toBeNull();
      expect(queue).toHaveLength(2);
    });

    it("shows a client their own leads, newest first", async () => {
      const made = await client();
      await ask(made.id, "Courchevel");
      await ask(made.id, "Antarctica");

      const rows = await leadsForClient(made.id);
      expect(rows.map((row) => row.title)).toEqual(["Antarctica", "Courchevel"]);
    });
  });

  /** One lead is worked through many pieces of work, not one. */
  describe("the work under a lead", () => {
    it("closes every open task when the lead is answered", async () => {
      const made = await client();
      await ask(made.id);
      const [lead] = await db.select().from(leads).where(eq(leads.customerId, made.id));

      actingAs(staff.rm);
      await db.insert(tasks).values([
        { leadId: lead.id, customerId: made.id, title: "Send options", assigneeId: staff.rm.id },
        { leadId: lead.id, customerId: made.id, title: "Chase deposit", assigneeId: staff.rm.id },
      ]);

      await recordInteraction({
        customerId: made.id,
        type: "call",
        summary: "Spoke to them",
        occurredAt: new Date(),
      });

      const under = await db.select().from(tasks).where(eq(tasks.leadId, lead.id));
      expect(under).toHaveLength(3);
      expect(under.every((task) => task.status === "done")).toBe(true);
    });

    /**
     * A dropped lead's outstanding work was never completed, and recording it
     * as done would be a lie about what the desk did.
     */
    it("cancels rather than completes the work under a dropped lead", async () => {
      const made = await client();
      await ask(made.id);
      const [lead] = await db.select().from(leads).where(eq(leads.customerId, made.id));
      await db.insert(tasks).values({
        leadId: lead.id,
        customerId: made.id,
        title: "Send options",
        assigneeId: staff.rm.id,
      });

      actingAs(staff.rm);
      await advanceLead({
        leadId: lead.id,
        status: "dropped",
        droppedReason: "Travelling with family instead",
      });

      const under = await db.select().from(tasks).where(eq(tasks.leadId, lead.id));
      expect(under.every((task) => task.status === "cancelled")).toBe(true);
    });
  });
});

/**
 * A founder owns the firm rather than a place on the rota.
 *
 * They hold every capability an administrator does, and the two things that
 * follow from not being on the rota are easy to lose in a refactor: no work is
 * handed to them, and none of the chasing mail is addressed to them. A founder
 * who starts receiving every overdue lead is a founder who stops reading any
 * of them.
 */
describe("founders", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
    vi.mocked(sendEmail).mockClear();
  });

  it("reaches everything an administrator reaches", () => {
    const admin = capabilitiesFor("admin");
    const founder = capabilitiesFor("founder");

    for (const capability of admin) expect(founder).toContain(capability);
    expect(founder).toHaveLength(admin.length);
  });

  it("is never offered as somebody to hand work to", async () => {
    const pickable = await listStaff();

    expect(pickable.map((member) => member.id)).not.toContain(staff.founder.id);
    // The rest of the desk is still there, so this is an exclusion and not an
    // empty list from a query that stopped matching anything.
    expect(pickable.map((member) => member.id)).toContain(staff.rm.id);
  });

  it("is not copied on a lead nobody owns", async () => {
    const orphan = await createCustomer({
      firstName: "Unowned",
      customerSince: "2026-01-01",
      primaryRmId: null,
    });

    await recordPrivateAccessInterest({
      customerId: orphan.id,
      destination: "antarctica",
      title: "Antarctica",
      kind: "cta_clicked",
      seconds: 0,
    });

    const [lead] = await db.select().from(leads);
    await announceLead(lead.id);

    const addressed = vi.mocked(sendEmail).mock.calls.flatMap((call) => [
      call[0].to,
      ...(call[0].cc ?? []),
    ]);

    // The managers and administrators are told; the founder is not one of them.
    expect(addressed.length).toBeGreaterThan(0);
    expect(addressed).not.toContain(staff.founder.email);
    expect(addressed).toContain(staff.admin.email);
  });
});
