import { z } from "zod";
import {
  isoDate,
  optionalEmail,
  optionalEnum,
  optionalIsoDate,
  optionalPhone,
  optionalText,
  requiredText,
  uuidSchema,
} from "./shared";

export const GENDERS = ["male", "female", "other", "prefer_not_to_say"] as const;
export const CLIENT_STATUSES = ["active", "inactive"] as const;
export const HOUSEHOLD_ROLES = [
  "primary",
  "spouse",
  "partner",
  "child",
  "parent",
  "sibling",
  "other",
] as const;

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export const customerIdentitySchema = z.object({
  firstName: requiredText("First name", 100),
  lastName: optionalText,
  preferredName: optionalText,
  mobile: optionalPhone,
  whatsapp: optionalPhone,
  email: optionalEmail,
  dateOfBirth: optionalIsoDate,
  gender: optionalEnum(GENDERS),
  nationality: optionalText,
  city: optionalText,
  address: optionalText,
  locationUrl: optionalText,
  householdId: uuidSchema.nullable().optional().transform((v) => v ?? null),
  householdRole: optionalEnum(HOUSEHOLD_ROLES),
  primaryRmId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  customerSince: isoDate,
  status: z.enum(CLIENT_STATUSES).default("active"),
});

export const createCustomerSchema = customerIdentitySchema;
export const updateCustomerSchema = customerIdentitySchema.partial().extend({
  id: uuidSchema,
});

export type CreateCustomerInput = z.input<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;

/* ------------------------------------------------------------------ */
/* Client DNA and directives                                           */
/* ------------------------------------------------------------------ */

/**
 * Blank entries are dropped rather than rejected.
 *
 * A half-typed row is a normal state in the editor, and an import or an AI tool
 * may well send one. Silently discarding it is friendlier than failing the
 * whole save, and it matches what the editor already does before submitting.
 */
const directiveList = z
  .array(z.string().max(300))
  .max(20)
  .default([])
  .transform((items) =>
    items.map((item) => item.trim()).filter((item) => item.length > 0),
  );

export const clientDnaSchema = z.object({
  customerId: uuidSchema,
  clientDna: optionalText,
  dos: directiveList,
  donts: directiveList,
});

export type ClientDnaInput = z.input<typeof clientDnaSchema>;

/* ------------------------------------------------------------------ */
/* Search and filtering                                                */
/* ------------------------------------------------------------------ */

export const clientSearchSchema = z.object({
  /**
   * Free text matched against name, reference, mobile, email and city.
   *
   * Control characters are removed at the boundary rather than in one query
   * builder, because the term reaches several clauses. A NUL byte in any of
   * them is rejected by the driver before Postgres sees it, which would turn a
   * stray paste into a failed search rather than an empty one.
   */
  q: z
    .string()
    .transform((value) => value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim())
    .pipe(z.string().max(120))
    .optional(),
  status: z.enum(CLIENT_STATUSES).optional(),
  rmId: z.string().optional(),
  city: z.string().trim().optional(),
  /** Catalogue option ids the client must prefer. */
  prefers: z.array(uuidSchema).default([]),
  /** Catalogue option ids the client must avoid. */
  avoids: z.array(uuidSchema).default([]),
  householdId: uuidSchema.optional(),
  /** Clients with no interaction recorded in this many days. */
  notContactedInDays: z.coerce.number().int().min(1).max(3650).optional(),
  includeArchived: z.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z
    .enum(["relevance", "name", "recent", "last_interaction"])
    .default("relevance"),
});

export type ClientSearchInput = z.input<typeof clientSearchSchema>;
export type ClientSearchQuery = z.output<typeof clientSearchSchema>;

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

export function displayName(customer: {
  firstName: string;
  lastName: string | null;
  preferredName: string | null;
}): string {
  const full = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ");
  return customer.preferredName?.trim() || full;
}

export function fullName(customer: {
  firstName: string;
  lastName: string | null;
}): string {
  return [customer.firstName, customer.lastName].filter(Boolean).join(" ");
}

export function initials(customer: {
  firstName: string;
  lastName: string | null;
}): string {
  const first = customer.firstName.charAt(0);
  const last = customer.lastName?.charAt(0) ?? "";
  return (first + last).toUpperCase();
}

export const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  prefer_not_to_say: "Prefer not to say",
};

export const HOUSEHOLD_ROLE_LABELS: Record<
  (typeof HOUSEHOLD_ROLES)[number],
  string
> = {
  primary: "Primary client",
  spouse: "Spouse",
  partner: "Partner",
  child: "Child",
  parent: "Parent",
  sibling: "Sibling",
  other: "Other",
};
