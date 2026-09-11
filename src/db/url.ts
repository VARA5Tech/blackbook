/**
 * Which database a process talks to, and the guard rails that stop the wrong
 * one being picked.
 *
 * Two variables, with one meaning each:
 *
 *   DATABASE_URL      the production database. Set in Dokploy. May also sit in
 *                     a developer's .env.local so migrations can be applied
 *                     from a laptop.
 *   DEV_DATABASE_URL  the local development database.
 *
 * Because the production URL is allowed to exist locally, nothing may fall
 * back to it silently. Local tooling and `next dev` use DEV_DATABASE_URL when
 * it is set; only a build running with NODE_ENV=production, or a command that
 * explicitly asks for production, uses DATABASE_URL.
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
    if (!url) {
      throw new DatabaseUrlError(
        "DATABASE_URL is not set. Production requires it.",
      );
    }
    return url;
  }

  const url = env.DEV_DATABASE_URL ?? env.DATABASE_URL;
  if (!url) {
    throw new DatabaseUrlError(
      "Neither DEV_DATABASE_URL nor DATABASE_URL is set. Copy .env.example to .env.local.",
    );
  }
  return url;
}

/** The URL a command-line tool should use for the given target. */
export function resolveToolDatabaseUrl(
  target: DatabaseTarget,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (target === "production") {
    const url = env.DATABASE_URL;
    if (!url) {
      throw new DatabaseUrlError(
        "DATABASE_URL is not set, so there is no production database to target.",
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
