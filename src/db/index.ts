import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { resolveRuntimeDatabaseUrl } from "./url";

type Client = ReturnType<typeof postgres>;

/**
 * Single Postgres connection pool for the whole process.
 *
 * Next.js dev reloads modules on every edit, so the client is cached on
 * globalThis to avoid leaking a pool per hot reload.
 */
const globalForDb = globalThis as unknown as { vara5Sql?: Client };

function createClient(): Client {
  // Never falls back to DATABASE_URL outside production: that variable holds
  // the live database even on a developer's machine. See ./url.ts.
  const url = resolveRuntimeDatabaseUrl();

  return postgres(url, {
    max: process.env.NODE_ENV === "production" ? 10 : 4,
    /**
     * Prepared statements are worth having, and only a transaction-mode pooler
     * forbids them. That is port 6543 by convention for both Supavisor and
     * PgBouncer; a direct connection and a session-mode pooler both handle them
     * fine. Keying off the port is deterministic, so this cannot guess wrong.
     */
    prepare: !isTransactionPooler(url),
  });
}

/** Port 6543 is the transaction pooler for both Supavisor and PgBouncer. */
function isTransactionPooler(url: string): boolean {
  try {
    return new URL(url).port === "6543";
  } catch {
    // Unparseable: assume pooled, which is the safe direction.
    return true;
  }
}

let client: Client | undefined;

/**
 * The pool is built on first use, not on import.
 *
 * `next build` loads every route module to collect its metadata, and does so
 * with no environment at all. Reading the connection string at import time
 * would make the production image impossible to build without handing the
 * build a live database, which it has no business seeing.
 */
function getClient(): Client {
  client ??= globalForDb.vara5Sql ?? createClient();
  if (process.env.NODE_ENV !== "production") globalForDb.vara5Sql = client;
  return client;
}

/** Binds methods to the real client so `sql.unsafe` and `sql.end` still work. */
function forward(property: string | symbol): unknown {
  const target = getClient() as unknown as Record<string | symbol, unknown>;
  const value = target[property];
  return typeof value === "function" ? value.bind(target) : value;
}

/**
 * Callable stand-in, so tagged-template use such as sql`select 1` keeps working
 * while the pool underneath is still created lazily.
 */
export const sql = new Proxy(function noop() {} as unknown as Client, {
  apply: (_target, _thisArg, args: unknown[]) =>
    (getClient() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_target, property) => forward(property),
  has: (_target, property) => property in (getClient() as object),
}) as Client;

function createDb() {
  return drizzle(getClient(), {
    schema,
    casing: "snake_case",
    logger: process.env.DB_LOG === "true",
  });
}

type Db = ReturnType<typeof createDb>;

let dbInstance: Db | undefined;

export const db = new Proxy({} as Db, {
  get: (_target, property) => {
    dbInstance ??= createDb();
    const value = (dbInstance as unknown as Record<string | symbol, unknown>)[
      property
    ];
    return typeof value === "function" ? value.bind(dbInstance) : value;
  },
}) as Db;

export type Database = Db;
export { schema };
