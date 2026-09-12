/**
 * Which database a process talks to, and the guard rails that stop the wrong
 * one being picked.
 *
 * Two variables, with one meaning each:
 *
 *   DATABASE_URL              the production database, as the production
 *                             container addresses it. Set in Dokploy. Its host
 *                             is a container name, so it resolves on the
 *                             server and nowhere else.
 *   DEV_DATABASE_URL          the local development database.
 *
 * Because the production URL is allowed to exist locally, nothing may fall
 * back to it silently. Local tooling and `next dev` use DEV_DATABASE_URL; only
 * a process running with NODE_ENV=production uses DATABASE_URL.
 *
 * Nothing on a laptop can open that production connection, and nothing should
 * try. Reading the live database from a developer machine goes over HTTPS
 * through the Supabase stack instead: `pnpm db:query:prod`, described in the
 * README.
 */

export class DatabaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseUrlError";
  }
}

/** The URL the running application should use. */
export function resolveRuntimeDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.NODE_ENV === "production") {
    const url = env.DATABASE_URL;
    if (!url) throw missingDatabaseUrl(env);
    return url;
  }

  const url = env.DEV_DATABASE_URL ?? env.DATABASE_URL;
  if (!url) throw missingDatabaseUrl(env);
  return url;
}

/**
 * Names the problem precisely, because the obvious guess is wrong.
 *
 * The Supabase variables are genuinely useful, but to an operator, not to this
 * application: they reach PostgREST and postgres-meta over HTTPS, which is how
 * a developer reads production from a laptop. The application speaks SQL to
 * Postgres directly, for transactions across statements, `tsvector` ranking,
 * trigram search, migrations and the auth adapter. So the Supabase keys being
 * present is not a sign the connection string is optional, and someone who has
 * set them and omitted it has left the app with nothing to talk to. Saying so
 * beats a connection error.
 */
function missingDatabaseUrl(env: NodeJS.ProcessEnv): DatabaseUrlError {
  const hasSupabaseApi = Boolean(
    env.SUPABASE_URL ?? env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (hasSupabaseApi) {
    return new DatabaseUrlError(
      [
        "DATABASE_URL is not set, but the Supabase API variables are.",
        "Those are not interchangeable. They are operator credentials for",
        "reading this database over HTTPS; the application connects to Postgres",
        "directly and runs its own SQL, which PostgREST cannot serve.",
        "Set DATABASE_URL to a Postgres connection string. Inside the Supabase",
        "stack's Docker network that is the database container on port 5432.",
      ].join("\n"),
    );
  }

  return new DatabaseUrlError(
    env.NODE_ENV === "production"
      ? "DATABASE_URL is not set. Production requires a Postgres connection string."
      : "Neither DEV_DATABASE_URL nor DATABASE_URL is set. Copy .env.example to .env.local.",
  );
}

/**
 * The URL a command-line tool should use.
 *
 * There is deliberately no production counterpart. Every local `db:*` command
 * needs a Postgres socket, and production has none that a laptop can open;
 * `db:query:prod` reads it over HTTPS instead and never comes through here.
 */
export function resolveDevDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const url = env.DEV_DATABASE_URL;
  if (!url) {
    throw new DatabaseUrlError(
      "DEV_DATABASE_URL is not set. Local commands will not silently fall back to DATABASE_URL, because that is production.",
    );
  }
  return url;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "db"]);

export function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "an unparseable URL";
  }
}

/**
 * Refuses a destructive command against anything that is not a local database.
 *
 * The test harness drops and recreates its database, and the seed writes
 * fixture accounts. Both are catastrophic against production, and production
 * is one environment variable away, so the check is a hard stop rather than a
 * warning. The override exists for a deliberate staging run and has to be
 * typed out in full.
 */
export function assertSafeToMutate(
  url: string,
  operation: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  /**
   * Checked before the hostname, and it has to be.
   *
   * `operation` here means dropping every table or writing fixture accounts,
   * and a hostname is weak evidence of where those land: a forwarded port reads
   * as `localhost` while the bytes arrive in production. Identity of the string
   * is the honest signal, so a URL matching DATABASE_URL is production wherever
   * it appears to point, and the override below does not reopen that door.
   */
  if (isProductionUrl(url, env)) {
    throw new DatabaseUrlError(
      `Refusing to ${operation} against ${describeDatabase(url)}.\n` +
        "That URL is the production database.\n" +
        "Point DEV_DATABASE_URL at your own Postgres.",
    );
  }

  if (isLocalDatabase(url)) return;
  if (env.ALLOW_REMOTE_DESTRUCTIVE_DB === "i-understand-this-is-not-local") {
    return;
  }

  throw new DatabaseUrlError(
    `Refusing to ${operation} against ${describeDatabase(url)} because it is not a local database.\n` +
      "Set DEV_DATABASE_URL to your local Postgres, or if this really is intended, set\n" +
      "ALLOW_REMOTE_DESTRUCTIVE_DB=i-understand-this-is-not-local",
  );
}

/** True if this exact URL is the one that names the live database. */
export function isProductionUrl(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.DATABASE_URL) && url === env.DATABASE_URL;
}
