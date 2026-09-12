/**
 * Connection preflight for the development database.
 *
 *   pnpm db:check
 *
 * Run it against a fresh local Postgres before the first migration. It reports
 * whether the connection works, whether the server is a supported version,
 * whether the extensions the schema needs are present or creatable, and whether
 * the role may create tables and functions. A bad local setup is then diagnosed
 * here rather than halfway through a migration.
 *
 * Development only. Production has no socket a laptop can open, and `pnpm
 * db:query:prod` reads it over HTTPS instead.
 */
import postgres from "postgres";
import { resolveDevDatabaseUrl } from "@/db/url";

type Check = { label: string; ok: boolean; detail: string };

const checks: Check[] = [];

function record(label: string, ok: boolean, detail: string) {
  checks.push({ label, ok, detail });
}

async function main() {
  let url: string;
  try {
    url = resolveDevDatabaseUrl();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

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

    if (/password authentication failed/i.test(message)) {
      record("diagnosis", false, "Username reached the server but the password was rejected.");
    } else if (/ECONNREFUSED|CONNECT_TIMEOUT/i.test(message)) {
      record(
        "diagnosis",
        false,
        "Nothing accepted a connection. Is the local Postgres running? `pnpm db:up`.",
      );
    } else if (/ENOTFOUND/i.test(message)) {
      record(
        "diagnosis",
        false,
        "The host does not resolve. DEV_DATABASE_URL should point at localhost.",
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
