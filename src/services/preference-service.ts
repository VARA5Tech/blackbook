import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireCapability } from "@/auth/session";
import { db } from "@/db";
import {
  customerPreferenceProfile,
  customerPreferences,
  customers,
  preferenceOptions,
} from "@/db/schema";
import {
  KIND_LABELS,
  PREFERENCE_KINDS,
  POLARITIES,
  POLARITY_LABELS,
  slugify,
  type CatalogueOption,
  type PreferenceKind,
} from "@/domain/preferences";
import { onlyProvided, optionalText, uuidSchema } from "@/domain/shared";
import { logActivity } from "./activity-service";
import { DomainError } from "./client-service";

export {
  KIND_LABELS,
  PREFERENCE_KINDS,
  POLARITIES,
  POLARITY_LABELS,
  type CatalogueOption,
};

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

/** The whole catalogue, grouped by facet, for rendering the preference editor. */
export async function getCatalogue() {
  const rows = await db
    .select({
      id: preferenceOptions.id,
      kind: preferenceOptions.kind,
      label: preferenceOptions.label,
      grouping: preferenceOptions.grouping,
    })
    .from(preferenceOptions)
    .orderBy(asc(preferenceOptions.sortOrder), asc(preferenceOptions.label));

  const byKind = new Map<string, CatalogueOption[]>();
  for (const row of rows) {
    const list = byKind.get(row.kind) ?? [];
    list.push(row as CatalogueOption);
    byKind.set(row.kind, list);
  }
  return byKind;
}

export async function listOptionsByKind(kind: PreferenceKind) {
  return db
    .select()
    .from(preferenceOptions)
    .where(eq(preferenceOptions.kind, kind))
    .orderBy(asc(preferenceOptions.sortOrder), asc(preferenceOptions.label));
}

export const createOptionSchema = z.object({
  kind: z.enum(PREFERENCE_KINDS),
  label: z.string().trim().min(1).max(120),
  grouping: optionalText,
});

/**
 * Adds a catalogue entry a staff member typed in, e.g. a hotel Vara5 has not
 * used before. Re-using an existing slug returns the existing row instead of
 * creating a near-duplicate.
 */
export async function createPreferenceOption(
  input: z.input<typeof createOptionSchema>,
) {
  const actor = await requireCapability("preference_option.create");
  const data = createOptionSchema.parse(input);
  const slug = slugify(data.label);

  const existing = await db.query.preferenceOptions.findFirst({
    where: and(
      eq(preferenceOptions.kind, data.kind),
      eq(preferenceOptions.slug, slug),
    ),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(preferenceOptions)
    .values({
      kind: data.kind,
      slug,
      label: data.label,
      grouping: data.grouping,
      isCustom: true,
      sortOrder: 10_000,
      createdBy: actor.id,
    })
    .returning();

  return created;
}

/* ------------------------------------------------------------------ */
/* Per-client preferences                                              */
/* ------------------------------------------------------------------ */

export const setPreferencesSchema = z.object({
  customerId: uuidSchema,
  kind: z.enum(PREFERENCE_KINDS),
  selections: z
    .array(
      z.object({
        optionId: uuidSchema,
        polarity: z.enum(POLARITIES),
        note: optionalText,
      }),
    )
    .max(200),
});

export type SetPreferencesInput = z.input<typeof setPreferencesSchema>;

/**
 * Replaces every selection for one facet of one client.
 *
 * Scoping to a single facet means the travel section and the dining section can
 * be saved independently without one overwriting the other.
 */
export async function setPreferences(input: SetPreferencesInput) {
  const actor = await requireCapability("preference.update");
  const data = setPreferencesSchema.parse(input);

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, data.customerId),
  });
  if (!customer) throw new DomainError("Client not found");

  const optionIds = data.selections.map((selection) => selection.optionId);
  if (optionIds.length > 0) {
    const valid = await db
      .select({ id: preferenceOptions.id })
      .from(preferenceOptions)
      .where(
        and(
          inArray(preferenceOptions.id, optionIds),
          eq(preferenceOptions.kind, data.kind),
        ),
      );
    if (valid.length !== new Set(optionIds).size) {
      throw new DomainError("One of those options is not valid for this section");
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(customerPreferences).where(
      and(
        eq(customerPreferences.customerId, data.customerId),
        sql`${customerPreferences.optionId} in (
          select id from preference_option where kind = ${data.kind}
        )`,
      ),
    );

    if (data.selections.length > 0) {
      await tx.insert(customerPreferences).values(
        data.selections.map((selection, index) => ({
          customerId: data.customerId,
          optionId: selection.optionId,
          polarity: selection.polarity,
          note: selection.note,
          rank: index,
          createdBy: actor.id,
        })),
      );
    }

    await tx
      .update(customers)
      .set({ profileUpdatedAt: new Date(), updatedBy: actor.id })
      .where(eq(customers.id, data.customerId));

    await logActivity(
      {
        actor,
        entityType: "preference",
        entityId: data.customerId,
        action: "preference_updated",
        customerId: data.customerId,
        householdId: customer.householdId,
        summary: `${KIND_LABELS[data.kind]} updated`,
      },
      tx,
    );
  });
}

/* ------------------------------------------------------------------ */
/* Scalar preference profile                                           */
/* ------------------------------------------------------------------ */

export const preferenceProfileSchema = z.object({
  customerId: uuidSchema,
  travelTypicalTripNights: z.coerce.number().int().min(0).max(365).nullable().optional(),
  travelParty: z.string().nullable().optional(),
  travelFrequency: z.string().nullable().optional(),
  travelBudgetRange: z.string().nullable().optional(),
  travelBookingLeadTime: z.string().nullable().optional(),
  travelNotes: optionalText,
  hotelNotes: optionalText,
  flightCabin: z.string().nullable().optional(),
  flightDirectPreference: z.string().nullable().optional(),
  flightNotes: optionalText,
  diningDietary: z.string().nullable().optional(),
  diningFineDining: z.string().nullable().optional(),
  diningNotes: optionalText,
  lifestyleExperienceStyle: z.string().nullable().optional(),
  lifestyleNotes: optionalText,
});

export type PreferenceProfileInput = z.input<typeof preferenceProfileSchema>;

export async function updatePreferenceProfile(input: PreferenceProfileInput) {
  const actor = await requireCapability("preference.update");
  const data = preferenceProfileSchema.parse(input);
  const { customerId, ...patch } = data;

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
  });
  if (!customer) throw new DomainError("Client not found");

  // Only the fields this section actually submitted, so saving the dining form
  // cannot blank the travel fields. Empty strings arrive from unset <select>
  // elements and do mean "clear this".
  const provided = onlyProvided(input as Record<string, unknown>, patch);
  const values = Object.fromEntries(
    Object.entries(provided).map(([key, value]) => [
      key,
      value === "" || value === undefined ? null : value,
    ]),
  );

  if (Object.keys(values).length === 0) return;

  await db.transaction(async (tx) => {
    await tx
      .insert(customerPreferenceProfile)
      .values({ customerId, ...values, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: customerPreferenceProfile.customerId,
        set: { ...values, updatedAt: new Date(), updatedBy: actor.id },
      });

    await tx
      .update(customers)
      .set({ profileUpdatedAt: new Date(), updatedBy: actor.id })
      .where(eq(customers.id, customerId));

    await logActivity(
      {
        actor,
        entityType: "preference",
        entityId: customerId,
        action: "preference_updated",
        customerId,
        householdId: customer.householdId,
        summary: "Preference details updated",
      },
      tx,
    );
  });
}
