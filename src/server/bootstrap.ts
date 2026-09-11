import "server-only";
import { sql as raw } from "drizzle-orm";
import { db } from "@/db";
import { CATALOGUE } from "@/db/catalogue";
import { preferenceOptions } from "@/db/schema";
import { logger } from "@/lib/logger";

/**
 * Brings a fresh database up to a usable state, and does nothing on a database
 * that is already there. Called once from `src/instrumentation.ts`.
 */
export async function bootstrap(): Promise<void> {
  try {
    await loadCatalogue();
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
