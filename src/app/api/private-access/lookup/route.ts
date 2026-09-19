import { privateAccessAnswer, readSignedRequest } from "@/lib/private-access";
import { logger } from "@/lib/logger";
import {
  lookupPrivateAccessGuest,
  lookupPrivateAccessGuestById,
  savePrivateAccessEmail,
} from "@/services/client-service";

/**
 * POST /api/private-access/lookup
 *
 * Asked by vara5.com before it sends a guest a WhatsApp code, and again on
 * every page load to check the guest is still a client. Nothing else about the
 * client leaves Blackbook.
 *
 * Signed with PRIVATE_ACCESS_SECRET; see `src/lib/private-access.ts` for the
 * scheme and what each refusal answers.
 *
 *   Body    { "phone": "+919810011223" }   sign-in, by the number typed
 *           { "customerId": "<uuid>" }     re-check, by the id in the session
 *           { "phone": "…", "email": "…" } fill a blank email, see below
 *
 *   Answer  { "found": false }
 *           { "found": true, "id": "<uuid>", "ref": "VARA-482193",
 *             "name": "Priya", "phone": "+919810099887", "email": null }
 *
 * The id is the website's session key and its analytics identity, so a staff
 * edit to a phone number cannot sign a guest out or split their history.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const verified = await readSignedRequest(request);
  if (!verified.ok) return verified.response;

  const { phone, email, customerId } = verified.body;

  const byId = typeof customerId === "string" && customerId.trim();
  const byPhone = typeof phone === "string" && phone.trim().startsWith("+");
  if (!byId && !byPhone) {
    return privateAccessAnswer(400, { error: "bad_phone" });
  }

  try {
    // An email means the website reached a client whose record has none, and a
    // guest typed one so the code could be emailed instead. It fills the blank
    // and is refused if the record already holds an address.
    if (byPhone && typeof email === "string" && email.trim()) {
      const saved = await savePrivateAccessEmail(phone as string, email);
      return privateAccessAnswer(200, { saved });
    }

    const guest = byId
      ? await lookupPrivateAccessGuestById(customerId as string)
      : await lookupPrivateAccessGuest(phone as string);

    return privateAccessAnswer(200, guest ? { found: true, ...guest } : { found: false });
  } catch (error) {
    logger.error("private_access.lookup_failed", error);
    return privateAccessAnswer(503, { error: "unavailable" });
  }
}
