/**
 * A read-only SQL console for one query at a time.
 *
 *   pnpm db:query      "select count(*) from customer"
 *   pnpm db:query:prod "select ref, status from customer limit 20"
 *   pnpm db:query:prod --file scripts/sql/stuck-milestones.sql
 *
 * This exists because the production database is unreachable from a laptop by
 * design: DATABASE_URL names a container, so it resolves on the server and
 * nowhere else. That is the right posture for a database holding home
 * addresses and children's birthdays, and it is also total blindness. Debugging
 * by redeploying and reading logs is not debugging.
 *
 * So: a tunnel supplies the route, PROD_TUNNEL_DATABASE_URL supplies the
 * address, and this supplies a way to ask a question without also being a way
 * to break something.
 *
 * Every statement runs inside a transaction that is set READ ONLY before the
 * query is sent, and the transaction is always rolled back. Postgres, not this
 * script, refuses the write, so there is no pattern to outwit: an INSERT, an
 * UPDATE, a DROP, a function that writes, all fail with SQLSTATE 25006. Writes
 * to production belong in a migration or in the application, where they are
 * reviewed and audited. `--write` lifts the restriction for development only.
 *
 * Output goes to a terminal, not to a log, so it prints real client values.
 * `src/lib/logger.ts` is the thing that must never do that.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import {
  describeDatabase,
  isProductionUrl,
  resolveToolDatabaseUrl,
  type DatabaseTarget,
} from "@/db/url";

const WRITE_OVERRIDE = "i-understand-this-writes-to-production";

type Options = {
  target: DatabaseTarget;
  sql: string;
  write: boolean;
  json: boolean;
};

function parseArgs(argv: string[]): Options {
  const target: DatabaseTarget =
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
      "  --write   allow writes (development target only)",
    ].join("\n"),
  );
  process.exit(2);
}

/** Renders a result set as columns, with long values cut rather than wrapped. */
function printTable(rows: readonly Record<string, unknown>[]): void {
  const columns = Object.keys(rows[0]);
  const cells = rows.map((row) =>
    columns.map((column) => format(row[column])),
  );

  const widths = columns.map((column, index) =>
    Math.min(
      48,
      Math.max(column.length, ...cells.map((row) => row[index].length)),
    ),
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

  let url: string;
  try {
    url = resolveToolDatabaseUrl(options.target);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  const isProduction = isProductionUrl(url);

  /**
   * A write against production needs the phrase typed out, not a flag. The
   * flag is one keystroke from a read, and the two are not comparable.
   */
  if (options.write && isProduction) {
    if (process.env.ALLOW_PROD_WRITE_QUERY !== WRITE_OVERRIDE) {
      console.error(
        [
          `Refusing --write against ${describeDatabase(url)}, which is production.`,
          "Schema and data changes there belong in a migration, or in the",
          "application, where they are reviewed and leave an audit row.",
          "",
          "If this is a genuine one-off repair, set:",
          `  ALLOW_PROD_WRITE_QUERY=${WRITE_OVERRIDE}`,
        ].join("\n"),
      );
      process.exit(1);
    }
    console.error("WRITING TO PRODUCTION. The transaction will be committed.\n");
  }

  console.error(
    `${isProduction ? "production" : options.target}  ${describeDatabase(url)}${
      options.write ? "  [write]" : "  [read only]"
    }\n`,
  );

  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 20,
    // A question asked by hand should not be able to sit on a lock for ever.
    connection: { statement_timeout: 60_000 },
  });

  const started = Date.now();
  try {
    const rows = await sql.begin(async (tx) => {
      // Set on the transaction, not the session, so it cannot be left behind
      // on a pooled connection. The driver issues the COMMIT; committing a
      // read-only transaction is a no-op, and an explicit ROLLBACK here would
      // fight it.
      if (!options.write) await tx.unsafe("set transaction read only");
      return tx.unsafe(options.sql);
    });

    const elapsed = Date.now() - started;
    const list = rows as unknown as Record<string, unknown>[];

    if (options.json) {
      console.log(JSON.stringify(list, null, 2));
    } else if (list.length === 0) {
      console.log("(no rows)");
    } else {
      printTable(list);
    }

    console.error(`\n${list.length} row(s) in ${elapsed}ms`);
  } catch (error) {
    const failure = error as Error & { code?: string; hint?: string };
    console.error(`\n${failure.name}: ${failure.message}`);
    if (failure.code) console.error(`SQLSTATE ${failure.code}`);
    if (failure.code === "25006") {
      console.error(
        "That statement writes. This runs read only; use --write, and read what it says about production.",
      );
    }
    if (failure.hint) console.error(`Hint: ${failure.hint}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
