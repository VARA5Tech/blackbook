import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import loyaltyCatalogue from "@/db/loyalty-programmes.json";
import { db } from "@/db";
import {
  customerPreferences,
  customers,
  milestones,
  preferenceOptions,
  trips,
  type Customer,
} from "@/db/schema";
import { requireCapability } from "@/auth/session";
import { displayName, GENDER_LABELS } from "@/domain/customers";
import { parseInternationalPhone, uuidSchema } from "@/domain/shared";
import { slugify } from "@/domain/preferences";
import {
  emailsFromTern,
  fieldState,
  foodDrinkKind,
  IMPORT_FIELDS,
  suggestInternational,
  TRAVEL_PREFERENCE_FIELDS,
  tripSummaryFromRow,
  type ImportField,
  type TravelPreferenceField,
  genderFromTern,
  isPlaceholderTraveler,
  itineraryItem,
  parseTernDates,
  phonesFromTern,
  preferenceChipsFromTern,
  splitHonorific,
  travelDocumentsFromTern,
  travelPreferencesFromTern,
  tripFlags,
  tripStatusFromTern,
  type ItineraryDay,
  type StoredTravelDocument,
} from "@/domain/trips";
import { logger } from "@/lib/logger";
import { canSeal, lastFour, open, seal } from "@/lib/sealed";
import { ternBridge, ternConfigured, type TernContact, type TernTrip } from "@/lib/tern";
import { diffFields, logActivity } from "./activity-service";
import { DomainError } from "./client-service";

/**
 * Bringing a client's history over from Tern, one client at a time, when
 * somebody asks.
 *
 * Nothing here runs by itself and nothing imports in bulk. A person searches
 * Tern, picks a contact and presses Populate; the client is filled in, then
 * each of their trips is fetched in turn, so the screen can show progress and
 * no single request has to outlive a client with twenty trips.
 *
 * It happens in two steps. `previewTernClient` reads Tern and says what an
 * import would do — every field beside the client's own, every preference,
 * date, document and trip — and changes nothing. `applyTernImport` then does
 * exactly what the person ticked, and no more.
 *
 * Three rules hold throughout:
 *
 * - **Blackbook's own entries win unless somebody says otherwise.** A field
 *   the desk filled in is kept by default; Tern's value replaces it only when
 *   a person chooses that field, and the trail records what was replaced.
 * - **Nothing is guessed.** A phone without its country code, a date Tern
 *   wrote ambiguously, a trip that looks like a test: each is kept as Tern
 *   wrote it and shown to a person rather than fitted into a field.
 * - **Passport numbers are sealed or not stored.** Without the encryption key
 *   they are left in Tern and the screen says so.
 */

const ternId = z.string().regex(/^[0-9]{1,12}$/, "Not a Tern id");

/* ------------------------------------------------------------ status */

export async function ternStatus() {
  await requireCapability("client.read");
  if (!ternConfigured()) {
    return { configured: false as const, signedIn: false, healthy: false, message: "The Tern bridge is not set up." };
  }
  const health = await ternBridge.health();
  if (!health.ok) {
    return { configured: true as const, signedIn: false, healthy: false, message: health.message };
  }
  if (!health.data.signedIn) {
    return { configured: true as const, signedIn: false, healthy: false, message: "Tern has signed the office machine out. Someone needs to sign in again there." };
  }
  /*
   * Signed in, but is Tern still the shape the parser expects? A redesign
   * would otherwise show up as empty imports. Checked here so the desk sees a
   * banner before it trusts an import, not after.
   */
  const schema = await ternBridge.schemaCheck();
  if (schema.ok && !schema.data.ok) {
    const broken = schema.data.checks.filter((c) => !c.pass).map((c) => c.name);
    return {
      configured: true as const,
      signedIn: true,
      healthy: false,
      message: `Tern's pages have changed shape (${broken.join(", ")}). Imports are paused until the reader is updated.`,
    };
  }
  return { configured: true as const, signedIn: true, healthy: true, message: null };
}

/* ------------------------------------------------------------ search */

/**
 * Tern contacts matching a name or email, each marked with the Blackbook
 * client it is already linked to, if any, so Populate cannot make a second
 * copy of somebody.
 */
export async function searchTern(query: string) {
  await requireCapability("client.read");
  const q = z.string().trim().min(2, "Type at least two letters").max(80).parse(query);

  const result = await ternBridge.searchContacts(q);
  if (!result.ok) return { ok: false as const, message: result.message };

  const ids = result.data.map((hit) => hit.ternId);
  const linked = ids.length
    ? await db
        .select({ id: customers.id, ref: customers.ref, ternId: customers.ternId })
        .from(customers)
        .where(inArray(customers.ternId, ids))
    : [];
  const byTern = new Map(linked.map((c) => [c.ternId, c]));

  return {
    ok: true as const,
    hits: result.data.map((hit) => ({
      ...hit,
      linkedTo: byTern.get(hit.ternId) ? { id: byTern.get(hit.ternId)!.id, ref: byTern.get(hit.ternId)!.ref } : null,
    })),
  };
}

/* ------------------------------------------------------------ what Tern holds */

/** One membership read from Tern, onto Blackbook's catalogue by programme name. */
type TernMembership = { label: string; number: string | null; tier: string | null };

/**
 * Everything a Tern contact can give a client, read once and in Blackbook's
 * terms. Both the preview and the import work from this, so what somebody
 * approves on screen is exactly what is written.
 */
function readContact(contact: TernContact) {
  const identity = contact.forms.identity ?? {};
  const str = (k: string) =>
    typeof identity[k] === "string" && (identity[k] as string).trim() ? (identity[k] as string).trim() : null;

  const emails = emailsFromTern(contact.items?.emails);
  const phones = phonesFromTern(contact.items?.phones);
  const withPlus = phones
    .filter((p) => !p.needsCountry)
    .map((p) => parseInternationalPhone(p.phone)?.international)
    .filter((p): p is string => Boolean(p));

  const fields: Partial<Record<ImportField, string | null>> = {
    prefix: str("prefix"),
    firstName: str("first_name"),
    middleName: str("middle_name"),
    lastName: str("last_name"),
    suffix: str("suffix"),
    preferredName: str("preferred_first_name"),
    dateOfBirth: /^\d{4}-\d{2}-\d{2}$/.test(str("born_at") ?? "") ? str("born_at") : null,
    gender: genderFromTern(identity.gender),
    email: emails[0]?.email ?? null,
    mobile: withPlus[0] ?? null,
    ...travelPreferencesFromTern(contact.forms.other_travel_preferences),
  };

  const chips = preferenceChipsFromTern(contact.profile);
  const programmes = new Map((loyaltyCatalogue.programs as { id: number; name: string }[]).map((p) => [String(p.id), p.name]));
  const memberships: TernMembership[] = [];
  for (const m of (contact.items?.loyalty_programs ?? []) as Record<string, unknown>[]) {
    const label = programmes.get(String(m.loyalty_program_id));
    if (label) {
      memberships.push({
        label,
        number: typeof m.id_number === "string" ? m.id_number : null,
        tier: typeof m.loyalty_program_level_id === "string" ? m.loyalty_program_level_id : null,
      });
    }
  }

  const annMonth = str("anniversary_month");
  const annDay = Number(str("anniversary_day"));
  const annYear = Number(str("anniversary_year"));
  const monthIndex = annMonth ? new Date(`${annMonth} 1, 2000`).getMonth() + 1 : NaN;
  const anniversary =
    monthIndex >= 1 && annDay >= 1 && annYear >= 1900
      ? `${annYear}-${String(monthIndex).padStart(2, "0")}-${String(annDay).padStart(2, "0")}`
      : null;

  return {
    fields,
    emails,
    phones,
    /** Numbers Tern holds without a plus, each with the reading a person would likely confirm. */
    needsCountry: phones.filter((p) => p.needsCountry).map((p) => ({ raw: p.phone, suggestion: suggestInternational(p.phone) })),
    preferences: [
      ...chips.interests.map((label) => ({ kind: "interest", label, number: null, tier: null })),
      ...chips.foodDrink.map((label) => ({ kind: foodDrinkKind(label), label, number: null, tier: null })),
      ...memberships.map((m) => ({ kind: "loyalty_programme", label: m.label, number: m.number, tier: m.tier })),
    ],
    milestones: [
      ...(fields.dateOfBirth ? [{ type: "birthday" as const, date: fields.dateOfBirth }] : []),
      ...(anniversary ? [{ type: "wedding_anniversary" as const, date: anniversary }] : []),
    ],
    documents: travelDocumentsFromTern(
      contact.items?.passports as Record<string, unknown>[] | undefined,
      contact.forms.travel_information,
    ),
    trips: (contact.tabs.trips?.tripRows ?? []).map((row) => ({ ternId: row.ternId, ...tripSummaryFromRow(row.texts) })),
    tripIds: contact.tabs.trips?.trips ?? [],
    files: contact.tabs.documents?.documents ?? [],
  };
}

/**
 * Tern's copy of the contact, as kept on the client: everything, minus the
 * passports and secure numbers, which are stored sealed and nowhere else.
 */
function rawWithoutSecrets(contact: TernContact) {
  const without = <T extends object>(source: T | undefined, key: string) =>
    Object.fromEntries(Object.entries(source ?? {}).filter(([k]) => k !== key));
  return {
    ...contact,
    items: without(contact.items, "passports"),
    forms: without(contact.forms, "travel_information"),
  };
}

/** Stable keys the preview and the import agree on, so a tick means one thing. */
const preferenceKey = (p: { kind: string; label: string }) => `${p.kind}:${slugify(p.label)}`;
const documentKey = (d: { kind: string; number: string }) => `${d.kind}:${lastFour(d.number)}`;

/** Words for a stored value, so the preview compares like with like. */
function shown(field: ImportField, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  if (field === "gender") return GENDER_LABELS[text as keyof typeof GENDER_LABELS] ?? text;
  if (field in TRAVEL_PREFERENCE_FIELDS) {
    const values = TRAVEL_PREFERENCE_FIELDS[field as TravelPreferenceField].values as Record<string, string>;
    return values[text] ?? text;
  }
  return text;
}

/* ------------------------------------------------------------ who it is */

const targetSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("new") }),
  z.object({ mode: z.literal("existing"), customerId: uuidSchema }),
]);

/**
 * The client this Tern contact already is, or might be.
 *
 * An explicit choice wins — the page it was opened from, or a client the desk
 * picked. Then Tern's own id, when the contact was brought over before. Then
 * the likely matches — same email, same number, same name — which are only
 * ever offered, never joined on their own.
 */
async function resolveTarget(ternId: string, facts: ReturnType<typeof readContact>, customerId?: string) {
  const explicit = customerId
    ? await db.query.customers.findFirst({ where: eq(customers.id, customerId) })
    : null;
  if (customerId && !explicit) throw new DomainError("That client no longer exists.");

  const linked = await db.query.customers.findFirst({ where: eq(customers.ternId, ternId) });
  if (explicit && linked && linked.id !== explicit.id) {
    throw new DomainError(`This Tern contact is already linked to ${linked.ref}.`);
  }
  if (explicit?.ternId && explicit.ternId !== ternId) {
    throw new DomainError(`${explicit.ref} is already linked to a different Tern contact.`);
  }

  const existing = explicit ?? linked ?? null;
  if (existing) return { existing, candidates: [] };

  const email = facts.fields.email ?? null;
  const digits = [facts.fields.mobile, ...facts.needsCountry.map((n) => n.suggestion)]
    .filter((p): p is string => Boolean(p))
    .map((p) => p.replace(/\D/g, ""));
  const firstName = facts.fields.firstName ?? "";
  const lastName = facts.fields.lastName;

  const likely = await db
    .select({
      id: customers.id, ref: customers.ref, firstName: customers.firstName, lastName: customers.lastName,
      preferredName: customers.preferredName, email: customers.email,
      mobileNormalized: customers.mobileNormalized, whatsappNormalized: customers.whatsappNormalized,
    })
    .from(customers)
    .where(
      and(
        isNull(customers.archivedAt),
        isNull(customers.ternId),
        or(
          email ? eq(sql`lower(${customers.email})`, email) : sql`false`,
          digits.length ? inArray(customers.mobileNormalized, digits) : sql`false`,
          digits.length ? inArray(customers.whatsappNormalized, digits) : sql`false`,
          firstName
            ? and(
                eq(sql`lower(${customers.firstName})`, firstName.toLowerCase()),
                lastName ? eq(sql`lower(${customers.lastName})`, lastName.toLowerCase()) : sql`true`,
              )
            : sql`false`,
        ),
      ),
    )
    .limit(5);

  return {
    existing: null,
    candidates: likely.map((c) => ({
      id: c.id,
      ref: c.ref,
      name: displayName(c),
      reason:
        email && c.email?.toLowerCase() === email ? "same email"
          : digits.some((d) => d === c.mobileNormalized || d === c.whatsappNormalized) ? "same phone number"
            : "same name",
    })),
  };
}

/* ------------------------------------------------------------ preview */

const previewSchema = z.object({ ternId, customerId: uuidSchema.optional() });

/**
 * What an import would do, before it does anything.
 *
 * Every field Tern holds, beside what the client holds now, marked new, the
 * same, or different; every preference, membership, date, travel document and
 * trip, each marked if it is already here. Passport numbers stay on the
 * server: the preview carries their last four only.
 */
export async function previewTernClient(input: z.input<typeof previewSchema>) {
  await requireCapability("client.read");
  const data = previewSchema.parse(input);

  // Prefetch: while somebody reads the preview, the bridge reads the trips.
  const fetched = await ternBridge.contact(data.ternId, { prefetch: true });
  if (!fetched.ok) return { ok: false as const, message: fetched.message };
  const facts = readContact(fetched.data);
  if (!facts.fields.firstName) return { ok: false as const, message: "Tern has no first name for this contact." };

  const { existing, candidates } = await resolveTarget(data.ternId, facts, data.customerId);

  return { ok: true as const, ...(await planFor(existing, facts)), candidates, ternId: data.ternId };
}

/** The comparison itself, against a client or against nobody. Also used when the desk picks a match. */
async function planFor(existing: Customer | null, facts: ReturnType<typeof readContact>) {
  const current = (existing ?? {}) as Record<string, unknown>;

  const fields = IMPORT_FIELDS.flatMap(([field, label]) => {
    const tern = shown(field, facts.fields[field]);
    const now = shown(field, current[field]);
    const state = fieldState(tern, now);
    return state ? [{ field, label, tern: tern!, current: now, state }] : [];
  });

  // Anything already on the client is marked, so it is not offered twice.
  const heldPrefs = existing
    ? await db
        .select({ kind: preferenceOptions.kind, slug: preferenceOptions.slug })
        .from(customerPreferences)
        .innerJoin(preferenceOptions, eq(preferenceOptions.id, customerPreferences.optionId))
        .where(eq(customerPreferences.customerId, existing.id))
    : [];
  const held = new Set(heldPrefs.map((p) => `${p.kind}:${p.slug}`));

  const heldDates = existing
    ? await db.select({ type: milestones.type }).from(milestones)
        .where(and(eq(milestones.customerId, existing.id), eq(milestones.status, "active")))
    : [];

  const heldDocs = new Set(
    ((existing?.travelDocuments ?? []) as StoredTravelDocument[]).map((d) => `${d.kind}:${d.last4}`),
  );

  const knownTrips = facts.tripIds.length
    ? await db.select({ ternId: trips.ternId, customerId: trips.customerId }).from(trips).where(inArray(trips.ternId, facts.tripIds))
    : [];
  const tripHere = new Map(knownTrips.map((t) => [t.ternId, t.customerId]));

  // A row per trip on the Tab; any id the rows missed still appears, by id.
  const rows = new Map(facts.trips.map((t) => [t.ternId, t]));
  const tripList = facts.tripIds.map((id) => {
    const row = rows.get(id);
    const title = row?.title ?? `Trip ${id}`;
    return {
      ternId: id,
      title,
      status: row?.status ?? null,
      datesText: row?.datesText ?? null,
      startsOn: row?.startsOn ?? null,
      /*
       * Only what the row can show. The Trips tab lists when a trip was last
       * touched, not when it runs, so "no dates" cannot be judged from here —
       * every trip looked undated and started unticked. The full read of each
       * trip decides that; the name alone can still look like a test.
       */
      flags: tripFlags({ title, startsOn: row?.startsOn ?? null, datesText: row?.datesText ?? null, travelers: [{ name: "x" }] })
        .filter((flag) => flag !== "no_dates"),
      already: tripHere.has(id),
    };
  });

  return {
    target: existing
      ? { mode: "existing" as const, customerId: existing.id, ref: existing.ref, name: displayName(existing) }
      : { mode: "new" as const },
    name: [facts.fields.prefix, facts.fields.firstName, facts.fields.lastName].filter(Boolean).join(" "),
    fields,
    phones: facts.needsCountry,
    preferences: facts.preferences.map((p) => ({
      key: preferenceKey(p),
      kind: p.kind,
      label: p.label,
      number: p.number,
      tier: p.tier,
      already: held.has(preferenceKey(p)),
    })),
    milestones: facts.milestones.map((m) => ({ ...m, already: heldDates.some((h) => h.type === m.type) })),
    travelDocuments: {
      canSeal: canSeal(),
      items: facts.documents.map((d) => ({
        key: documentKey(d),
        kind: d.kind,
        nationality: d.nationality,
        last4: lastFour(d.number),
        expiresOn: d.expiresOn,
        already: heldDocs.has(`${d.kind}:${lastFour(d.number)}`),
      })),
    },
    trips: tripList,
    files: facts.files.map((f) => f.name).filter(Boolean),
  };
}

/** The preview again, against a client the desk has just picked as the same person. */
export async function previewTernAgainst(input: { ternId: string; customerId: string }) {
  await requireCapability("client.read");
  const data = z.object({ ternId, customerId: uuidSchema }).parse(input);
  const fetched = await ternBridge.contact(data.ternId);
  if (!fetched.ok) return { ok: false as const, message: fetched.message };
  const facts = readContact(fetched.data);
  const { existing } = await resolveTarget(data.ternId, facts, data.customerId);
  return { ok: true as const, ...(await planFor(existing, facts)), candidates: [], ternId: data.ternId };
}

/* ------------------------------------------------------------ import */

const importSchema = z.object({
  ternId,
  target: targetSchema,
  /** Per field: take Tern's value, or keep what is here. Unlisted fields are left alone. */
  fields: z.record(z.string(), z.enum(["take", "keep"])).default({}),
  /** Numbers the desk confirmed, already in international form. */
  phones: z.array(z.string()).max(10).default([]),
  preferences: z.array(z.string()).max(500).default([]),
  milestones: z.array(z.enum(["birthday", "wedding_anniversary"])).default([]),
  travelDocuments: z.array(z.string()).max(20).default([]),
});

export type TernImportInput = z.input<typeof importSchema>;

export type TernImportResult = {
  customerId: string;
  created: boolean;
  applied: string[];
  skipped: string[];
  travelDocuments: number;
  travelDocumentsSkipped: boolean;
  preferences: number;
};

/**
 * Brings the parts somebody ticked into Blackbook, and nothing else.
 *
 * Tern is read again rather than trusting the preview's values back from the
 * browser: what is written comes from Tern and from this server, and the
 * browser only says which of it to take.
 */
export async function applyTernImport(input: TernImportInput): Promise<TernImportResult> {
  const data = importSchema.parse(input);
  const target = data.target;
  const actor = await requireCapability(target.mode === "existing" ? "client.update" : "client.create");

  const fetched = await ternBridge.contact(data.ternId);
  if (!fetched.ok) throw new DomainError(fetched.message);
  const contact = fetched.data;
  const facts = readContact(contact);
  const firstName = facts.fields.firstName;
  if (!firstName) throw new DomainError("Tern has no first name for this contact.");

  const { existing } = await resolveTarget(
    data.ternId,
    facts,
    target.mode === "existing" ? target.customerId : undefined,
  );
  if (target.mode === "new" && existing) {
    throw new DomainError(`This Tern contact is already linked to ${existing.ref}.`);
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  const patch: Record<string, unknown> = {};

  for (const [field] of IMPORT_FIELDS) {
    const value = facts.fields[field];
    if (value === null || value === undefined) continue;
    if (data.fields[field] !== "take") continue;
    patch[field] = value;
  }

  /*
   * Confirmed numbers fill Mobile, then WhatsApp, whichever is free after the
   * fields above. Every number is checked against every other client first:
   * one number, one client, or the members' gate locks both out.
   */
  const current = (existing ?? {}) as Record<string, unknown>;
  const confirmed = data.phones
    .map((p) => parseInternationalPhone(p)?.international)
    .filter((p): p is string => Boolean(p));
  for (const number of confirmed) {
    const slot = !(patch.mobile ?? current.mobile) ? "mobile" : !(patch.whatsapp ?? current.whatsapp) ? "whatsapp" : null;
    if (slot) patch[slot] = number;
    else skipped.push(`${number}: mobile and WhatsApp are both taken`);
  }
  for (const slot of ["mobile", "whatsapp"] as const) {
    const number = patch[slot] as string | undefined;
    if (!number) continue;
    const digits = number.replace(/\D/g, "");
    const taken = await db.query.customers.findFirst({
      where: and(isNull(customers.archivedAt), or(eq(customers.mobileNormalized, digits), eq(customers.whatsappNormalized, digits))),
    });
    if (taken && taken.id !== existing?.id) {
      delete patch[slot];
      skipped.push(`${number}: already on ${taken.ref}`);
    }
  }

  const sealing = canSeal();
  const chosenDocs = facts.documents.filter((d) => data.travelDocuments.includes(documentKey(d)));
  const sealedDocs: StoredTravelDocument[] = sealing
    ? chosenDocs.map(({ number, ...rest }) => ({ ...rest, sealed: seal(number), last4: lastFour(number) }))
    : [];

  const now = new Date();

  const result = await db.transaction(async (tx) => {
    let customerId: string;
    let created = false;

    if (existing) {
      customerId = existing.id;
      // Tern's documents replace the ones chosen again; everything else stays.
      const keptDocs = ((existing.travelDocuments as StoredTravelDocument[]) ?? []).filter(
        (d) => !sealedDocs.some((s) => s.kind === d.kind && s.last4 === d.last4),
      );
      await tx
        .update(customers)
        .set({
          ...patch,
          ternId: data.ternId,
          ternRaw: rawWithoutSecrets(contact),
          ternSyncedAt: now,
          ...(sealedDocs.length ? { travelDocuments: [...keptDocs, ...sealedDocs] } : {}),
          updatedAt: now,
          updatedBy: actor.id,
        })
        .where(eq(customers.id, customerId));
    } else {
      created = true;
      const [row] = await tx
        .insert(customers)
        .values({
          ...(patch as { firstName: string }),
          firstName: (patch.firstName as string) ?? firstName,
          ternId: data.ternId,
          ternRaw: rawWithoutSecrets(contact),
          ternSyncedAt: now,
          travelDocuments: sealedDocs,
          profileUpdatedAt: now,
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning({ id: customers.id });
      customerId = row.id;
    }
    applied.push(...Object.keys(patch));

    const heldDates = await tx
      .select({ type: milestones.type })
      .from(milestones)
      .where(and(eq(milestones.customerId, customerId), eq(milestones.status, "active")));
    for (const m of facts.milestones) {
      if (!data.milestones.includes(m.type) || heldDates.some((h) => h.type === m.type)) continue;
      const who = facts.fields.firstName ?? firstName;
      await tx.insert(milestones).values({
        customerId,
        type: m.type,
        title: m.type === "birthday" ? `${who}'s birthday` : "Wedding anniversary",
        date: m.date,
        createdBy: actor.id,
      });
      applied.push(m.type);
    }

    let preferencesAdded = 0;
    for (const p of facts.preferences) {
      if (!data.preferences.includes(preferenceKey(p))) continue;
      const slug = slugify(p.label);
      if (!slug) continue;
      let option = await tx.query.preferenceOptions.findFirst({
        where: and(eq(preferenceOptions.kind, p.kind as never), eq(preferenceOptions.slug, slug)),
      });
      if (!option) {
        [option] = await tx
          .insert(preferenceOptions)
          .values({ kind: p.kind as never, slug, label: p.label, isCustom: true, createdBy: actor.id })
          .onConflictDoNothing()
          .returning();
        option ??= await tx.query.preferenceOptions.findFirst({
          where: and(eq(preferenceOptions.kind, p.kind as never), eq(preferenceOptions.slug, slug)),
        });
      }
      if (!option) continue;
      const inserted = await tx
        .insert(customerPreferences)
        .values({ customerId, optionId: option.id, polarity: "prefer", membershipNumber: p.number, membershipTier: p.tier })
        .onConflictDoNothing()
        .returning({ id: customerPreferences.id });
      preferencesAdded += inserted.length;
    }

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: customerId,
        action: created ? "created" : "updated",
        customerId,
        summary: created ? "Brought over from Tern" : "Updated from Tern",
        // What Tern overwrote, field by field, so the trail shows it like any edit.
        changes: existing ? diffFields(existing as Record<string, unknown>, patch) : undefined,
      },
      tx,
    );

    return { customerId, created, preferencesAdded };
  });

  logger.info("tern.client_imported", {
    customerId: result.customerId,
    created: result.created,
    fields: applied.length,
    documents: sealedDocs.length,
  });

  return {
    customerId: result.customerId,
    created: result.created,
    applied,
    skipped,
    travelDocuments: sealedDocs.length,
    travelDocumentsSkipped: chosenDocs.length > 0 && !sealing,
    preferences: result.preferencesAdded,
  };
}

/* ------------------------------------------------------------ populate in one step */

const populateClientSchema = z.object({
  ternId,
  customerId: uuidSchema.optional(),
  linkExisting: uuidSchema.optional(),
  createNew: z.boolean().optional(),
});

export type PopulateClientInput = z.input<typeof populateClientSchema>;

export type PopulateClientResult =
  | {
      status: "done";
      customerId: string;
      created: boolean;
      tripIds: string[];
      phonesToConfirm: string[];
      filled: string[];
      travelDocuments: number;
      travelDocumentsSkipped: boolean;
      preferences: number;
    }
  | { status: "possible_match"; candidates: { id: string; ref: string; name: string; reason: string }[] }
  | { status: "failed"; message: string };

/**
 * The whole import with the safe defaults, for anything that does not show a
 * preview: fill what is empty, keep everything the desk entered, take every
 * preference, date and document, and report the trips to bring over. A likely
 * match is still asked about rather than joined.
 */
export async function populateClientFromTern(input: PopulateClientInput): Promise<PopulateClientResult> {
  const data = populateClientSchema.parse(input);
  const targetId = data.customerId ?? data.linkExisting;
  await requireCapability(targetId ? "client.update" : "client.create");

  const fetched = await ternBridge.contact(data.ternId);
  if (!fetched.ok) return { status: "failed", message: fetched.message };
  const facts = readContact(fetched.data);
  if (!facts.fields.firstName) return { status: "failed", message: "Tern has no first name for this contact." };

  let resolved: Awaited<ReturnType<typeof resolveTarget>>;
  try {
    resolved = await resolveTarget(data.ternId, facts, targetId);
  } catch (error) {
    if (error instanceof DomainError) return { status: "failed", message: error.message };
    throw error;
  }
  if (!resolved.existing && resolved.candidates.length && !data.createNew) {
    return { status: "possible_match", candidates: resolved.candidates };
  }

  const plan = await planFor(resolved.existing, facts);
  const result = await applyTernImport({
    ternId: data.ternId,
    target: resolved.existing ? { mode: "existing", customerId: resolved.existing.id } : { mode: "new" },
    fields: Object.fromEntries(plan.fields.map((f) => [f.field, f.state === "new" ? "take" : "keep"])),
    preferences: plan.preferences.map((p) => p.key),
    milestones: plan.milestones.map((m) => m.type),
    travelDocuments: plan.travelDocuments.items.map((d) => d.key),
  });

  return {
    status: "done",
    customerId: result.customerId,
    created: result.created,
    tripIds: facts.tripIds,
    phonesToConfirm: [...facts.needsCountry.map((n) => n.raw), ...result.skipped],
    filled: result.applied,
    travelDocuments: result.travelDocuments,
    travelDocumentsSkipped: result.travelDocumentsSkipped,
    preferences: result.preferences,
  };
}

/* ------------------------------------------------------------ populate a trip */

const populateTripSchema = z.object({ ternId, customerId: uuidSchema });

function itineraryFromTern(trip: TernTrip): ItineraryDay[] {
  return trip.days.map((day, index) => ({
    day: index + 1,
    title: day.title,
    location: day.location,
    items: day.items
      .map((item) => itineraryItem(item.texts, item.ternId))
      .filter((item): item is NonNullable<typeof item> => item !== null),
  }));
}

/** "Swiss Franc (CHF)" into "CHF". */
const currencyCode = (text: string | undefined) => text?.match(/\(([A-Z]{3})\)\s*$/)?.[1] ?? null;

/**
 * One trip, fetched from Tern and written onto the client's history.
 *
 * Called once per trip after the client is populated. The trip belongs to the
 * client it was asked for; the other travellers are recorded on it, tied to a
 * Blackbook client where one exists, and never created as clients by this.
 */
/**
 * A Tern trip in Blackbook's words, before anything is stored: the same
 * reading the stored trip gets, so what somebody inspects in a preview is
 * exactly what an import writes.
 */
function tripFromTern(trip: TernTrip) {
  const itinerarySection = trip.overview.find((s) => s.heading === "Itinerary" || s.heading === "Itinerary Options");
  const datesText =
    itinerarySection?.tokens.map((t) => t.text).find((t) => /(19|20)\d{2}|Multiple Date Ranges/.test(t)) ?? null;
  const { startsOn, endsOn } = parseTernDates(datesText);
  const title = trip.title || itinerarySection?.tokens[0]?.text || "Trip from Tern";
  const travelers = trip.travelers.map((t) => {
    const { prefix, name } = splitHonorific(t.name);
    return { name, prefix, ternContactId: t.contactId, primary: t.primary, email: t.email, phone: t.phone, birthday: t.birthday };
  });
  return {
    title,
    status: tripStatusFromTern(trip.settings.status_id) ?? "planning",
    startsOn,
    endsOn,
    datesText,
    partySize: travelers.filter((t) => !isPlaceholderTraveler(t.name)).length || travelers.length || null,
    currency: currencyCode(trip.settings.currency),
    travelers,
    itinerary: itineraryFromTern(trip),
    flags: tripFlags({ title, startsOn, datesText, travelers }),
    /** Every section of Tern's trip page, for whatever the fields above do not cover. */
    sections: trip.overview,
  };
}

/**
 * One trip, read from Tern and shown, not stored: what a person sees when
 * they open a trip in the preview. Cheap after the first look, because the
 * bridge keeps the last few minutes of reads.
 */
export async function previewTernTrip(input: { ternId: string }) {
  await requireCapability("client.read");
  const id = ternId.parse(input.ternId);
  const fetched = await ternBridge.trip(id);
  if (!fetched.ok) return { ok: false as const, message: fetched.message };
  const mapped = tripFromTern(fetched.data);
  const already = await db.query.trips.findFirst({ where: eq(trips.ternId, id), columns: { id: true, customerId: true } });
  return { ok: true as const, ternId: id, ...mapped, already: already ?? null };
}

export async function populateTripFromTern(input: z.input<typeof populateTripSchema>) {
  const actor = await requireCapability("client.update");
  const data = populateTripSchema.parse(input);

  const customer = await db.query.customers.findFirst({ where: eq(customers.id, data.customerId) });
  if (!customer) throw new DomainError("Client not found");

  const fetched = await ternBridge.trip(data.ternId);
  if (!fetched.ok) return { ok: false as const, message: fetched.message };
  const trip = fetched.data;
  const { title, startsOn, endsOn, datesText } = tripFromTern(trip);

  const contactIds = trip.travelers.map((t) => t.contactId).filter((id): id is string => Boolean(id));
  const known = contactIds.length
    ? await db.select({ id: customers.id, ternId: customers.ternId }).from(customers).where(inArray(customers.ternId, contactIds))
    : [];
  const clientFor = new Map(known.map((k) => [k.ternId, k.id]));

  const travelers = trip.travelers.map((t) => {
    const { prefix, name } = splitHonorific(t.name);
    return {
      name,
      prefix,
      ternContactId: t.contactId,
      customerId: (t.contactId && clientFor.get(t.contactId)) || (t.contactId === customer.ternId ? customer.id : null),
      primary: t.primary,
      email: t.email,
      phone: t.phone,
      birthday: t.birthday,
    };
  });

  const values = {
    customerId: customer.id,
    householdId: customer.householdId,
    title,
    status: tripStatusFromTern(trip.settings.status_id) ?? "planning",
    startsOn,
    endsOn,
    datesText,
    partySize: travelers.filter((t) => !isPlaceholderTraveler(t.name)).length || travelers.length || null,
    currency: currencyCode(trip.settings.currency),
    travelers,
    itinerary: itineraryFromTern(trip),
    flags: tripFlags({ title, startsOn, datesText, travelers }),
    ternId: data.ternId,
    ternRaw: { overview: trip.overview, settings: trip.settings, days: trip.days },
    ternSyncedAt: new Date(),
    updatedAt: new Date(),
  };

  const existing = await db.query.trips.findFirst({ where: eq(trips.ternId, data.ternId) });
  if (existing) {
    // The same Tern trip may be on two clients' Trips tabs — a couple, say.
    // It stays with whoever it was first populated for.
    const update: Partial<typeof values> = { ...values };
    delete update.customerId;
    delete update.householdId;
    await db.update(trips).set(update).where(eq(trips.id, existing.id));
    return { ok: true as const, tripId: existing.id, created: false, title, flags: values.flags };
  }

  const [row] = await db.insert(trips).values({ ...values, createdBy: actor.id }).returning({ id: trips.id });
  return { ok: true as const, tripId: row.id, created: true, title, flags: values.flags };
}

/* ------------------------------------------------------------ reading trips */

/**
 * Every trip a client is on: their own, and the ones they travelled on as
 * somebody's companion, newest first.
 */
export async function tripsForClient(customerId: string) {
  await requireCapability("client.read");
  const id = uuidSchema.parse(customerId);
  return db
    .select()
    .from(trips)
    .where(or(eq(trips.customerId, id), sql`${trips.travelers} @> ${JSON.stringify([{ customerId: id }])}::jsonb`))
    .orderBy(sql`${trips.startsOn} desc nulls last`, sql`${trips.createdAt} desc`);
}

/**
 * One stored trip, everything about it, for its own page. Readable by anyone
 * who can read the client, whether the trip is theirs or they were on it.
 */
export async function getTrip(tripId: string) {
  await requireCapability("client.read");
  const id = uuidSchema.parse(tripId);
  const trip = await db.query.trips.findFirst({ where: eq(trips.id, id) });
  if (!trip) return null;
  const client = await db.query.customers.findFirst({
    where: eq(customers.id, trip.customerId),
    columns: { id: true, ref: true, firstName: true, lastName: true, preferredName: true },
  });
  return { trip, client };
}

/* ------------------------------------------------------------ travel documents */

/** Six months: the rule most countries apply, and the one a curator checks first. */
const SIX_MONTHS = 183 * 24 * 60 * 60 * 1000;

/**
 * A client's travel documents as the screen may see them.
 *
 * The sealed number is removed here, on the server, so it never reaches a
 * browser: the screen gets the kind, nationality, expiry and last four, and
 * asks for a number only through `revealTravelDocument`, which checks and
 * records the request. Whether each has expired is decided here too, once.
 */
export function travelDocumentsForScreen(stored: unknown) {
  const now = Date.now();
  return ((stored ?? []) as StoredTravelDocument[]).map((doc) => {
    const shown: Partial<StoredTravelDocument> = { ...doc };
    delete shown.sealed;
    const expires = doc.expiresOn ? Date.parse(doc.expiresOn) : null;
    const expiry: "expired" | "soon" | "ok" | null =
      expires === null ? null : expires < now ? "expired" : expires - now < SIX_MONTHS ? "soon" : "ok";
    return { ...(shown as Omit<StoredTravelDocument, "sealed">), expiry };
  });
}

/**
 * The number on one travel document, opened, for the person who asked.
 *
 * Its own capability, held by administrators and founders, and every reveal
 * is written to the client's trail: a passport number is shown on purpose,
 * to somebody with a reason, and the record says who and when.
 */
export async function revealTravelDocument(input: { customerId: string; index: number }) {
  const actor = await requireCapability("travel_document.reveal");
  const customerId = uuidSchema.parse(input.customerId);
  const index = z.number().int().min(0).max(20).parse(input.index);

  const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
  const doc = (customer?.travelDocuments as StoredTravelDocument[] | undefined)?.[index];
  if (!customer || !doc) throw new DomainError("That document is not on this client.");

  const number = open(doc.sealed);
  await logActivity({
    actor,
    entityType: "customer",
    entityId: customerId,
    action: "updated",
    customerId,
    summary: `Travel document number revealed (${doc.kind.replace("_", " ")} ending ${doc.last4})`,
  });
  return number;
}
