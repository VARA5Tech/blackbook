import "server-only";
import { sql as raw } from "drizzle-orm";
import { db } from "@/db";
import { CATALOGUE } from "@/db/catalogue";
import { preferenceOptions } from "@/db/schema";
import { describeDatabase, resolveRuntimeDatabaseUrl } from "@/db/url";
import { logger } from "@/lib/logger";

/**
 * Brings a fresh database up to a usable state, and does nothing on a database
 * that is already there. Called once from `src/instrumentation.ts`.
 */
export async function bootstrap(): Promise<void> {
  try {
    /**
     * Says which database it is about to use, before touching it.
     *
     * Without this the first line in the log on a bad deployment is a
     * connection error naming nothing, and the operator is left guessing
     * whether the host, the port or the credentials are wrong. Host, port and
     * database name only; `describeDatabase` never returns the password.
     */
    logger.info("bootstrap.database", {
      target: describeDatabase(resolveRuntimeDatabaseUrl()),
    });

    await loadCatalogue();

    // Invited accounts nobody set up in time. Also runs whenever Team is opened.
    const { purgeExpiredInvitations } = await import("@/services/user-service");
    await purgeExpiredInvitations();

    scheduleShareSweep();
  } catch (error) {
    // Never take the server down for this. A failed bootstrap leaves the app
    // running and the reason in the log; a crash loop would hide it.
    logger.error("bootstrap.failed", error);
  }
}

/**
 * The catalogue is reference data, not user data, so it is re-applied on every
 * boot. Labels a staff member edited are left alone, because the conflict
 * target only matches seeded rows by their slug and custom entries are never
 * in CATALOGUE.
 */
async function loadCatalogue(): Promise<void> {
  const rows = CATALOGUE.map((entry, index) => ({
    kind: entry.kind,
    slug: entry.slug,
    label: entry.label,
    grouping: entry.grouping ?? null,
    isCustom: false,
    sortOrder: index,
  }));

  const before = await db
    .select({ count: raw<number>`count(*)::int` })
    .from(preferenceOptions);

  await db
    .insert(preferenceOptions)
    .values(rows)
    .onConflictDoUpdate({
      target: [preferenceOptions.kind, preferenceOptions.slug],
      set: {
        label: raw`excluded.label`,
        grouping: raw`excluded.grouping`,
        sortOrder: raw`excluded.sort_order`,
      },
    });

  if (before[0].count === 0) {
    logger.info("bootstrap.catalogue_loaded", { options: rows.length });
  }
}


/** Often enough that a forgotten link is measured in minutes, not days. */
const SWEEP_EVERY_MS = 10 * 60 * 1000;

/**
 * Closes replay share links nobody is watching.
 *
 * Playing a recording inside Blackbook means asking PostHog to share it, and a
 * PostHog share link is a public URL. The player hands it back when it closes,
 * on unmount and by `sendBeacon` when the tab goes — but a browser that is
 * force quit or crashes never gets to, and what survives is a public link to a
 * client's session.
 *
 * So this runs on a timer and revokes whatever was left behind. It runs at boot
 * too, which is exactly when the record of what is open has just been lost.
 *
 * Here rather than in `src/instrumentation.ts` because that module is loaded
 * for the edge runtime as well, and reaching PostHog from it pulls a Node-only
 * logger into an edge bundle. Bootstrap is already node-only.
 *
 * Every failure is swallowed. This is housekeeping; it must never be the reason
 * the server stops serving.
 */
function scheduleShareSweep(): void {
  const sweep = async () => {
    try {
      const { sweepShares } = await import("@/lib/posthog");
      await sweepShares();
    } catch {
      // Logged inside the sweep; nothing here can usefully react.
    }
  };

  void sweep();

  const timer = setInterval(sweep, SWEEP_EVERY_MS);
  // Never hold the process open on account of housekeeping.
  timer.unref?.();
}
