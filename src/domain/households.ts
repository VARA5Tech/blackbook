import { z } from "zod";
import {
  executiveAssistantFields,
  optionalEnum,
  optionalText,
  requiredText,
  uuidSchema,
} from "./shared";

export const TRAVEL_PATTERNS = [
  "couple",
  "family",
  "multi_generational",
] as const;

export const TRAVEL_PATTERN_LABELS: Record<
  (typeof TRAVEL_PATTERNS)[number],
  string
> = {
  couple: "Couple",
  family: "Family",
  multi_generational: "Multi-generational",
};

export const createHouseholdSchema = z.object({
  name: requiredText("Household name", 150),
  city: optionalText,
  travelPattern: optionalEnum(TRAVEL_PATTERNS),
  notes: optionalText,
  ...executiveAssistantFields,
  primaryCustomerId: uuidSchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export const updateHouseholdSchema = createHouseholdSchema
  .partial()
  .extend({ id: uuidSchema });

export const householdMemberSchema = z.object({
  householdId: uuidSchema,
  customerId: uuidSchema,
  householdRole: optionalEnum([
    "primary",
    "spouse",
    "partner",
    "child",
    "parent",
    "sibling",
    "other",
  ] as const),
});

export type CreateHouseholdInput = z.input<typeof createHouseholdSchema>;
export type UpdateHouseholdInput = z.input<typeof updateHouseholdSchema>;
export type HouseholdMemberInput = z.input<typeof householdMemberSchema>;

/** How the households list can be ordered, and which way each starts. */
export const HOUSEHOLD_SORTS = ["name", "members", "city", "updated"] as const;
export type HouseholdSort = (typeof HOUSEHOLD_SORTS)[number];
export const HOUSEHOLD_SORT_DEFAULT_DIRECTION: Record<HouseholdSort, "asc" | "desc"> = {
  name: "asc",
  members: "desc",
  city: "asc",
  updated: "desc",
};
