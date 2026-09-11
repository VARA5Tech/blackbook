/**
 * Runs once when the server starts.
 *
 * Loads the preference catalogue, which is reference data and safe to re-apply.
 * Idempotent, so a restart is a no-op.
 *
 * This lives here rather than in a script because the deployment is driven from
 * a web interface with no host shell, so there is nowhere to run a one-off
 * command.
 */
export async function register() {
  // `register` is also invoked for the edge runtime, which has no database.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { bootstrap } = await import("@/server/bootstrap");
  await bootstrap();
}
