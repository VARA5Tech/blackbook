import { sql } from "@/db";
import { logger } from "@/lib/logger";

/**
 * Liveness and readiness in one endpoint.
 *
 * Dokploy polls this. It checks the database rather than just returning 200,
 * because a container that cannot reach Postgres is not ready to serve, and a
 * failed health check stops a bad deployment from replacing a working one.
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
    logger.error("health.database_unreachable", error);
    return Response.json(
      { status: "error", database: "unreachable" },
      { status: 503 },
    );
  }
}
