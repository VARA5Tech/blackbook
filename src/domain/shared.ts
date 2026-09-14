import { z } from "zod";

/** Trims, then treats an empty string as "not provided". */
export const optionalText = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional()
  .transform((value) => value ?? null);

export const requiredText = (label: string, max = 200) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

export const uuidSchema = z.uuid("Expected a valid identifier");

/**
 * UUIDv7 in application code, the same shape `vara5_uuid_v7()` mints in the
 * database, for the few keys written from TypeScript: staff accounts, and the
 * sessions and tokens Better Auth writes itself.
 *
 * RFC 9562: 48 bits of milliseconds since the epoch, version nibble 7, then
 * random bits with the variant set to 10. Later keys sort after earlier ones.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Big-endian milliseconds in the first six bytes. Arithmetic rather than bit
  // shifts, because JavaScript shifts truncate to 32 bits and this needs 48.
  let millis = now;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = millis % 256;
    millis = Math.floor(millis / 256);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** ISO date (YYYY-MM-DD), which is how Drizzle hands us a `date` column. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD form");

export const optionalIsoDate = z
  .union([isoDate, z.literal("")])
  .optional()
  .transform((value) => (value ? value : null));

export const optionalEmail = z
  .union([z.email("Enter a valid email address"), z.literal("")])
  .optional()
  .transform((value) => (value ? value.toLowerCase() : null));

/**
 * Phone numbers arrive in many shapes (+91 98100 11223, 09810011223).
 * Storage keeps what the user typed; the database derives a digits-only column
 * for duplicate detection, so validation only checks it is plausible.
 */
export const optionalPhone = z
  .union([
    z
      .string()
      .trim()
      .regex(/^[+\d][\d\s()\-.]{6,24}$/, "Enter a valid phone number"),
    z.literal(""),
  ])
  .optional()
  .transform((value) => (value ? value : null));

/**
 * An executive assistant: the person the team deals with when a client, or a
 * whole household, prefers to be reached through them. There is at most one
 * per client and one per household, so these are fields, not a table.
 */
export const executiveAssistantFields = {
  eaName: optionalText,
  eaEmail: optionalEmail,
  eaPhone: optionalPhone,
  eaNotes: optionalText,
};

/** Empty-string-to-null wrapper for optional enum selects in HTML forms. */
export function optionalEnum<T extends readonly [string, ...string[]]>(
  values: T,
) {
  return z
    .union([z.enum(values), z.literal("")])
    .optional()
    .transform((value) => (value ? (value as T[number]) : null));
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function digitsOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * Keeps only the fields the caller actually sent.
 *
 * Several schemas here use `.optional().transform(v => v ?? null)`, which turns
 * an omitted field into null. That is right for a create, where null means "not
 * recorded", but wrong for a partial update: a form that submits only its own
 * section would blank every field it does not include. Consulting the raw input
 * keeps "omitted" and "explicitly cleared" distinct.
 */
export function onlyProvided<T extends Record<string, unknown>>(
  raw: Record<string, unknown>,
  parsed: T,
): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(parsed) as (keyof T)[]) {
    if (Object.hasOwn(raw, key as string)) result[key] = parsed[key];
  }
  return result;
}
