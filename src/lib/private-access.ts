import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "@/lib/logger";

/**
 * The door vara5.com knocks on.
 *
 * Staff sign-in does not apply to these routes: the caller is the website's
 * server, not a person, so the proxy lets the path through and every request
 * carries a signature instead.
 *
 *   X-Blackbook-Timestamp  Unix seconds
 *   X-Blackbook-Signature  v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>">
 *
 * keyed with PRIVATE_ACCESS_SECRET, which only the website and Blackbook hold.
 * The secret itself never travels. A signature more than five minutes from now
 * is refused, so a captured request stops working; inside that window a replay
 * repeats one read or one interest row, and changes nothing that matters.
 *
 * Fails closed: without a secret configured every route answers 503, so a
 * missing variable can never open the gate.
 */

const SIGNATURE_WINDOW_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 1024;
/**
 * Per server instance. Real traffic is a handful of guests; this only caps how
 * fast a stolen secret could be used to walk through numbers or write noise.
 */
const MAX_REQUESTS_PER_MINUTE = 120;

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export function privateAccessAnswer(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: HEADERS });
}

let windowStartedAt = 0;
let requestsInWindow = 0;

function withinRateLimit(now: number): boolean {
  if (now - windowStartedAt >= 60_000) {
    windowStartedAt = now;
    requestsInWindow = 0;
  }
  requestsInWindow += 1;
  return requestsInWindow <= MAX_REQUESTS_PER_MINUTE;
}

function signatureIsValid(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  body: string,
  now: number,
): boolean {
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > SIGNATURE_WINDOW_SECONDS) return false;

  const presented = /^v1=([0-9a-f]{64})$/.exec(signature);
  if (!presented) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(presented[1], "hex"));
}

type Verified =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

/**
 * Checks one request from the website and hands back its parsed body.
 *
 * Every refusal is a Response the route returns as it is, so the two routes
 * cannot drift apart on what a bad signature or an oversized body answers.
 */
export async function readSignedRequest(request: Request): Promise<Verified> {
  const secret = process.env.PRIVATE_ACCESS_SECRET ?? "";
  if (secret.length < 32) {
    logger.error(
      "private_access.not_configured",
      new Error("PRIVATE_ACCESS_SECRET is missing or shorter than 32 characters"),
    );
    return { ok: false, response: privateAccessAnswer(503, { error: "not_configured" }) };
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { ok: false, response: privateAccessAnswer(413, { error: "too_large" }) };
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return { ok: false, response: privateAccessAnswer(413, { error: "too_large" }) };
  }

  const now = Date.now();
  const signed = signatureIsValid(
    secret,
    request.headers.get("x-blackbook-timestamp"),
    request.headers.get("x-blackbook-signature"),
    raw,
    now,
  );
  if (!signed) {
    logger.warn("private_access.bad_signature");
    return { ok: false, response: privateAccessAnswer(401, { error: "unauthorised" }) };
  }

  // After the signature, so unsigned noise cannot use up the website's allowance.
  if (!withinRateLimit(now)) {
    logger.warn("private_access.rate_limited");
    return { ok: false, response: privateAccessAnswer(429, { error: "rate_limited" }) };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, response: privateAccessAnswer(400, { error: "bad_request" }) };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, response: privateAccessAnswer(400, { error: "bad_request" }) };
  }

  return { ok: true, body: body as Record<string, unknown> };
}
