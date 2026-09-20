import { z } from "zod";
import {
  executiveAssistantFields,
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
export const CLIENT_STATUSES = ["active", "inactive", "staff"] as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  staff: "Staff",
};

/**
 * The statuses that get past the members' gate.
 *
 * `staff` is in here on purpose: the record exists so somebody can sign in and
 * check the site. Everything downstream of the gate then treats them as what
 * they are, which is not a client.
 */
export const GATE_STATUSES = ["active", "staff"] as const;

/** Whose browsing counts as interest rather than testing. */
export function countsAsClient(status: ClientStatus): boolean {
  return status !== "staff";
}
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
  /** The catch-all box: anything that belongs on the client but nowhere else. */
  remarks: optionalText,
  ...executiveAssistantFields,
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

/**
 * What the client list can be ordered by.
 *
 * `relevance` only means anything while there is a search term; without one it
 * falls back to name, which is why it is the default rather than a column
 * anybody can click.
 */
export const CLIENT_SORTS = [
  "relevance",
  "name",
  "city",
  "manager",
  "status",
  "recent",
  "last_interaction",
] as const;

export type ClientSort = (typeof CLIENT_SORTS)[number];

/**
 * The columns the client list can show, declared once.
 *
 * The header, the cells and the chooser all read this, so a column cannot be
 * sortable in one place and not in another, or appear in the menu and nowhere
 * in the table. `on` is what a new reader sees before they choose anything.
 *
 * `city` is off by default on purpose: not one client in the book has one, so
 * it was a column of dashes taking width from something worth reading.
 */
export const CLIENT_COLUMNS = [
  { key: "household", label: "Household", sort: null, on: true },
  { key: "city", label: "City", sort: "city", on: false },
  { key: "manager", label: "Manager", sort: "manager", on: true },
  { key: "since", label: "Client since", sort: "recent", on: false },
  { key: "lastContacted", label: "Last contacted", sort: "last_interaction", on: true },
  { key: "status", label: "Status", sort: "status", on: true },
] as const satisfies readonly {
  key: string;
  label: string;
  sort: ClientSort | null;
  on: boolean;
}[];

export type ClientColumnKey = (typeof CLIENT_COLUMNS)[number]["key"];

export const DEFAULT_CLIENT_COLUMNS: ClientColumnKey[] = CLIENT_COLUMNS.filter(
  (column) => column.on,
).map((column) => column.key);

/** The direction a column opens in when it is first clicked. */
export const CLIENT_SORT_DEFAULT_DIRECTION: Record<ClientSort, "asc" | "desc"> = {
  relevance: "desc",
  name: "asc",
  city: "asc",
  manager: "asc",
  status: "asc",
  // Dates are asked "who most recently", not "who longest ago".
  recent: "desc",
  last_interaction: "desc",
};

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
  sort: z.enum(CLIENT_SORTS).default("relevance"),
  /**
   * Which way round. Every column declares the direction it should open in,
   * because the useful first answer differs: names read A to Z, but a date
   * column is asked "who most recently", not "who longest ago".
   */
  dir: z.enum(["asc", "desc"]).optional(),
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

type AssistantFields = {
  eaName: string | null;
  eaEmail: string | null;
  eaPhone: string | null;
  eaNotes: string | null;
};

export type ExecutiveAssistant = {
  name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /** True when the client has none of their own and this is the household's. */
  fromHousehold: boolean;
};

/**
 * Who to go through to reach a client: their own assistant, or else their
 * household's. Null when neither is recorded.
 */
export function executiveAssistantFor(
  customer: AssistantFields,
  household: AssistantFields | null,
): ExecutiveAssistant | null {
  const recorded = (row: AssistantFields) =>
    Boolean(row.eaName || row.eaEmail || row.eaPhone);
  const source = recorded(customer)
    ? customer
    : household && recorded(household)
      ? household
      : null;
  if (!source) return null;

  return {
    name: source.eaName,
    email: source.eaEmail,
    phone: source.eaPhone,
    notes: source.eaNotes,
    fromHousehold: source !== customer,
  };
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
