import { z } from "zod";

/**
 * Account rules shared by the browser, the services and Better Auth: who can
 * hold an account, how strong a password must be, and how long links and codes
 * last.
 */
export const STAFF_EMAIL_DOMAIN = "vara5.com";
export const STAFF_EMAIL_SUFFIX = `@${STAFF_EMAIL_DOMAIN}`;
export const STAFF_DOMAIN_MESSAGE = `Only ${STAFF_EMAIL_SUFFIX} addresses can have a Blackbook account.`;

export const MIN_STAFF_PASSWORD_LENGTH = 12;

/** An invited account nobody sets up within this many days is deleted. */
export const INVITATION_DAYS = 2;

/** How long a password reset code works. */
export const PASSWORD_RESET_CODE_MINUTES = 10;

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

export const staffPasswordSchema = z
  .string()
  .min(
    MIN_STAFF_PASSWORD_LENGTH,
    `Use at least ${MIN_STAFF_PASSWORD_LENGTH} characters`,
  )
  .max(200, "That is too long");

/** The same check the forms run before asking the server, or null when it passes. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_STAFF_PASSWORD_LENGTH) {
    return `Use at least ${MIN_STAFF_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) return "The two passwords do not match.";
  return null;
}
