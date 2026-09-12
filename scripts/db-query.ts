/**
 * A read-only SQL console, for one query at a time.
 *
 *   pnpm db:query      "select count(*) from customer"
 *   pnpm db:query:prod "select ref, status from customer limit 20"
 *   pnpm db:query:prod --file some-query.sql
 *
 * Two targets, two transports, because production is not reachable the way
 * development is.
 *
 *   development   Postgres over DEV_DATABASE_URL, a normal TCP connection.
 *   production    HTTPS to the Supabase stack's postgres-meta endpoint.
 *
 * The production database has no public Postgres port, and it should not have
 * one: DATABASE_URL names a Docker container, which resolves on the server and
 * nowhere else. But the Supabase stack that shares the database already
 * publishes `/pg/query` behind Kong, which runs SQL as the `postgres` role over
 * ordinary HTTPS. That is the route, and it needs no tunnel, no open port and
 * no VPN.
 *
 * Every statement is prefixed with `set transaction read only`. postgres-meta
 * runs each request inside a transaction, so Postgres itself refuses the write
 * with SQLSTATE 25006; there is no pattern for a caller to outwit. Writes to
 * production belong in a migration or in the application, where they are
 * reviewed and leave an audit row. `--write` lifts the restriction, and against
 * production it additionally demands a phrase typed out in full.
 *
 * Output goes to a terminal, not to a log, so it prints real client values.
 * `src/lib/logger.ts` is the thing that must never do that.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { describeDatabase, resolveDevDatabaseUrl } from "@/db/url";

type Target = "development" | "production";

const WRITE_OVERRIDE = "i-understand-this-writes-to-production";
const READ_ONLY = "set transaction read only;";

type Options = {
  target: Target;
  sql: string;
  write: boolean;
  json: boolean;
};

function parseArgs(argv: string[]): Options {
  const target: Target =
    process.env.DB_TARGET === "production" ? "production" : "development";

  let write = false;
  let json = false;
  let file: string | null = null;
  const rest: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") write = true;
    else if (arg === "--json") json = true;
    else if (arg === "--file") file = argv[++index] ?? null;
    else if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else rest.push(arg);
  }

  const sql = file ? readFileSync(file, "utf8") : rest.join(" ");
  return { target, sql: sql.trim(), write, json };
}

function usage(): never {
  console.error(
    [
      "Usage:",
      '  pnpm db:query      "select ..."',
      '  pnpm db:query:prod "select ..."',
      "  pnpm db:query:prod --file path/to/query.sql",
      "",
      "Flags:",
      "  --json    print rows as JSON instead of a table",
      "  --write   allow writes (production needs ALLOW_PROD_WRITE_QUERY too)",
    ].join("\n"),
  );
  process.exit(2);
}

type Row = Record<string, unknown>;

/** Runs the query against the local database over a normal connection. */
async function runLocal(options: Options): Promise<Row[]> {
  const url = resolveDevDatabaseUrl();
  console.error(`development  ${describeDatabase(url)}  ${label(options)}\n`);

  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 20,
    // A question asked by hand should not be able to sit on a lock for ever.
    connection: { statement_timeout: 60_000 },
  });

  try {
    const rows = await sql.begin(async (tx) => {
      // Set on the transaction, not the session, so it cannot be left behind
      // on a pooled connection. The driver issues the COMMIT; committing a
      // read-only transaction is a no-op.
      if (!options.write) await tx.unsafe("set transaction read only");
      return tx.unsafe(options.sql);
    });
    return rows as unknown as Row[];
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

/**
 * Runs the query against production over HTTPS.
 *
 * postgres-meta answers a successful query with an array of rows and a rejected
 * one with `{ error, code }` under HTTP 400, so the body decides what happened
 * and the status alone does not.
 */
async function runProduction(options: Options): Promise<Row[]> {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!base || !key) {
    throw new Error(
      [
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to reach production.",
        "They are operator credentials, not application configuration: the",
        "deployed app never reads them, and the service role key executes",
        "arbitrary SQL, so keep it out of Dokploy and out of any browser bundle.",
      ].join("\n"),
    );
  }

  if (options.write && process.env.ALLOW_PROD_WRITE_QUERY !== WRITE_OVERRIDE) {
    throw new Error(
      [
        `Refusing --write against ${base}, which is production.`,
        "Schema and data changes there belong in a migration, or in the",
        "application, where they are reviewed and leave an audit row.",
        "",
        "If this is a genuine one-off repair, set:",
        `  ALLOW_PROD_WRITE_QUERY=${WRITE_OVERRIDE}`,
      ].join("\n"),
    );
  }

  console.error(`production   ${base}/pg/query  ${label(options)}\n`);
  if (options.write) {
    console.error("WRITING TO PRODUCTION.\n");
  }

  const response = await fetch(`${base}/pg/query`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: options.write ? options.sql : `${READ_ONLY} ${options.sql}`,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `${base} rejected the credentials (${response.status}). Check SUPABASE_SERVICE_ROLE_KEY.`,
    );
  }

  /**
   * The body is read before the status is judged, and it has to be.
   *
   * postgres-meta reports a rejected statement as HTTP 400 carrying the
   * Postgres error, so treating any non-2xx as a transport or credential
   * problem replaces `cannot execute DELETE in a read-only transaction` with a
   * misleading suggestion to check the key.
   */
  const body: unknown = await response.json().catch(() => null);

  if (Array.isArray(body)) return body as Row[];

  if (body && typeof body === "object" && "error" in body) {
    const failure = body as { error: unknown; code?: unknown };
    const error = new Error(String(failure.error).trim());
    error.name = "PostgresError";
    if (typeof failure.code === "string") {
      (error as Error & { code?: string }).code = failure.code;
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`${base} answered ${response.status} with no error detail.`);
  }

  // A statement returning nothing, such as a successful write.
  return [];
}

function label(options: Options): string {
  return options.write ? "[write]" : "[read only]";
}

/** Renders a result set as columns, with long values cut rather than wrapped. */
function printTable(rows: readonly Row[]): void {
  const columns = Object.keys(rows[0]);
  const cells = rows.map((row) => columns.map((column) => format(row[column])));

  const widths = columns.map((column, index) =>
    Math.min(48, Math.max(column.length, ...cells.map((row) => row[index].length))),
  );

  const line = (values: string[]) =>
    values
      .map((value, index) =>
        value.length > widths[index]
          ? `${value.slice(0, widths[index] - 1)}…`
          : value.padEnd(widths[index]),
      )
      .join("  ")
      .trimEnd();

  console.log(line(columns));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of cells) console.log(line(row));
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.sql) usage();

  const started = Date.now();
  try {
    const rows =
      options.target === "production"
        ? await runProduction(options)
        : await runLocal(options);

    const elapsed = Date.now() - started;

    if (options.json) {
      console.log(JSON.stringify(rows, null, 2));
    } else if (rows.length === 0) {
      console.log("(no rows)");
    } else {
      printTable(rows);
    }

    console.error(`\n${rows.length} row(s) in ${elapsed}ms`);
  } catch (error) {
    const failure = error as Error & { code?: string };
    console.error(`\n${failure.name}: ${failure.message}`);
    if (failure.code) console.error(`SQLSTATE ${failure.code}`);
    if (failure.code === "25006") {
      console.error(
        "That statement writes. This runs read only; use --write, and read what it says about production.",
      );
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
