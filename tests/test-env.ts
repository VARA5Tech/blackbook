import {
  assertSafeToMutate,
  resolveDevDatabaseUrl,
} from "@/db/url";

/**
 * Single definition of the test database, shared by the global setup process
 * and each worker.
 *
 * Derived from DEV_DATABASE_URL, never from DATABASE_URL, because the suite
 * drops and recreates its database and DATABASE_URL is production.
 */
export const TEST_DB_NAME = "vara5_crm_test";

let cached: string | undefined;

/**
 * Resolved once and remembered. `tests/setup.ts` rewrites DEV_DATABASE_URL to
 * the test database immediately afterwards, so a second resolution would read
 * back its own answer.
 */
function devUrl(): string {
  if (cached) return cached;
  const url = resolveDevDatabaseUrl();
  assertSafeToMutate(url, "run the test suite");
  cached = url;
  return url;
}

export function testDatabaseUrl(): string {
  const base = devUrl();
  if (base.endsWith(`/${TEST_DB_NAME}`)) return base;

  const url = new URL(base);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

export function adminDatabaseUrl(): string {
  const url = new URL(devUrl());
  url.pathname = "/postgres";
  return url.toString();
}
