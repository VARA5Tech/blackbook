import { z } from "zod";
import { ForbiddenError, UnauthenticatedError } from "@/auth/session";
import { logger } from "@/lib/logger";
import { closeClientReplay } from "@/services/client-service";

const bodySchema = z.object({ sessionId: z.uuid() });

/**
 * Takes back the public link to a recording.
 *
 * A route rather than a server action because `sendBeacon` is the only thing
 * that reliably survives a tab being closed, and it can only post to a URL. It
 * is behind staff sign-in like every other screen: the proxy lets nothing
 * through here without a session, and the service asserts the capability.
 *
 * It answers 204 whatever happens. The browser has already gone by then, and a
 * link left standing is worse than a lost error message, so a failure is logged
 * rather than returned.
 */
export async function POST(request: Request) {
  try {
    const { sessionId } = bodySchema.parse(await request.json());
    await closeClientReplay(sessionId);
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof ForbiddenError) {
      return new Response(null, { status: 204 });
    }
    logger.warn("replay.close_failed", { reason: (error as Error).name });
  }

  return new Response(null, { status: 204 });
}
