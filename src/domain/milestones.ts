import { z } from "zod";
import { isoDate, optionalText, requiredText, uuidSchema } from "./shared";

export const MILESTONE_TYPES = [
  "birthday",
  "wedding_anniversary",
  "work_anniversary",
  "religious",
  "memorial",
  "other",
] as const;

export const MILESTONE_TYPE_LABELS: Record<
  (typeof MILESTONE_TYPES)[number],
  string
> = {
  birthday: "Birthday",
  wedding_anniversary: "Wedding anniversary",
  work_anniversary: "Work anniversary",
  religious: "Religious or festival",
  memorial: "Memorial",
  other: "Other important date",
};

export const createMilestoneSchema = z
  .object({
    customerId: uuidSchema.nullable().optional().transform((v) => v ?? null),
    householdId: uuidSchema.nullable().optional().transform((v) => v ?? null),
    type: z.enum(MILESTONE_TYPES),
    title: requiredText("Title", 150),
    date: isoDate,
    recursAnnually: z.boolean().default(true),
    celebrationStyle: optionalText,
    notes: optionalText,
    reminderDaysBefore: z
      .array(z.number().int().min(0).max(365))
      .max(6)
      .default([30, 7, 1]),
  })
  .refine(
    (value) => Boolean(value.customerId) !== Boolean(value.householdId),
    {
      message: "A milestone belongs to either a client or a household, not both",
      path: ["customerId"],
    },
  );

export const updateMilestoneSchema = z.object({
  id: uuidSchema,
  type: z.enum(MILESTONE_TYPES).optional(),
  title: requiredText("Title", 150).optional(),
  date: isoDate.optional(),
  recursAnnually: z.boolean().optional(),
  celebrationStyle: optionalText,
  notes: optionalText,
  reminderDaysBefore: z.array(z.number().int().min(0).max(365)).max(6).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export type CreateMilestoneInput = z.input<typeof createMilestoneSchema>;
export type UpdateMilestoneInput = z.input<typeof updateMilestoneSchema>;

/** Ordinal age or count at the next occurrence, e.g. a 40th birthday. */
export function occurrenceNumber(
  originalDate: string,
  nextOccurrence: Date | string,
): number | null {
  const original = new Date(originalDate);
  const next = new Date(nextOccurrence);
  if (Number.isNaN(original.getTime()) || Number.isNaN(next.getTime())) {
    return null;
  }
  const years = next.getUTCFullYear() - original.getUTCFullYear();
  return years > 0 ? years : null;
}
