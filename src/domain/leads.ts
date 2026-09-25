import { z } from "zod";
import { optionalText, requiredText, uuidSchema } from "./shared";

/**
 * A lead's commercial state, which is not the same question as whether a piece
 * of work is finished.
 *
 * `new` is the only state nobody has touched, and the only one the clock runs
 * against: once a curator has made contact the firm has answered, and how long
 * the trip then takes to plan is not a service failure.
 */
export const LEAD_STATUSES = [
  "new",
  "acknowledged",
  "planning",
  "booking",
  "won",
  "dropped",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "Not yet answered",
  acknowledged: "Contacted",
  planning: "Planning",
  booking: "Booking",
  won: "Booked",
  dropped: "Dropped",
};

/** The states somebody still owes the client something. */
export const OPEN_LEAD_STATUSES: LeadStatus[] = [
  "new",
  "acknowledged",
  "planning",
  "booking",
];

export const isOpenLead = (status: LeadStatus) =>
  OPEN_LEAD_STATUSES.includes(status);

/**
 * How long the desk has before a lead is late.
 *
 * Two days from the ask, which is the firm's own promise. The industry
 * benchmark for a first reply is nearer four hours, so this is deliberately
 * generous and is kept here as one number rather than spread through the
 * service, so tightening it later is a single edit.
 */
export const LEAD_WINDOW_HOURS = 48;

/** How long after that before the administrators are told as well. */
export const LEAD_ESCALATION_HOURS = 24;

export const LEAD_ESCALATION_LEVELS = {
  none: 0,
  /** Curator and the managers. */
  chased: 1,
  /** Administrators too. */
  escalated: 2,
} as const;

export function dueFrom(raised: Date): Date {
  return new Date(raised.getTime() + LEAD_WINDOW_HOURS * 60 * 60 * 1000);
}

/* ------------------------------------------------------------------ */
/* What the screens may ask for                                        */
/* ------------------------------------------------------------------ */

export const assignLeadSchema = z.object({
  leadId: uuidSchema,
  /** Null hands it back to nobody, which starts the escalation again. */
  assigneeId: uuidSchema.nullable(),
});

export const acknowledgeLeadSchema = z.object({
  leadId: uuidSchema,
  note: optionalText,
});

/**
 * Moving a lead on, or ending it.
 *
 * A drop needs a reason in writing. It is the one transition that cannot be
 * undone by simply carrying on, and "why did we not pursue this" is the
 * question somebody asks three months later.
 */
export const advanceLeadSchema = z
  .object({
    leadId: uuidSchema,
    status: z.enum(["planning", "booking", "won", "dropped"]),
    note: optionalText,
    droppedReason: optionalText,
  })
  .refine(
    (value) =>
      value.status !== "dropped" ||
      (value.droppedReason !== null && value.droppedReason !== undefined),
    { message: "Say why it was dropped", path: ["droppedReason"] },
  );

export const LEAD_SOURCES = [
  "website",
  "phone",
  "email",
  "whatsapp",
  "referral",
  "in_person",
  "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  website: "vara5.com",
  phone: "Telephone",
  email: "Email",
  whatsapp: "WhatsApp",
  referral: "Referral",
  in_person: "In person",
  other: "Other",
};

/** What somebody at the desk can record. The site reports itself. */
export const MANUAL_LEAD_SOURCES = LEAD_SOURCES.filter(
  (source) => source !== "website",
);

/**
 * A lead somebody at the desk is writing down.
 *
 * The same record the website creates, so it gets the same clock, the same
 * task, the same chasing and the same place in the figures. A client who
 * telephones is no less of an ask than one who taps a button.
 */
export const createLeadSchema = z.object({
  customerId: uuidSchema,
  title: requiredText("What they asked about", 200),
  source: z.enum(["phone", "email", "whatsapp", "referral", "in_person", "other"]),
  note: optionalText,
});

export type CreateLeadInput = z.input<typeof createLeadSchema>;

/**
 * A remark on the lead, which is not the same act as answering it.
 *
 * Saving one used to go through the acknowledgement, which does nothing once a
 * lead has moved past `new` — so a remark on a lead in Booking was silently
 * dropped and the screen said it had saved.
 */
export const remarkLeadSchema = z.object({
  leadId: uuidSchema,
  remark: requiredText("Remark", 2000),
});

export type RemarkLeadInput = z.input<typeof remarkLeadSchema>;
export type AssignLeadInput = z.input<typeof assignLeadSchema>;
export type AcknowledgeLeadInput = z.input<typeof acknowledgeLeadSchema>;
export type AdvanceLeadInput = z.input<typeof advanceLeadSchema>;
