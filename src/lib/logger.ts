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

function serialiseError(error: unknown): Fields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      // Stacks are noise in production log search but essential locally.
      ...(process.env.NODE_ENV === "production" ? {} : { stack: error.stack }),
    };
  }
  return { errorName: "Unknown", errorMessage: String(error) };
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
