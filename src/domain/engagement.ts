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
