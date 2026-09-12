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
 *   PROD_TUNNEL_DATABASE_URL  the same production database as reached from a
 *                             laptop through a tunnel. Optional, developer
 *                             machines only, never set in Dokploy.
 *
 * Because the production URL is allowed to exist locally, nothing may fall
 * back to it silently. Local tooling and `next dev` use DEV_DATABASE_URL when
 * it is set; only a build running with NODE_ENV=production, or a command that
 * explicitly asks for production, uses DATABASE_URL.
 *
 * The tunnel variable exists because DATABASE_URL is unusable from a laptop by
 * design, and a developer who cannot read the live database at all debugs
 * production by redeploying and squinting at logs. It points at a local
 * forwarded port, so it *looks* local and is not: see `assertSafeToMutate`,
 * which refuses to be fooled by the hostname.
 */

export type DatabaseTarget = "development" | "production";

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
 * Blackbook speaks SQL to Postgres directly. Supabase's URL and service key
 * reach PostgREST, which is a different thing entirely: no transactions across
 * statements, no `tsvector` ranking, no trigram search, no migrations, and no
 * adapter for the auth library. Every one of those is load-bearing here, so
 * setting the Supabase API variables and omitting the connection string leaves
 * the application with nothing to talk to. Saying so beats a connection error.
 */
function missingDatabaseUrl(env: NodeJS.ProcessEnv): DatabaseUrlError {
  const hasSupabaseApi = Boolean(env.SUPABASE_URL ?? env.SUPABASE_SERVICE_KEY);

  if (hasSupabaseApi) {
    return new DatabaseUrlError(
      [
        "DATABASE_URL is not set, but SUPABASE_URL is.",
        "Those are not interchangeable. This application connects to Postgres",
        "directly and runs its own SQL; the Supabase URL and service key reach",
        "PostgREST, which cannot run transactions, migrations or the search",
        "queries this depends on.",
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
 * The URL a command-line tool should use for the given target.
 *
 * For production it prefers PROD_TUNNEL_DATABASE_URL, because the container
 * name in DATABASE_URL does not resolve off the server. The application itself
 * never calls this; it uses `resolveRuntimeDatabaseUrl`, which has no tunnel
 * case, so a tunnel can never become the production connection.
 */
export function resolveToolDatabaseUrl(
  target: DatabaseTarget,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (target === "production") {
    const url = env.PROD_TUNNEL_DATABASE_URL ?? env.DATABASE_URL;
    if (!url) {
      throw new DatabaseUrlError(
        "Neither PROD_TUNNEL_DATABASE_URL nor DATABASE_URL is set, so there is no production database to target.",
      );
    }
    return url;
  }

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
   * A tunnel forwards a local port to the live database, so its URL says
   * `localhost` while the bytes land in production. The hostname test would
   * wave it straight through, and `operation` here means dropping every table
   * or writing fixture accounts. Identity of the string is the only honest
   * signal available, so a URL that matches either production variable is
   * production, wherever it appears to point.
   */
  if (isProductionUrl(url, env)) {
    throw new DatabaseUrlError(
      `Refusing to ${operation} against ${describeDatabase(url)}.\n` +
        "That URL is the production database. If it looks local, it is a tunnel:\n" +
        "the port is on this machine and the database is not.\n" +
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

/** True if this exact URL is one of the two that name the live database. */
export function isProductionUrl(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return url === env.DATABASE_URL || url === env.PROD_TUNNEL_DATABASE_URL;
}
