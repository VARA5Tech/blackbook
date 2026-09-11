/**
 * Liveness. Deliberately touches nothing.
 *
 * This is what the container health check calls, and in Docker Swarm an
 * unhealthy task is killed and rescheduled. So it must answer one question
 * only: is this process still serving? A check that also tested the database
 * would turn an unreachable database into a restart loop, which fixes nothing
 * and buries the real error under churn.
 *
 * Readiness, including the database, is /api/health.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
