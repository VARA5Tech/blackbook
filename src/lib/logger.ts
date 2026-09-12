/**
 * Application logging.
 *
 * There are two separate records in this system and they answer different
 * questions. Do not confuse them.
 *
 *   activity_log   What changed in the business record: who edited which
 *                  client, which fields moved, from what to what. Append-only,
 *                  enforced by a database trigger, kept forever, shown to staff
 *                  on the Client 360 timeline. That is the audit trail.
 *
 *   this logger    What the software did: a request failed, the database was
 *                  unreachable, the model call timed out. Goes to stdout, is
 *                  captured by Docker and read in Dokploy, rotates away. That
 *                  is operational telemetry.
 *
 * An edit produces a row in the first. Only a problem produces a line in the
 * second.
 *
 * Output is one JSON object per line in production, because that is what
 * container log collectors parse, and readable text in development.
 *
 * PII never appears here. This is a CRM holding names, phone numbers, home
 * addresses and family details; logs are the easiest place for that to leak
 * into a third-party log viewer. Log identifiers, never values.
 */

type Level = "debug" | "info" | "warn" | "error";

type Fields = Record<string, unknown>;

const LEVELS: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minimumLevel(): number {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  if (configured && configured in LEVELS) return LEVELS[configured];
  return process.env.NODE_ENV === "production" ? LEVELS.info : LEVELS.debug;
}

/**
 * Fields whose values must never be written out, whatever a caller passes.
 * Belt and braces: the call sites already pass ids, but a future one might not.
 */
const REDACTED = new Set([
  "firstName",
  "lastName",
  "preferredName",
  "name",
  "email",
  "mobile",
  "whatsapp",
  "phone",
  "address",
  "clientDna",
  "notes",
  "summary",
  "details",
  "password",
  "token",
  "secret",
  "apiKey",
  "authorization",
  "cookie",
]);

function scrub(fields: Fields): Fields {
  const safe: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = REDACTED.has(key) ? "[redacted]" : value;
  }
  return safe;
}

/**
 * Fields the Postgres driver puts on its error objects that are safe to log.
 *
 * `detail` and `hint` are deliberately absent. Postgres puts the offending
 * values in them, so a unique violation arrives as
 * `Key (email)=(someone@example.com) already exists`, and this is a CRM. The
 * code and the constraint name identify the fault without naming a client.
 */
const PG_ERROR_FIELDS = [
  "code",
  "severity",
  "constraint_name",
  "table_name",
  "column_name",
  "schema_name",
  "routine",
] as const;

/**
 * Unwraps the error, then the reason underneath it.
 *
 * Drizzle catches the driver's error and throws its own carrying the SQL, with
 * the original on `cause`. Only the wrapper was being logged, so a production
 * failure read `Failed query: select count(*) from "preference_option"` with
 * nothing about why: not a connection refusal, not a missing table, not a
 * permission denial. The cause holds the Postgres SQLSTATE, which names the
 * fault exactly, and losing it turned a one-line diagnosis into guesswork.
 */
function serialiseError(error: unknown): Fields {
  if (!(error instanceof Error)) {
    return { errorName: "Unknown", errorMessage: String(error) };
  }

  const fields: Fields = {
    errorName: error.name,
    errorMessage: error.message,
    // Stacks are noise in production log search but essential locally.
    ...(process.env.NODE_ENV === "production" ? {} : { stack: error.stack }),
    ...pgFields(error),
  };

  // Follow the chain, but not forever: a cycle or a deep wrap should not
  // produce an unbounded log line.
  const causes: string[] = [];
  let cause: unknown = error.cause;
  for (let depth = 0; depth < 4 && cause instanceof Error; depth += 1) {
    causes.push(`${cause.name}: ${cause.message}`);
    Object.assign(fields, pgFields(cause));
    cause = cause.cause;
  }
  if (causes.length > 0) fields.errorCause = causes.join(" <- ");

  return fields;
}

function pgFields(error: Error): Fields {
  const source = error as unknown as Record<string, unknown>;
  const fields: Fields = {};
  for (const key of PG_ERROR_FIELDS) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      fields[`pg_${key}`] = value;
    }
  }
  return fields;
}

function emit(level: Level, event: string, fields: Fields = {}): void {
  if (LEVELS[level] < minimumLevel()) return;

  const safe = scrub(fields);

  if (process.env.NODE_ENV === "production") {
    process.stdout.write(
      `${JSON.stringify({
        level,
        event,
        time: new Date().toISOString(),
        ...safe,
      })}\n`,
    );
    return;
  }

  const detail = Object.keys(safe).length > 0 ? ` ${JSON.stringify(safe)}` : "";
  const line = `${level.toUpperCase().padEnd(5)} ${event}${detail}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: Fields) => emit("debug", event, fields),
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, error: unknown, fields?: Fields) =>
    emit("error", event, { ...fields, ...serialiseError(error) }),
};
