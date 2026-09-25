import { execSync } from "node:child_process";
import postgres from "postgres";
import { TEST_DB_NAME, adminDatabaseUrl, testDatabaseUrl } from "./test-env";

/**
 * Creates a dedicated test database next to the development one and applies
 * every migration to it.
 *
 * Tests run against real Postgres rather than a mock, because a large part of
 * what is being verified lives in the database itself: generated columns, the
 * partial unique index on phone numbers, the one-number trigger, the check
 * constraints and the milestone date functions.
 */
export async function setup() {
  const testUrl = testDatabaseUrl();
  const admin = postgres(adminDatabaseUrl(), { max: 1, prepare: false });

  try {
    // Dropped and recreated so a schema change never leaves a stale test database.
    await admin.unsafe(`drop database if exists "${TEST_DB_NAME}" with (force)`);
    await admin.unsafe(`create database "${TEST_DB_NAME}"`);
  } finally {
    await admin.end();
  }

  const bootstrap = postgres(testUrl, { max: 1, prepare: false });
  try {
    await bootstrap.unsafe("create extension if not exists pg_trgm");
    await bootstrap.unsafe("create extension if not exists unaccent");
  } finally {
    await bootstrap.end();
  }

  /**
   * Both variables are overridden. drizzle.config.ts resolves the development
   * target from DEV_DATABASE_URL, so passing only DATABASE_URL migrated the
   * developer's own database and left the test database empty.
   */
  execSync("pnpm exec drizzle-kit migrate", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: testUrl,
      DEV_DATABASE_URL: testUrl,
    },
  });
}
