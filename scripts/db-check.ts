/**
 * Connection preflight.
 *
 *   pnpm db:check
 *
 * Run this against a new database before migrating. It reports whether the
 * connection works, whether the server is a supported Postgres, whether the
 * extensions the schema needs are available, and whether the role can create
 * them. Every check that can fail on a self-hosted Supabase is covered, so a
 * bad connection string is diagnosed here rather than halfway through a
 * migration.
 */
import postgres from "postgres";
import { resolveToolDatabaseUrl, type DatabaseTarget } from "@/db/url";

type Check = { label: string; ok: boolean; detail: string };

const checks: Check[] = [];

function record(label: string, ok: boolean, detail: string) {
  checks.push({ label, ok, detail });
}

async function main() {
  const target: DatabaseTarget =
    process.env.DB_TARGET === "production" ? "production" : "development";

  let url: string;
  try {
    url = resolveToolDatabaseUrl(target);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  console.log(`Target    ${target}`);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error("DATABASE_URL is not a valid URL.");
    process.exit(1);
  }

  const port = parsed.port || "5432";
  const user = decodeURIComponent(parsed.username);

  console.log(`Host      ${parsed.hostname}`);
  console.log(`Port      ${port}`);
  console.log(`Database  ${parsed.pathname.replace(/^\//, "")}`);
  console.log(`User      ${user}`);
  console.log(`SSL       ${parsed.searchParams.get("sslmode") ?? "not specified"}`);
  console.log("");

  /**
   * Self-hosted Supabase puts Supavisor in front of Postgres on both 5432
   * (session mode) and 6543 (transaction mode). Either way the pooler needs the
   * tenant in the username, as postgres.<POOLER_TENANT_ID>. Without it the
   * server answers "Tenant or user not found", which reads like a bad password
   * and sends people looking in the wrong place.
   */
  if (user.includes(".")) {
    record("pooler username", true, `tenant "${user.split(".").slice(1).join(".")}" present`);
  }

  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 5,
  });

  try {
    const [{ version }] = await sql`select version()`;
    const major = Number(/PostgreSQL (\d+)/.exec(version as string)?.[1] ?? 0);
    record("connection", true, "reachable");
    record(
      "postgres version",
      major >= 14,
      major >= 14
        ? `major ${major}`
        : `major ${major}; the schema needs 14 or newer`,
    );

    const [{ now }] = await sql`select now() as now`;
    record("clock", true, String(now));

    for (const extension of ["pg_trgm", "unaccent"]) {
      const installed = await sql`
        select 1 from pg_extension where extname = ${extension}
      `;
      if (installed.length > 0) {
        record(`extension ${extension}`, true, "installed");
        continue;
      }

      const available = await sql`
        select 1 from pg_available_extensions where name = ${extension}
      `;
      if (available.length === 0) {
        record(
          `extension ${extension}`,
          false,
          "not installed and not available on this server",
        );
        continue;
      }

      try {
        await sql.unsafe(`create extension if not exists ${extension}`);
        record(`extension ${extension}`, true, "created just now");
      } catch (error) {
        record(
          `extension ${extension}`,
          false,
          `available but this role cannot create it: ${(error as Error).message}`,
        );
      }
    }

    // The schema needs to create tables, sequences, functions and triggers.
    try {
      await sql.unsafe(`
        create table if not exists vara5_preflight (id int primary key);
        drop table vara5_preflight;
      `);
      record("create table", true, "permitted");
    } catch (error) {
      record("create table", false, (error as Error).message);
    }

    try {
      await sql.unsafe(`
        create or replace function vara5_preflight_fn() returns int
          language sql immutable as $$ select 1 $$;
        drop function vara5_preflight_fn();
      `);
      record("create function", true, "permitted");
    } catch (error) {
      record("create function", false, (error as Error).message);
    }
  } catch (error) {
    const message = (error as Error).message;
    record("connection", false, message);

    if (/tenant or user not found/i.test(message)) {
      record(
        "diagnosis",
        false,
        "Supavisor does not know this tenant. It keeps its tenant registry in its own " +
          "metadata database, written once when the stack first boots. Editing " +
          "POOLER_TENANT_ID and redeploying does not rewrite that row, so a new id is " +
          "never registered. Either use the id the pooler was first provisioned with, or " +
          "connect to Postgres directly and skip the pooler.",
      );
    } else if (/SASL_SIGNATURE_MISMATCH|SCRAM/i.test(message)) {
      record(
        "diagnosis",
        false,
        "The tenant exists but its stored password does not match. Supavisor holds the " +
          "database credentials on the tenant record in its metadata database, captured at " +
          "first boot, so changing POSTGRES_PASSWORD afterwards leaves the pooler using the " +
          "old one. Same root cause as an unknown tenant: stale pooler metadata.",
      );
    } else if (/password authentication failed/i.test(message)) {
      record("diagnosis", false, "Username reached the server but the password was rejected.");
    } else if (/CONNECT_TIMEOUT|ECONNREFUSED/i.test(message)) {
      record(
        "diagnosis",
        false,
        "Nothing accepted a connection. Check the port is published and not behind an HTTP-only proxy.",
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  for (const check of checks) {
    console.log(`${check.ok ? "ok  " : "FAIL"}  ${check.label.padEnd(22)} ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  console.log("");
  if (failed.length === 0) {
    console.log("Ready. Next: pnpm db:migrate");
    return;
  }

  console.log(`${failed.length} check(s) failed. Fix those before migrating.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
