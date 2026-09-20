import { z } from "zod";

/**
 * Account rules shared by the browser, the services and Better Auth: who can
 * hold an account, and how long a code lasts
 * last.
 */
export const STAFF_EMAIL_DOMAIN = "vara5.com";
export const STAFF_EMAIL_SUFFIX = `@${STAFF_EMAIL_DOMAIN}`;
export const STAFF_DOMAIN_MESSAGE = `Only ${STAFF_EMAIL_SUFFIX} addresses can have a Blackbook account.`;


/** An invited account nobody sets up within this many days is deleted. */
export const INVITATION_DAYS = 2;

/**
 * How long an emailed code lasts, whatever it is for.
 *
 * One number rather than one per purpose, because the plugin takes a single
 * `expiresIn` for every type it issues. Two constants would read as a choice
 * nobody can actually make.
 */
export const EMAIL_CODE_MINUTES = 10;

/**
 * Lower-cases and trims, and completes a bare name with the Vara5 domain, so
 * "Priya.Nair" and " priya.nair@VARA5.com " are the same address.
 */
export function normaliseStaffEmail(raw: string): string {
  const value = raw.trim().toLowerCase();
  return value.includes("@") ? value : `${value}${STAFF_EMAIL_SUFFIX}`;
}

/**
 * Exactly one @, a local part, and the Vara5 domain itself. Not a subdomain and
 * not a lookalike such as vara5.com.example.net.
 */
export function isStaffEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  const at = value.indexOf("@");
  return (
    at > 0 &&
    at === value.lastIndexOf("@") &&
    value.slice(at) === STAFF_EMAIL_SUFFIX
  );
}

/** What the form keeps when someone pastes a full Vara5 address: the part before @. */
export function staffEmailLocalPart(value: string): string {
  return value.trim().toLowerCase().endsWith(STAFF_EMAIL_SUFFIX)
    ? value.trim().slice(0, -STAFF_EMAIL_SUFFIX.length)
    : value;
}

export const staffEmailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .transform(normaliseStaffEmail)
  .pipe(
    z
      .email("Enter a valid email address")
      .refine(isStaffEmail, STAFF_DOMAIN_MESSAGE),
  );
