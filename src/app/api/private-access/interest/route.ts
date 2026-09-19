import { privateAccessAnswer, readSignedRequest } from "@/lib/private-access";
import { logger } from "@/lib/logger";
import { recordPrivateAccessInterest } from "@/services/client-service";

/**
 * POST /api/private-access/interest
 *
 * What a signed-in client looked at on vara5.com: which journey, for how
 * long, and whether they asked the Curator. It is what fills the Interest panel
 * on Client 360, so the desk reads it where they already work instead of in an
 * analytics tool.
 *
 * Signed exactly like the lookup, with the same secret and the same refusals;
 * see `src/lib/private-access.ts`.
 *
 *   Body   { "customerId": "<uuid>", "destination": "antarctica",
 *            "title": "Antarctica — White Silence",
 *            "kind": "opened" | "read" | "photos" | "video" | "cta_clicked",
 *            "seconds": 184 }
 *
 *   Answer { "recorded": true } or { "recorded": false }
 *
 * False rather than an error when the client is archived, inactive or unknown:
 * the website is reporting, not asking permission, and a refusal is not
 * something a guest should ever see.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const verified = await readSignedRequest(request);
  if (!verified.ok) return verified.response;

  const { customerId, destination, title, kind, seconds } = verified.body;

  try {
    const recorded = await recordPrivateAccessInterest({
      customerId: String(customerId ?? ""),
      destination: String(destination ?? ""),
      title: String(title ?? ""),
      kind: kind as never,
      seconds: Number(seconds ?? 0),
    });
    return privateAccessAnswer(200, { recorded });
  } catch (error) {
    logger.error("private_access.interest_failed", error);
    return privateAccessAnswer(503, { error: "unavailable" });
  }
}
