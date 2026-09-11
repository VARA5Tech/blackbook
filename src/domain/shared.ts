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
