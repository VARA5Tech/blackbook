import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DatabaseUrlError,
  assertSafeToMutate,
  isProductionUrl,
  resolveRuntimeDatabaseUrl,
  resolveToolDatabaseUrl,
} from "@/db/url";
import { logger } from "@/lib/logger";

/**
 * Guard rails around which database a process talks to, and around the one
 * piece of logging that decides whether a production failure is diagnosable.
 *
 * Neither needs a database, but both have already caused real damage once: the
 * suite truncated a developer's own data when the resolver preferred a variable
 * the tests had not set, and a permission denial in production was logged as
 * `Failed query: select ...` with the reason discarded. These are the tests
 * that would have caught each.
 */

const LOCAL = "postgresql://vara5:pw@localhost:5433/vara5_crm";
const CONTAINER = "postgresql://postgres:pw@crm-supabase-ndzmpz-db-1:5432/postgres";
const TUNNEL = "postgresql://postgres:pw@127.0.0.1:6543/postgres";

/**
 * Builds an environment to resolve against. Every resolver takes one as an
 * argument precisely so these decisions can be tested without mutating the
 * process, which the other suites depend on.
 */
function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("database target resolution", () => {
  it("keeps the tunnel out of the application's own resolution", () => {
    // The running app has no tunnel case at all: a forwarded port on a laptop
    // must never be able to become the production connection.
    const resolved = resolveRuntimeDatabaseUrl(
      env({
        NODE_ENV: "production",
        DATABASE_URL: CONTAINER,
        PROD_TUNNEL_DATABASE_URL: TUNNEL,
      }),
    );
    expect(resolved).toBe(CONTAINER);
  });

  it("prefers the tunnel for a production command-line target", () => {
    // The container name does not resolve off the server, so a tool asking for
    // production from a laptop wants the tunnel when one is configured.
    const resolved = resolveToolDatabaseUrl(
      "production",
      env({ DATABASE_URL: CONTAINER, PROD_TUNNEL_DATABASE_URL: TUNNEL }),
    );
    expect(resolved).toBe(TUNNEL);
  });

  it("never falls back from development to production", () => {
    expect(() =>
      resolveToolDatabaseUrl("development", env({ DATABASE_URL: CONTAINER })),
    ).toThrow(DatabaseUrlError);
  });

  it("names Supabase's API as the wrong variable rather than failing to connect", () => {
    expect(() =>
      resolveRuntimeDatabaseUrl(
        env({
          NODE_ENV: "production",
          SUPABASE_URL: "https://crmdb.vara5.travel",
        }),
      ),
    ).toThrow(/PostgREST/);
  });
});

describe("assertSafeToMutate", () => {
  it("allows a local database", () => {
    expect(() =>
      assertSafeToMutate(LOCAL, "run the test suite", env({ DATABASE_URL: CONTAINER })),
    ).not.toThrow();
  });

  /**
   * The one that matters. A tunnel URL says 127.0.0.1 and reaches production,
   * so the hostname check would wave a table drop straight through.
   */
  it("refuses a tunnel even though it looks local", () => {
    expect(() =>
      assertSafeToMutate(
        TUNNEL,
        "run the test suite",
        env({ DATABASE_URL: CONTAINER, PROD_TUNNEL_DATABASE_URL: TUNNEL }),
      ),
    ).toThrow(/production/);
  });

  it("refuses the production URL even with the remote override set", () => {
    expect(() =>
      assertSafeToMutate(
        CONTAINER,
        "seed demo data",
        env({
          DATABASE_URL: CONTAINER,
          ALLOW_REMOTE_DESTRUCTIVE_DB: "i-understand-this-is-not-local",
        }),
      ),
    ).toThrow(DatabaseUrlError);
  });

  it("still allows a deliberate non-local, non-production target", () => {
    expect(() =>
      assertSafeToMutate(
        "postgresql://u:p@staging.example.com:5432/db",
        "seed demo data",
        env({
          DATABASE_URL: CONTAINER,
          ALLOW_REMOTE_DESTRUCTIVE_DB: "i-understand-this-is-not-local",
        }),
      ),
    ).not.toThrow();
  });

  it("identifies production by the URL, not by the host", () => {
    const both = env({
      DATABASE_URL: CONTAINER,
      PROD_TUNNEL_DATABASE_URL: TUNNEL,
    });
    expect(isProductionUrl(TUNNEL, both)).toBe(true);
    expect(isProductionUrl(CONTAINER, both)).toBe(true);
    expect(isProductionUrl(LOCAL, both)).toBe(false);
  });
});

describe("error logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the Postgres reason that Drizzle wraps away", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Shaped like what actually arrives: Drizzle's error carries the SQL, and
    // the driver's error underneath carries the code that names the fault.
    const driver = Object.assign(
      new Error("permission denied for table preference_option"),
      {
        name: "PostgresError",
        code: "42501",
        severity: "ERROR",
        table_name: "preference_option",
        detail: "Key (email)=(someone@example.com) already exists.",
      },
    );
    const wrapper = new Error(
      'Failed query: select count(*)::int from "preference_option"',
      { cause: driver },
    );

    logger.error("bootstrap.failed", wrapper);

    const line = String(spy.mock.calls[0][0]);
    expect(line).toContain("42501");
    expect(line).toContain("permission denied");
    expect(line).toContain("preference_option");

    // `detail` quotes the offending values, and this is a CRM.
    expect(line).not.toContain("someone@example.com");
  });

  it("does not loop for ever on a circular cause", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    first.cause = second;

    logger.error("cycle", second);

    expect(spy).toHaveBeenCalledOnce();
  });
});
