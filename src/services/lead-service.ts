import "server-only";
import { and, eq, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, customers, households, leads, milestones, tasks, users } from "@/db/schema";
import { roleCan } from "@/auth/permissions";
import { requireCapability } from "@/auth/session";
import {
  acknowledgeLeadSchema,
  createLeadSchema,
  LEAD_SOURCE_LABELS,
  advanceLeadSchema,
  assignLeadSchema,
  dueFrom,
  isOpenLead,
  LEAD_ESCALATION_HOURS,
  LEAD_ESCALATION_LEVELS,
  LEAD_STATUS_LABELS,
  remarkLeadSchema,
  type AcknowledgeLeadInput,
  type AdvanceLeadInput,
  type AssignLeadInput,
  type CreateLeadInput,
  type LeadSource,
  type RemarkLeadInput,
} from "@/domain/leads";
import { displayName } from "@/domain/customers";
import { formatDateTime } from "@/lib/format";
import {
  leadOverdueEmail,
  leadRaisedEmail,
  leadUnassignedEmail,
  sendEmail,
} from "@/lib/email";
import { logger } from "@/lib/logger";
import { logActivity } from "./activity-service";
import { DomainError } from "./client-service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * How far ahead the panel looks for a date it must not miss.
 *
 * Far enough that a birthday can still be planned for, near enough that the
 * panel is a list of what to do and not a calendar.
 */
const MILESTONE_HORIZON_DAYS = 30;

/**
 * One thing the desk has not dealt with.
 *
 * Leads, the tasks under them and the dates on a client's record are three
 * different records and one question: what has not been answered yet. They are
 * flattened into a single shape here so the panel can rank them against each
 * other by how late they are, rather than showing three lists and leaving the
 * reader to work out which one is on fire.
 */
export type DeskSignal = {
  id: string;
  kind: "lead" | "task" | "milestone";
  /** How hard it is pressing: past its time, inside a day, or coming. */
  tone: "late" | "now" | "soon";
  title: string;
  who: string | null;
  ref: string | null;
  href: string;
  /** Leads carry a timestamp; milestones and tasks carry a date. */
  dueAt: string | null;
  dueDate: string | null;
  note: string | null;
  /** A lead nobody owns, which is nobody's to answer until it is given away. */
  unowned: boolean;
  tasks: { id: string; title: string; dueDate: string | null }[];
};

const appUrl = () => process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const clientUrl = (customerId: string) => `${appUrl()}/clients/${customerId}`;

/* ------------------------------------------------------------------ */
/* Raising one                                                         */
/* ------------------------------------------------------------------ */

/**
 * Opens a lead for a client who has asked for something.
 *
 * Called from the interest endpoint inside the same transaction that records
 * the ask, so a lead cannot exist without the thing that caused it and the
 * website cannot half-succeed. Three records are written together: the lead
 * itself, a task so the desk works from the list it already uses, and an
 * activity row so the client's own trail says a lead was raised.
 *
 * The mail is sent after the transaction commits, never inside it: Resend
 * being slow or refusing must not roll back the record of a client's ask.
 */
export async function openLeadForAsk(
  tx: Tx,
  input: {
    customerId: string;
    interestId: string | null;
    destination: string;
    title: string;
    source?: LeadSource;
    note?: string | null;
  },
): Promise<{ leadId: string } | null> {
  const customer = await tx.query.customers.findFirst({
    where: eq(customers.id, input.customerId),
  });
  if (!customer) return null;

  const raisedAt = new Date();
  const dueAt = dueFrom(raisedAt);

  /*
   * One open lead per client per destination. A client who opens Courchevel
   * twice in an afternoon wants one answer, and a queue holding the same
   * intention twice is a queue people stop trusting. The unique index is the
   * guarantee; this is what keeps the second ask from erroring.
   */
  const [lead] = await tx
    .insert(leads)
    .values({
      customerId: input.customerId,
      interestId: input.interestId,
      destination: input.destination,
      title: input.title,
      source: input.source ?? "website",
      outcomeNote: input.note ?? null,
      assigneeId: customer.primaryRmId,
      assignedAt: customer.primaryRmId ? raisedAt : null,
      dueAt,
    })
    .onConflictDoNothing()
    .returning();

  if (!lead) return null;

  await tx
    .insert(tasks)
    .values({
      leadId: lead.id,
      title: `Answer ${displayName(customer)} about ${input.title}`,
      details:
        "Log a call, a message or a meeting against the client to close it.",
      customerId: input.customerId,
      assigneeId: customer.primaryRmId,
      // A date column: the window is 48 hours, and the task list reads in days.
      dueDate: dueAt.toISOString().slice(0, 10),
      priority: "high",
    });

  // Written straight in rather than through logActivity, which requires an
  // actor: nobody signed in did this, and the absent actor is what marks a row
  // as the members' site reporting rather than a member of staff.
  await tx.insert(activityLog).values({
    entityType: "customer",
    entityId: input.customerId,
    customerId: input.customerId,
    householdId: customer.householdId,
    action: "interaction_logged",
    summary: `Lead raised: ${input.title}`,
    actorId: null,
  });

  return { leadId: lead.id };
}

/* ------------------------------------------------------------------ */
/* Telling people                                                      */
/* ------------------------------------------------------------------ */

/** Everyone who watches leads, by role. */
async function watchers(): Promise<{ managers: string[]; admins: string[] }> {
  const rows = await db
    .select({ email: users.email, role: users.role })
    .from(users)
    .where(inArray(users.role, ["manager", "admin"]));

  return {
    managers: rows.filter((row) => row.role === "manager").map((row) => row.email),
    admins: rows.filter((row) => row.role === "admin").map((row) => row.email),
  };
}

/**
 * Says a lead exists, to whoever needs to know.
 *
 * Never throws: mail is how the desk hears about a lead, not how the lead is
 * recorded, and a refused send must not take down the endpoint the website
 * calls. The failure goes to the log with the reason.
 */
export async function announceLead(leadId: string): Promise<void> {
  try {
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
    if (!lead) return;

    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, lead.customerId),
    });
    if (!customer) return;

    const { managers, admins } = await watchers();
    const common = {
      clientName: displayName(customer),
      clientRef: customer.ref,
      title: lead.title,
      leadUrl: clientUrl(lead.customerId),
      dueAt: formatDateTime(lead.dueAt),
    };

    if (!lead.assigneeId) {
      // Nobody owns it, so nobody is chased: the managers are asked to give it
      // to somebody, at once rather than in two days.
      const to = [...managers, ...admins];
      if (to.length === 0) return;
      const message = leadUnassignedEmail(common);
      await sendEmail({
        to: to[0],
        cc: to.slice(1),
        category: "lead-unassigned",
        ...message,
      });
      return;
    }

    const curator = await db.query.users.findFirst({
      where: eq(users.id, lead.assigneeId),
    });
    if (!curator) return;

    const message = leadRaisedEmail({ ...common, curatorName: curator.name });
    await sendEmail({
      to: curator.email,
      cc: managers,
      category: "lead-raised",
      ...message,
    });
  } catch (error) {
    logger.error("lead.announce_failed", error, { leadId });
  }
}

/* ------------------------------------------------------------------ */
/* Working one                                                         */
/* ------------------------------------------------------------------ */

/**
 * Marks every open lead for a client as answered.
 *
 * Called whenever an interaction is logged, which is the honest signal: the
 * desk records contact after it happens, often from WhatsApp, and asking
 * somebody to press a second button to say what they just wrote down is how a
 * queue stops matching reality. The explicit button exists as well, for
 * contact made before the lead arrived.
 */
export async function acknowledgeLeadsFor(
  tx: Tx,
  customerId: string,
  actorId: string,
): Promise<number> {
  const answered = await tx
    .update(leads)
    .set({
      status: "acknowledged",
      acknowledgedAt: new Date(),
      acknowledgedBy: actorId,
      updatedAt: new Date(),
    })
    .where(and(eq(leads.customerId, customerId), eq(leads.status, "new")))
    .returning({ id: leads.id });

  // Every chase raised for the lead, not just the first: the answer settles
  // all of them, and a done lead with open tasks under it reads as a mistake.
  for (const lead of answered) {
    await tx
      .update(tasks)
      .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.leadId, lead.id), ne(tasks.status, "done")));
  }

  return answered.length;
}

export async function acknowledgeLead(input: AcknowledgeLeadInput) {
  const actor = await requireCapability("lead.work");
  const data = acknowledgeLeadSchema.parse(input);

  return db.transaction(async (tx) => {
    const lead = await tx.query.leads.findFirst({ where: eq(leads.id, data.leadId) });
    if (!lead) throw new DomainError("That lead no longer exists");
    if (lead.status !== "new") return { changed: false };

    await tx
      .update(leads)
      .set({
        status: "acknowledged",
        acknowledgedAt: new Date(),
        acknowledgedBy: actor.id,
        outcomeNote: data.note ?? lead.outcomeNote,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, lead.id));

    await tx
      .update(tasks)
      .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.leadId, lead.id), ne(tasks.status, "done")));

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: lead.customerId,
        customerId: lead.customerId,
        action: "interaction_logged",
        summary: `Lead answered: ${lead.title}`,
      },
      tx,
    );

    return { changed: true };
  });
}

/**
 * Writes a remark on a lead, whatever state it is in.
 *
 * Separate from acknowledging, which only applies to a lead nobody has
 * answered yet. Routing remarks through that meant anything written on a lead
 * in Planning or Booking was quietly thrown away.
 */
export async function remarkOnLead(input: RemarkLeadInput) {
  const actor = await requireCapability("lead.work");
  const data = remarkLeadSchema.parse(input);

  return db.transaction(async (tx) => {
    const lead = await tx.query.leads.findFirst({ where: eq(leads.id, data.leadId) });
    if (!lead) throw new DomainError("That lead no longer exists");

    await tx
      .update(leads)
      .set({ outcomeNote: data.remark, updatedAt: new Date() })
      .where(eq(leads.id, lead.id));

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: lead.customerId,
        customerId: lead.customerId,
        action: "updated",
        summary: `Remark on lead: ${lead.title}`,
      },
      tx,
    );

    return { saved: true };
  });
}

/**
 * Moves a lead on, or ends it.
 *
 * A drop carries a written reason, because "why did we not pursue this" is the
 * question somebody asks three months later and the answer is not recoverable
 * from anything else. Reaching any phase also answers the lead: a client being
 * planned for has plainly been spoken to.
 */
export async function advanceLead(input: AdvanceLeadInput) {
  const actor = await requireCapability("lead.work");
  const data = advanceLeadSchema.parse(input);

  return db.transaction(async (tx) => {
    const lead = await tx.query.leads.findFirst({ where: eq(leads.id, data.leadId) });
    if (!lead) throw new DomainError("That lead no longer exists");

    const closing = data.status === "won" || data.status === "dropped";

    await tx
      .update(leads)
      .set({
        status: data.status,
        acknowledgedAt: lead.acknowledgedAt ?? new Date(),
        acknowledgedBy: lead.acknowledgedBy ?? actor.id,
        outcomeNote: data.note ?? lead.outcomeNote,
        droppedReason: data.status === "dropped" ? (data.droppedReason ?? null) : null,
        closedAt: closing ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, lead.id));

    /*
     * Closing the lead closes whatever was still open under it. A won lead's
     * outstanding chases are done; a dropped one's are cancelled, because they
     * were never completed and recording them as done would be a lie.
     */
    if (closing) {
      await tx
        .update(tasks)
        .set({
          status: data.status === "won" ? "done" : "cancelled",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.leadId, lead.id), ne(tasks.status, "done")));
    }

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: lead.customerId,
        customerId: lead.customerId,
        action: "interaction_logged",
        summary: `Lead ${LEAD_STATUS_LABELS[data.status].toLowerCase()}: ${lead.title}`,
        changes: data.droppedReason
          ? { droppedReason: { from: null, to: data.droppedReason } }
          : undefined,
      },
      tx,
    );

    return { status: data.status };
  });
}

/**
 * Hands a lead to a curator.
 *
 * A manager's job rather than a curator's own choice, so an unowned lead is
 * given out rather than waited on. The window restarts from the moment it is
 * handed over: two days is the promise to the client, and it is not fair to
 * hold somebody to a clock that started before the work was theirs.
 */
export async function assignLead(input: AssignLeadInput) {
  const actor = await requireCapability("lead.assign");
  const data = assignLeadSchema.parse(input);

  const result = await db.transaction(async (tx) => {
    const lead = await tx.query.leads.findFirst({ where: eq(leads.id, data.leadId) });
    if (!lead) throw new DomainError("That lead no longer exists");

    /*
     * Only a lead nobody owns can be given out. Once a curator has it they are
     * obliged to answer it: passing it on would make the two-day promise
     * somebody else's problem and restart the clock the client is waiting on.
     */
    if (lead.assigneeId) {
      throw new DomainError("That lead already has a curator");
    }
    if (!data.assigneeId) {
      throw new DomainError("Choose a curator");
    }

    if (data.assigneeId) {
      const curator = await tx.query.users.findFirst({
        where: eq(users.id, data.assigneeId),
      });
      if (!curator) throw new DomainError("That colleague no longer has an account");
    }

    const now = new Date();
    await tx
      .update(leads)
      .set({
        assigneeId: data.assigneeId,
        assignedAt: data.assigneeId ? now : null,
        assignedBy: actor.id,
        dueAt: data.assigneeId ? dueFrom(now) : lead.dueAt,
        // The chasing starts again for whoever now owns it.
        escalationLevel: 0,
        escalatedAt: null,
        updatedAt: now,
      })
      .where(eq(leads.id, lead.id));

    // The work moves with the lead, so the new curator sees it in their list.
    await tx
      .update(tasks)
      .set({
        assigneeId: data.assigneeId,
        dueDate: dueFrom(now).toISOString().slice(0, 10),
        updatedAt: now,
      })
      .where(and(eq(tasks.leadId, lead.id), ne(tasks.status, "done")));

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: lead.customerId,
        customerId: lead.customerId,
        action: "updated",
        summary: data.assigneeId
          ? `Lead assigned: ${lead.title}`
          : `Lead unassigned: ${lead.title}`,
      },
      tx,
    );

    return { leadId: lead.id, assigned: Boolean(data.assigneeId) };
  });

  // Whoever it went to hears about it, outside the transaction.
  if (result.assigned) await announceLead(result.leadId);
  return result;
}

/* ------------------------------------------------------------------ */
/* Chasing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Finds leads nobody has answered and tells the right people.
 *
 * The level is raised in the same statement that selects the lead, and the
 * mail is only sent for rows that come back. Two instances of the application
 * running this at once would otherwise both send: the update is the claim, and
 * only one of them can win it.
 *
 * Runs on a timer rather than a cron, because the deployment has no host
 * shell, and it is safe to run as often as it likes: a lead already chased at
 * a level is never chased again at that level.
 */
export async function sweepOverdueLeads(): Promise<{
  chased: number;
  escalated: number;
  unassigned: number;
}> {
  const now = new Date();
  const harder = new Date(now.getTime() - LEAD_ESCALATION_HOURS * 60 * 60 * 1000);

  // Nobody owns these, so they are not waited on: they are handed out at once.
  const unowned = await claim(
    and(
      eq(leads.status, "new"),
      isNull(leads.assigneeId),
      eq(leads.escalationLevel, LEAD_ESCALATION_LEVELS.none),
    ),
    LEAD_ESCALATION_LEVELS.chased,
  );

  const late = await claim(
    and(
      eq(leads.status, "new"),
      sql`${leads.assigneeId} is not null`,
      lt(leads.dueAt, now),
      eq(leads.escalationLevel, LEAD_ESCALATION_LEVELS.none),
    ),
    LEAD_ESCALATION_LEVELS.chased,
  );

  const veryLate = await claim(
    and(
      eq(leads.status, "new"),
      lt(leads.dueAt, harder),
      eq(leads.escalationLevel, LEAD_ESCALATION_LEVELS.chased),
    ),
    LEAD_ESCALATION_LEVELS.escalated,
  );

  for (const lead of unowned) await announceLead(lead.id);
  for (const lead of [...late, ...veryLate]) await chase(lead.id, lead.dueAt);

  const counts = {
    chased: late.length,
    escalated: veryLate.length,
    unassigned: unowned.length,
  };
  if (counts.chased || counts.escalated || counts.unassigned) {
    logger.info("lead.sweep", counts);
  }
  return counts;
}

/** Raises the level first, so only one runner can act on a given lead. */
async function claim(
  where: ReturnType<typeof and>,
  level: number,
): Promise<{ id: string; dueAt: Date }[]> {
  return db
    .update(leads)
    .set({ escalationLevel: level, escalatedAt: new Date(), updatedAt: new Date() })
    .where(where)
    .returning({ id: leads.id, dueAt: leads.dueAt });
}

async function chase(leadId: string, dueAt: Date): Promise<void> {
  try {
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
    if (!lead) return;

    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, lead.customerId),
    });
    if (!customer) return;

    const curator = lead.assigneeId
      ? await db.query.users.findFirst({ where: eq(users.id, lead.assigneeId) })
      : null;

    const { managers, admins } = await watchers();
    /*
     * There is one tier of managers, not a manager per curator, so the whole
     * tier is copied. Administrators join only at the second level, which is
     * what keeps the first chase from reading as a complaint.
     */
    const cc =
      lead.escalationLevel >= LEAD_ESCALATION_LEVELS.escalated
        ? [...managers, ...admins]
        : managers;

    const to = curator?.email ?? cc[0];
    if (!to) return;

    const message = leadOverdueEmail({
      clientName: displayName(customer),
      clientRef: customer.ref,
      title: lead.title,
      leadUrl: clientUrl(lead.customerId),
      dueAt: formatDateTime(dueAt),
      curatorName: curator?.name ?? null,
      hoursLate: Math.max(
        0,
        Math.round((Date.now() - dueAt.getTime()) / (60 * 60 * 1000)),
      ),
    });

    await sendEmail({
      to,
      cc: cc.filter((address) => address !== to),
      category:
        lead.escalationLevel >= LEAD_ESCALATION_LEVELS.escalated
          ? "lead-escalated"
          : "lead-overdue",
      ...message,
    });
  } catch (error) {
    logger.error("lead.chase_failed", error, { leadId });
  }
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * The leads somebody still owes an answer on, most urgent first.
 *
 * Unowned leads lead the list whatever their age: they are the ones that will
 * still be sitting there tomorrow unless a manager acts.
 */
export async function openLeads(limit = 20) {
  await requireCapability("client.read");

  return db
    .select({
      id: leads.id,
      customerId: leads.customerId,
      ref: customers.ref,
      firstName: customers.firstName,
      lastName: customers.lastName,
      preferredName: customers.preferredName,
      title: leads.title,
      destination: leads.destination,
      status: leads.status,
      dueAt: leads.dueAt,
      assigneeId: leads.assigneeId,
      curatorName: users.name,
      escalationLevel: leads.escalationLevel,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .leftJoin(users, eq(users.id, leads.assigneeId))
    .where(
      and(
        inArray(leads.status, ["new", "acknowledged", "planning", "booking"]),
        isNull(customers.archivedAt),
      ),
    )
    .orderBy(
      sql`(${leads.assigneeId} is null) desc`,
      sql`(${leads.status} = 'new') desc`,
      leads.dueAt,
    )
    .limit(limit);
}

/** Every lead for one client, newest first, for the client's own page. */
export async function leadsForClient(customerId: string) {
  await requireCapability("client.read");

  const rows = await db
    .select({
      id: leads.id,
      title: leads.title,
      destination: leads.destination,
      status: leads.status,
      source: leads.source,
      dueAt: leads.dueAt,
      acknowledgedAt: leads.acknowledgedAt,
      droppedReason: leads.droppedReason,
      outcomeNote: leads.outcomeNote,
      curatorName: users.name,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assigneeId))
    .where(eq(leads.customerId, customerId))
    .orderBy(sql`${leads.createdAt} desc`);

  if (rows.length === 0) return [];

  // The follow-ups under each lead, so the panel shows the work rather than
  // sending somebody to a separate list to find it.
  const work = await db
    .select({
      id: tasks.id,
      leadId: tasks.leadId,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      assigneeName: users.name,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(
      inArray(
        tasks.leadId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(tasks.status, tasks.dueDate);

  return rows.map((row) => ({
    ...row,
    followUps: work.filter((task) => task.leadId === row.id),
  }));
}

/**
 * Records a lead somebody at the desk took by telephone, email or in person.
 *
 * Deliberately the same path the website uses, so it earns the same clock, the
 * same task on the same list and the same chasing: a client who rings is owed
 * an answer exactly as much as one who taps a button, and splitting them would
 * leave half the asks outside the figures.
 */
export async function createLead(input: CreateLeadInput) {
  const actor = await requireCapability("lead.work");
  const data = createLeadSchema.parse(input);

  const result = await db.transaction(async (tx) => {
    const customer = await tx.query.customers.findFirst({
      where: eq(customers.id, data.customerId),
    });
    if (!customer) throw new DomainError("Client not found");

    const opened = await openLeadForAsk(tx, {
      customerId: data.customerId,
      // No interest row: nothing on the members' site caused this.
      interestId: null,
      destination: data.title.toLowerCase().replace(/\s+/g, "-").slice(0, 120),
      title: data.title,
      source: data.source,
      note: data.note,
    });
    if (!opened) {
      throw new DomainError("There is already an open lead for that");
    }

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: data.customerId,
        customerId: data.customerId,
        action: "interaction_logged",
        summary: `Lead recorded from ${LEAD_SOURCE_LABELS[data.source].toLowerCase()}: ${data.title}`,
      },
      tx,
    );

    return opened;
  });

  await announceLead(result.leadId);
  return result;
}

export { isOpenLead, or };

/**
 * The standing count of what the signed-in person owes somebody.
 *
 * Read on every screen, so it is four aggregates in one round trip rather than
 * four queries: a bar that is always on show must never be the reason a page
 * is slow.
 *
 * A curator sees their own work. Anybody who can hand leads out sees the whole
 * desk, because an unanswered lead belonging to somebody else is exactly what
 * they are there to notice.
 */
export async function deskStatus() {
  const actor = await requireCapability("client.read");
  /*
   * The comment above says "anybody who can hand leads out", so that is what
   * this asks. Naming the two roles that could meant a founder — who holds
   * every capability an administrator does — saw only the leads assigned to
   * them, which is none, and a bar that said the desk was clear.
   */
  const wholeDesk = roleCan(actor.role, "lead.assign");
  const mine = wholeDesk ? undefined : eq(leads.assigneeId, actor.id);

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const [counts] = await db
    .select({
      waiting: sql<number>`count(*) filter (where ${leads.status} = 'new')::int`,
      overdue: sql<number>`count(*) filter (
        where ${leads.status} = 'new' and ${leads.dueAt} < now()
      )::int`,
      unassigned: sql<number>`count(*) filter (
        where ${leads.status} = 'new' and ${leads.assigneeId} is null
      )::int`,
      working: sql<number>`count(*) filter (
        where ${leads.status} in ('acknowledged', 'planning', 'booking')
      )::int`,
    })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .where(
      mine
        ? and(isNull(customers.archivedAt), mine)
        : isNull(customers.archivedAt),
    );

  const [work] = await db
    .select({
      dueToday: sql<number>`count(*) filter (
        where ${tasks.dueDate} = ${todayIso} and ${tasks.status} <> 'done'
      )::int`,
      late: sql<number>`count(*) filter (
        where ${tasks.dueDate} < ${todayIso} and ${tasks.status} not in ('done', 'cancelled')
      )::int`,
    })
    .from(tasks)
    .where(wholeDesk ? undefined : eq(tasks.assigneeId, actor.id));

  /*
   * The rows behind the numbers, so hovering a figure shows what it is made
   * of rather than repeating it in words. Capped hard: this is read on every
   * screen, and a panel that needs scrolling is a panel nobody reads.
   */
  const openRows = await db
    .select({
      id: leads.id,
      customerId: leads.customerId,
      name: sql<string>`coalesce(
        ${customers.preferredName},
        trim(${customers.firstName} || ' ' || coalesce(${customers.lastName}, ''))
      )`,
      ref: customers.ref,
      title: leads.title,
      dueAt: leads.dueAt,
      assigneeId: leads.assigneeId,
      curatorName: users.name,
    })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .leftJoin(users, eq(users.id, leads.assigneeId))
    .where(
      mine
        ? and(eq(leads.status, "new"), isNull(customers.archivedAt), mine)
        : and(eq(leads.status, "new"), isNull(customers.archivedAt)),
    )
    .orderBy(leads.dueAt)
    .limit(12);

  const taskRows = await db
    .select({
      id: tasks.id,
      leadId: tasks.leadId,
      title: tasks.title,
      dueDate: tasks.dueDate,
      customerId: tasks.customerId,
      name: sql<string | null>`coalesce(
        ${customers.preferredName},
        trim(${customers.firstName} || ' ' || coalesce(${customers.lastName}, ''))
      )`,
    })
    .from(tasks)
    .leftJoin(customers, eq(customers.id, tasks.customerId))
    .where(
      and(
        notInArray(tasks.status, ["done", "cancelled"]),
        sql`${tasks.dueDate} is not null`,
        wholeDesk ? undefined : eq(tasks.assigneeId, actor.id),
      ),
    )
    .orderBy(tasks.dueDate)
    .limit(12);

  /*
   * What is coming up for the people whose records these are.
   *
   * A birthday is not a lead and nobody is chased about one, but it is the
   * other thing the desk must not miss, and it is missed in exactly the same
   * way: by being somewhere nobody looked. Thirty days is far enough to plan
   * and near enough that the panel is not a calendar.
   */
  const milestoneRows = await db
    .select({
      id: milestones.id,
      title: milestones.title,
      daysUntil: sql<number>`vara5_days_until(
        ${milestones.monthOfYear}, ${milestones.dayOfMonth}, current_date
      )`,
      nextOccurrence: sql<string>`vara5_next_occurrence(
        ${milestones.monthOfYear}, ${milestones.dayOfMonth}, current_date
      )`,
      customerId: milestones.customerId,
      customerName: sql<string | null>`coalesce(
        ${customers.preferredName},
        trim(${customers.firstName} || ' ' || coalesce(${customers.lastName}, ''))
      )`,
      customerRef: customers.ref,
      householdId: milestones.householdId,
      householdName: households.name,
    })
    .from(milestones)
    .leftJoin(customers, eq(customers.id, milestones.customerId))
    .leftJoin(households, eq(households.id, milestones.householdId))
    .where(
      and(
        eq(milestones.status, "active"),
        isNull(customers.archivedAt),
        sql`vara5_days_until(
          ${milestones.monthOfYear}, ${milestones.dayOfMonth}, current_date
        ) <= ${MILESTONE_HORIZON_DAYS}`,
        /*
         * A curator sees their own clients' dates. A household milestone has
         * no relationship manager of its own, so it belongs to whoever sees
         * the whole desk rather than to nobody.
         */
        wholeDesk ? undefined : eq(customers.primaryRmId, actor.id),
      ),
    )
    .orderBy(
      sql`vara5_days_until(${milestones.monthOfYear}, ${milestones.dayOfMonth}, current_date)`,
    )
    .limit(12);

  const now = new Date();
  const HOUR = 60 * 60 * 1000;

  /* The follow-ups hanging off each lead, so a lead is one row and not five. */
  const workFor = new Map<string, DeskSignal["tasks"]>();
  for (const row of taskRows) {
    if (!row.leadId) continue;
    const list = workFor.get(row.leadId) ?? [];
    list.push({ id: row.id, title: row.title, dueDate: row.dueDate });
    workFor.set(row.leadId, list);
  }

  const signals: DeskSignal[] = [];

  for (const row of openRows) {
    const overdue = row.dueAt < now;
    signals.push({
      id: `lead:${row.id}`,
      kind: "lead",
      tone: overdue
        ? "late"
        : row.dueAt.getTime() - now.getTime() <= 24 * HOUR
          ? "now"
          : "soon",
      title: row.title,
      who: row.name,
      ref: row.ref,
      href: `/clients/${row.customerId}`,
      dueAt: row.dueAt.toISOString(),
      dueDate: null,
      note: row.assigneeId ? row.curatorName : "nobody assigned",
      /* An unowned lead is late the moment it exists: nobody is answering it. */
      unowned: !row.assigneeId && wholeDesk,
      tasks: workFor.get(row.id) ?? [],
    });
  }

  for (const row of taskRows) {
    // Already shown under its lead; twice is noise, not emphasis.
    if (row.leadId && workFor.has(row.leadId)) continue;
    if (!row.dueDate) continue;
    if (row.dueDate > todayIso) continue;

    signals.push({
      id: `task:${row.id}`,
      kind: "task",
      tone: row.dueDate < todayIso ? "late" : "now",
      title: row.title,
      who: row.name,
      ref: null,
      href: row.customerId ? `/clients/${row.customerId}` : "/tasks",
      dueAt: null,
      dueDate: row.dueDate,
      note: null,
      unowned: false,
      tasks: [],
    });
  }

  for (const row of milestoneRows) {
    signals.push({
      id: `milestone:${row.id}`,
      kind: "milestone",
      tone: row.daysUntil === 0 ? "now" : row.daysUntil <= 2 ? "now" : "soon",
      title: row.title,
      who: row.customerName ?? row.householdName,
      ref: row.customerRef,
      href: row.customerId
        ? `/clients/${row.customerId}`
        : row.householdId
          ? `/households/${row.householdId}`
          : "/milestones",
      dueAt: null,
      dueDate: row.nextOccurrence,
      note: null,
      unowned: false,
      tasks: [],
    });
  }

  /*
   * Ranked by how late it is, never by what kind of thing it is.
   *
   * A birthday this afternoon matters more than a lead due on Friday, and a
   * panel sorted into "leads, then tasks, then milestones" buries it under a
   * heading. One list, most urgent first, is the only order somebody reading
   * it for two seconds can act on.
   */
  const TONE_RANK = { late: 0, now: 1, soon: 2 } as const;
  signals.sort((a, b) => {
    if (a.tone !== b.tone) return TONE_RANK[a.tone] - TONE_RANK[b.tone];
    return dueMillis(a) - dueMillis(b);
  });

  return {
    wholeDesk,
    signals,
    waiting: counts?.waiting ?? 0,
    overdue: counts?.overdue ?? 0,
    // Only meaningful to somebody who can act on it.
    unassigned: wholeDesk ? (counts?.unassigned ?? 0) : 0,
    working: counts?.working ?? 0,
    dueToday: work?.dueToday ?? 0,
    lateTasks: work?.late ?? 0,
    milestones: milestoneRows.length,
  };
}

/** Where a signal sits in time, whether it carries a timestamp or a date. */
function dueMillis(signal: DeskSignal): number {
  if (signal.dueAt) return Date.parse(signal.dueAt);
  if (signal.dueDate) return Date.parse(`${signal.dueDate}T00:00:00Z`);
  return Number.MAX_SAFE_INTEGER;
}
