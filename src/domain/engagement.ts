import { z } from "zod";
import { optionalText, requiredText, uuidSchema } from "./shared";

/**
 * Pure vocabulary and validation for interactions, tasks and the audit trail.
 * Kept free of database imports so client components can use it directly.
 */

/* ---------------- interactions ---------------- */

export const INTERACTION_TYPES = [
  "call",
  "whatsapp",
  "email",
  "meeting",
  "trip",
  "note",
  "other",
] as const;

export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  email: "Email",
  meeting: "Meeting",
  trip: "Trip",
  note: "Note",
  other: "Other",
};

export const recordInteractionSchema = z.object({
  customerId: uuidSchema,
  type: z.enum(INTERACTION_TYPES),
  summary: requiredText("Summary", 300),
  details: optionalText,
  occurredAt: z
    .union([z.string(), z.date()])
    .optional()
    .transform((value) => (value ? new Date(value) : new Date())),
});

export type RecordInteractionInput = z.input<typeof recordInteractionSchema>;

/* ---------------- tasks ---------------- */

export const TASK_STATUSES = [
  "open",
  "in_progress",
  "done",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export const createTaskSchema = z.object({
  title: requiredText("Title", 200),
  details: optionalText,
  customerId: uuidSchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  assigneeId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  dueDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
});

export type CreateTaskInput = z.input<typeof createTaskSchema>;

/* ---------------- audit ---------------- */

/** Field names rendered in the timeline, so the audit reads like English. */
export const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  preferredName: "Preferred name",
  mobile: "Mobile number",
  whatsapp: "WhatsApp number",
  email: "Email",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  nationality: "Nationality",
  city: "City",
  address: "Address",
  locationUrl: "Location pin",
  householdId: "Household",
  householdRole: "Household role",
  primaryRmId: "Relationship manager",
  customerSince: "Client since",
  status: "Status",
  clientDna: "Client DNA",
  name: "Name",
  travelPattern: "Family travel pattern",
  notes: "Notes",
  title: "Title",
  date: "Date",
  celebrationStyle: "Celebration style",
};


/* ---------------- what the members' site reports ---------------- */

/**
 * The windows the analytics screen offers, and the only values that ever reach
 * a HogQL query. Here rather than beside the query because the range switch is
 * a client component and `src/lib/posthog.ts` is `server-only`.
 */
export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/**
 * How the members' site is doing, across every client at once.
 *
 * The shape is shared between the service that fills it from PostHog and the
 * screen that draws it, so it lives here where both can reach it.
 */
export type MemberAnalytics = {
  /** How far a guest gets: turning a card over, opening it, reading it, asking. */
  funnel: {
    flipped: number;
    opened: number;
    read: number;
    asked: number;
    clients: number;
    visits: number;
    seconds: number;
  };
  /** One row a day, for the trend. */
  daily: { day: string; visits: number; clients: number }[];
  /** Demand and intent, journey by journey. */
  journeys: {
    slug: string;
    title: string;
    flipped: number;
    opened: number;
    read: number;
    asked: number;
    clients: number;
    seconds: number;
  }[];
  /** Which parts of an itinerary get read. */
  sections: { key: string; label: string; views: number; clients: number }[];
  /** Who has been on the site, warmest first. Joins to a client record by id. */
  clients: {
    customerId: string;
    ref: string;
    name: string;
    visits: number;
    opened: number;
    asked: number;
    seconds: number;
    lastSeen: string;
  }[];
  /** How they read it. Worth knowing before sending a link. */
  devices: { device: string; sessions: number }[];
};

export const EMPTY_ANALYTICS: MemberAnalytics = {
  funnel: { flipped: 0, opened: 0, read: 0, asked: 0, clients: 0, visits: 0, seconds: 0 },
  daily: [],
  journeys: [],
  sections: [],
  clients: [],
  devices: [],
};
