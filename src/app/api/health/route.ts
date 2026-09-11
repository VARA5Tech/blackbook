import { sql } from "@/db";
import { DatabaseUrlError } from "@/db/url";
import { logger } from "@/lib/logger";

/**
 * Readiness: is this instance actually able to serve requests?
 *
 * Reports the database, so a wrong connection string is visible immediately
 * rather than as a page of 500s. Nothing restarts the container on the strength
 * of it: that is /api/health/live, which deliberately checks nothing, because
 * restarting does not make a database reachable.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    await sql`select 1`;
    return Response.json({
      status: "ok",
      database: "reachable",
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    /**
     * Misconfigured and unreachable are different problems with different
     * fixes, and answering "unreachable" to both sends people hunting for a
     * network fault that is not there. The message is safe to return: it names
     * a variable, never a value.
     */
    if (error instanceof DatabaseUrlError) {
      logger.error("health.database_not_configured", error);
      return Response.json(
        { status: "error", database: "not configured", detail: error.message },
        { status: 503 },
      );
    }

    logger.error("health.database_unreachable", error);
    return Response.json(
      { status: "error", database: "unreachable" },
      { status: 503 },
    );
  }
}
