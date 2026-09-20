import { vi } from "vitest";
import { testDatabaseUrl } from "./test-env";

/**
 * Point every database variable at the throwaway test database.
 *
 * Both are set deliberately. The runtime client prefers DEV_DATABASE_URL
 * outside production, so setting only DATABASE_URL left the suite writing to
 * the developer's own database while appearing to be isolated: the tests
 * passed, and the local demo data quietly disappeared.
 *
 * This must happen before any module that reads either variable is imported,
 * which is why it is a setup file rather than a per-test call.
 */
const testUrl = testDatabaseUrl();

process.env.DATABASE_URL = testUrl;
process.env.DEV_DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-not-used-for-signing-anything";

/**
 * Never email anyone from a test run. The config loads `.env.local`, which holds
 * a real Resend key, so without this an invitation test would send real mail.
 * With no key, `sendEmail` prints to the console, which tests read instead.
 */
process.env.RESEND_API_KEY = "";

/**
 * Never reach PostHog from a test run either, for the same reason and one more.
 *
 * `.env.local` holds a real personal API key that reads the whole project, so a
 * test touching a replay or the members' screen would query live data, spend
 * quota against a rate limit the application shares, and answer differently
 * depending on what clients happened to be browsing that day. Unset, every one
 * of those reads takes its documented "not configured" path, which is the one
 * worth asserting anyway.
 */
process.env.POSTHOG_API_KEY = "";
process.env.POSTHOG_PROJECT_ID = "";

/**
 * The runtime resolver is the thing that actually decides, so assert against it
 * rather than against what we just set. If a future change alters that
 * precedence, the suite stops here instead of silently truncating real data.
 */
const { resolveRuntimeDatabaseUrl } = await import("@/db/url");
const resolved = resolveRuntimeDatabaseUrl();

if (resolved !== testUrl) {
  throw new Error(
    `Test isolation is broken. The database client would use ${resolved}\n` +
      `instead of the test database ${testUrl}. Refusing to run.`,
  );
}

/**
 * The only thing stubbed in the whole suite: reading the actor out of an HTTP
 * request. Everything above it is real, so `requireCapability` and the
 * capability table are genuinely exercised rather than bypassed.
 */
vi.mock("@/auth/current-actor", () => ({
  readActorFromRequest: async () => currentActor,
}));

export type TestActor = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "rm" | "viewer";
};

let currentActor: TestActor | null = null;

export function actingAs(actor: TestActor | null): void {
  currentActor = actor;
}

export function getCurrentTestActor(): TestActor | null {
  return currentActor;
}
