import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "@/lib/logger";
import { lookupPrivateAccessGuest } from "@/services/client-service";

/**
 * POST /api/private-access/lookup
 *
 * Asked by the vara5.travel website before it sends a guest a WhatsApp code: is
 * this number an active client, and if so, by what name and to which number?
 * Nothing else about the client leaves Blackbook.
 *
 * Staff sign-in does not apply, so the proxy lets this path through. Instead
 * every request is signed with PRIVATE_ACCESS_SECRET, which only the website and
 * Blackbook hold:
 *
 *   X-Blackbook-Timestamp  Unix seconds
 *   X-Blackbook-Signature  v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>">
 *
 * The secret itself never travels. A signature more than five minutes from now
 * is refused, so a captured request stops working; inside that window a replay
 * only repeats a read and changes nothing.
 *
 *   Body    { "phone": "+919810011223" }  the number with its country code
 *   Answer  { "found": false }
 *           { "found": true, "name": "Priya", "phone": "+919810099887" }
 *
 * Fails closed: without a secret configured it answers 503, so a missing
 * variable can never open the gate.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIGNATURE_WINDOW_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 1024;
/**
 * Per server instance. Real traffic is a handful of guests signing in; this only
 * caps how fast a stolen secret could be used to walk through phone numbers.
 */
const MAX_LOOKUPS_PER_MINUTE = 60;

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function answer(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: HEADERS });
}

let windowStartedAt = 0;
let lookupsInWindow = 0;

function withinRateLimit(now: number): boolean {
  if (now - windowStartedAt >= 60_000) {
    windowStartedAt = now;
    lookupsInWindow = 0;
  }
  lookupsInWindow += 1;
  return lookupsInWindow <= MAX_LOOKUPS_PER_MINUTE;
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

export async function POST(request: Request) {
  const secret = process.env.PRIVATE_ACCESS_SECRET ?? "";
  if (secret.length < 32) {
    logger.error(
      "private_access.not_configured",
      new Error("PRIVATE_ACCESS_SECRET is missing or shorter than 32 characters"),
    );
    return answer(503, { error: "not_configured" });
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return answer(413, { error: "too_large" });
  }
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    return answer(413, { error: "too_large" });
  }

  const now = Date.now();
  const signed = signatureIsValid(
    secret,
    request.headers.get("x-blackbook-timestamp"),
    request.headers.get("x-blackbook-signature"),
    body,
    now,
  );
  if (!signed) {
    logger.warn("private_access.bad_signature");
    return answer(401, { error: "unauthorised" });
  }

  // After the signature, so unsigned noise cannot use up the website's allowance.
  if (!withinRateLimit(now)) {
    logger.warn("private_access.rate_limited");
    return answer(429, { error: "rate_limited" });
  }

  let phone: unknown;
  try {
    phone = (JSON.parse(body) as { phone?: unknown }).phone;
  } catch {
    return answer(400, { error: "bad_request" });
  }
  if (typeof phone !== "string" || !phone.trim().startsWith("+")) {
    return answer(400, { error: "bad_phone" });
  }

  try {
    const guest = await lookupPrivateAccessGuest(phone);
    return answer(200, guest ? { found: true, ...guest } : { found: false });
  } catch (error) {
    logger.error("private_access.lookup_failed", error);
    return answer(503, { error: "unavailable" });
  }
}
