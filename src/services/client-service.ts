import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  activityLog,
  clientInterests,
  customers,
  households,
  users,
} from "@/db/schema";
import { requireCapability } from "@/auth/session";
import {
  clientDnaSchema,
  clientSearchSchema,
  countsAsClient,
  createCustomerSchema,
  displayName,
  fullName,
  updateCustomerSchema,
  type ClientDnaInput,
  type ClientSearchInput,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from "@/domain/customers";
import {
  onlyProvided,
  optionalEmail,
  parseInternationalPhone,
  requiredText,
  uuidSchema,
} from "@/domain/shared";
import { logger } from "@/lib/logger";
import {
  clientSignals,
  posthogIsConfigured,
  recentVisits,
  revokeRecordingShare,
  sessionReplays,
  shareRecording,
} from "@/lib/posthog";
import * as repo from "@/repositories/customer-repository";
import { diffFields, logActivity } from "./activity-service";

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function searchClients(input: ClientSearchInput) {
  await requireCapability("client.read");
  const query = clientSearchSchema.parse(input);
  return repo.searchCustomers(query);
}

/** The clients list, grouped so each household appears once under its primary. */
export async function searchClientGroups(input: ClientSearchInput) {
  await requireCapability("client.read");
  const query = clientSearchSchema.parse(input);
  return repo.searchClientGroups(query);
}

/**
 * Labels for the export, in the order the columns appear.
 *
 * Every column on the client is in here: a spreadsheet is somebody reading the
 * whole record away from the screen, and a field left out is a question they
 * cannot answer. A column added to the table and forgotten here still exports,
 * under a title derived from its name, so the file is never short of the truth.
 */
const EXPORT_LABELS: Record<string, string> = {
  ref: "Client ID",
  firstName: "First name",
  lastName: "Last name",
  preferredName: "Known as",
  status: "Status",
  mobile: "Mobile",
  whatsapp: "WhatsApp",
  email: "Email",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  nationality: "Nationality",
  city: "City",
  address: "Address",
  locationUrl: "Location pin",
  locationLat: "Latitude",
  locationLng: "Longitude",
  householdRole: "Role in household",
  customerSince: "Client since",
  clientDna: "Client DNA",
  dos: "Dos",
  donts: "Don'ts",
  remarks: "Remarks",
  eaName: "Assistant",
  eaPhone: "Assistant phone",
  eaEmail: "Assistant email",
  eaNotes: "Assistant notes",
  travelTypicalTripNights: "Typical trip nights",
  travelParty: "Travels as",
  travelFrequency: "Travel frequency",
  travelBudgetRange: "Budget range",
  travelBookingLeadTime: "Booking lead time",
  travelNotes: "Travel notes",
  hotelNotes: "Hotel notes",
  flightCabin: "Cabin",
  flightDirectPreference: "Direct flights",
  flightNotes: "Flight notes",
  diningDietary: "Dietary",
  diningFineDining: "Fine dining",
  diningNotes: "Dining notes",
  lifestyleExperienceStyle: "Experience style",
  lifestyleNotes: "Lifestyle notes",
  lastInteractionAt: "Last contacted",
  profileUpdatedAt: "Profile updated",
  preferencesUpdatedAt: "Preferences updated",
  createdAt: "Created",
  updatedAt: "Updated",
  archivedAt: "Archived",
  id: "Record ID",
};

/**
 * The two generated columns, which are the numbers above with the punctuation
 * taken out. They exist so the database can match on them; in a spreadsheet
 * they are the same fact twice.
 */
const EXPORT_SKIP = new Set(["mobileNormalized", "whatsappNormalized", "householdId", "primaryRmId", "createdBy", "updatedBy", "preferencesUpdatedBy"]);

/** "travelBudgetRange" reads as "Travel budget range" when nothing names it. */
function labelFor(key: string): string {
  return (
    EXPORT_LABELS[key] ??
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^./, (character) => character.toUpperCase())
  );
}

function exportValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join("; ");
  if (value instanceof Date) return formatDateTime(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value;
  const text = String(value);
  // A `date` column, which has no time to show.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatDate(text);
  // An enum value, which reads as words rather than as a key.
  if (/^[a-z]+(_[a-z0-9]+)+$/.test(text)) return humanise(text);
  return text;
}

/**
 * The clients the filters match, as a spreadsheet: one row per client, every
 * field Blackbook holds.
 *
 * Same filters as the screen, so what somebody exports is what they were
 * looking at, and the same capability: a spreadsheet is a read of the book and
 * it leaves the building, so it is worth being exact about who may ask for one.
 */
export async function exportClients(input: ClientSearchInput) {
  await requireCapability("client.read");
  const query = clientSearchSchema.parse(input);
  const data = await repo.exportCustomers(query);

  const preferencesFor = new Map<string, typeof data.preferences>();
  for (const row of data.preferences) {
    const list = preferencesFor.get(row.customerId) ?? [];
    list.push(row);
    preferencesFor.set(row.customerId, list);
  }
  const milestonesFor = new Map<string, string[]>();
  for (const row of data.milestones) {
    if (!row.customerId) continue;
    const list = milestonesFor.get(row.customerId) ?? [];
    list.push(`${row.title} (${formatDate(row.date)})`);
    milestonesFor.set(row.customerId, list);
  }
  const interestFor = new Map(data.interest.map((row) => [row.customerId, row]));
  const interactionsFor = new Map(data.interactions.map((row) => [row.customerId, row]));

  // Every column the client row carries, in schema order, minus the duplicates.
  const clientKeys = data.rows.length
    ? Object.keys(data.rows[0].customer).filter((key) => !EXPORT_SKIP.has(key))
    : [];
  // Ordered by the labels first, so a spreadsheet opens on the useful columns.
  const ordered = [
    ...Object.keys(EXPORT_LABELS).filter((key) => clientKeys.includes(key)),
    ...clientKeys.filter((key) => !(key in EXPORT_LABELS)),
  ];

  const related = [
    "Household",
    "Household ID",
    "Relationship manager",
    "Prefers",
    "Wishlist",
    "Avoids",
    "Memberships",
    "Milestones",
    "Journeys opened",
    "Reading time",
    "Asked the Curator",
    "Last seen on vara5.com",
    "Interactions logged",
    "Last interaction",
    "Created by",
    "Updated by",
    "Preferences updated by",
  ];

  const columns = [...ordered.map(labelFor), ...related];

  const rows = data.rows.map((row) => {
    const client = row.customer as Record<string, unknown>;
    const preferences = preferencesFor.get(client.id as string) ?? [];
    const taste = (polarity: string) =>
      preferences
        .filter((entry) => entry.polarity === polarity && entry.kind !== "loyalty_programme")
        .map((entry) => (entry.note ? `${entry.label} (${entry.note})` : entry.label))
        .join("; ");
    const memberships = preferences
      .filter((entry) => entry.kind === "loyalty_programme")
      .map((entry) =>
        [entry.label, entry.membershipNumber, entry.membershipTier].filter(Boolean).join(" · "),
      )
      .join("; ");
    const interest = interestFor.get(client.id as string);
    const logged = interactionsFor.get(client.id as string);

    return [
      ...ordered.map((key) => exportValue(client[key])),
      row.householdName,
      row.householdRef,
      row.managerName,
      taste("prefer"),
      taste("wishlist"),
      taste("avoid"),
      memberships,
      (milestonesFor.get(client.id as string) ?? []).join("; "),
      interest?.journeys ?? 0,
      interest?.seconds ? readingTime(interest.seconds) : "",
      interest?.asked ?? 0,
      interest?.lastSeenAt ? formatDateTime(interest.lastSeenAt) : "",
      logged?.logged ?? 0,
      logged?.lastSummary ?? "",
      row.createdByName,
      row.updatedByName,
      row.preferencesUpdatedByName,
    ];
  });

  logger.info("client.export", { rows: rows.length, columns: columns.length });
  return { columns, rows };
}

export async function getClient360(customerId: string) {
  await requireCapability("client.read");
  return repo.loadClient360(customerId);
}

/* ------------------------------------------------------------------ */
/* Private access, for the vara5.com website                        */
/* ------------------------------------------------------------------ */

export type PrivateAccessGuest = {
  /** The key the website seals into its session, and PostHog's person id. */
  id: string;
  ref: string;
  name: string;
  phone: string;
  email: string | null;
};

/**
 * Whether a phone number belongs to a client allowed through the website's
 * private gate, and where to send their code.
 *
 * No capability check, deliberately: the caller is the website, not a member
 * of staff, and `/api/private-access/lookup` authenticates it by signature
 * before calling this. Nothing else may call it.
 *
 * Only an active, unarchived client matches, on the exact international number,
 * mobile or WhatsApp. A number two clients share is refused rather than guessed.
 *
 * The code goes back to whichever of the client's own numbers was typed: clients
 * keep WhatsApp on both, and a code that arrives on the handset they just used
 * is the one they are waiting for. It is still only ever a number already on the
 * record, so nobody can have a client's code delivered to a phone of their own.
 * The answer is a name, that number, and the client's email if the record holds
 * one, which the website falls back to when WhatsApp refuses the message.
 */
export async function lookupPrivateAccessGuest(
  phone: string,
): Promise<PrivateAccessGuest | null> {
  const parsed = parseInternationalPhone(phone);
  if (!parsed) return null;

  const matches = await repo.findPrivateAccessGuests(parsed.e164.slice(1));

  if (matches.length > 1) {
    logger.warn("private_access.ambiguous_number", {
      customerIds: matches.map((match) => match.id),
    });
    return null;
  }

  const [guest] = matches;
  // The match was exact, so this is the typed number; read back off the record
  // rather than echoed, so only a stored number is ever returned.
  const sendTo = [guest?.mobileNormalized, guest?.whatsappNormalized].find(
    (number) => number === parsed.e164.slice(1),
  );
  if (!guest || !sendTo) {
    logger.info("private_access.lookup", { outcome: "not_found" });
    return null;
  }

  logger.info("private_access.lookup", { outcome: "found", customerId: guest.id });
  return {
    id: guest.id,
    ref: guest.ref,
    name: guest.preferredName?.trim() || guest.firstName,
    phone: `+${sendTo}`,
    email: guest.email,
  };
}

/**
 * The same answer, for a guest the website has already signed in.
 *
 * The website re-checks on every page load by the id in its signed session, not
 * by the number typed weeks ago, so correcting a client's phone in Blackbook
 * does not sign them out and their history stays on one client. Archiving them
 * or making them inactive still ends access at the next load.
 */
export async function lookupPrivateAccessGuestById(
  customerId: string,
): Promise<PrivateAccessGuest | null> {
  if (!uuidSchema.safeParse(customerId).success) return null;

  const guest = await repo.findPrivateAccessGuestById(customerId);
  const sendTo = guest?.whatsappNormalized ?? guest?.mobileNormalized;
  if (!guest || !sendTo) {
    logger.info("private_access.lookup_by_id", { outcome: "not_found" });
    return null;
  }

  return {
    id: guest.id,
    ref: guest.ref,
    name: guest.preferredName?.trim() || guest.firstName,
    phone: `+${sendTo}`,
    email: guest.email,
  };
}

/**
 * Keep the email a guest gave the website when WhatsApp could not reach them.
 *
 * Only fills a blank: an address already on the record is never overwritten
 * from the gate, so nobody can point a client's code at an address of their own
 * by typing one here. Same rules as the lookup, and the same reason for having
 * no capability check. The entry is written as the system, with no actor.
 */
export async function savePrivateAccessEmail(
  phone: string,
  email: string,
): Promise<boolean> {
  const address = optionalEmail.safeParse(email);
  if (!address.success || !address.data) return false;

  const parsed = parseInternationalPhone(phone);
  if (!parsed) return false;

  const matches = await repo.findPrivateAccessGuests(parsed.e164.slice(1));
  if (matches.length !== 1) return false;

  const [guest] = matches;
  if (guest.email) return false;

  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({ email: address.data, updatedAt: new Date() })
      .where(eq(customers.id, guest.id));
    await tx.insert(activityLog).values({
      entityType: "customer",
      entityId: guest.id,
      customerId: guest.id,
      action: "updated",
      summary: "Email added from the private access gate",
      changes: { email: { from: null, to: address.data } },
      actorId: null,
    });
  });

  logger.info("private_access.email_saved", { customerId: guest.id });
  return true;
}

/* ------------------------------------------------------------------ */
/* Interest, reported by vara5.com                                  */
/* ------------------------------------------------------------------ */

export const INTEREST_KINDS = [
  "opened",
  "read",
  "photos",
  "video",
  "cta_clicked",
] as const;

const interestSchema = z.object({
  customerId: uuidSchema,
  /** The journey's slug, which the website owns. */
  destination: requiredText("Destination", 120),
  title: requiredText("Title", 200),
  kind: z.enum(INTEREST_KINDS),
  /** Capped in the schema as well as the table, so a stuck timer cannot lie. */
  seconds: z.coerce.number().int().min(0).max(86_400).default(0),
});

export type RecordInterestInput = z.input<typeof interestSchema>;

/**
 * Records what a client looked at on the members' site.
 *
 * No capability check, for the same reason as the lookup above: the caller is
 * the website, not a member of staff, and `/api/private-access/interest`
 * authenticates it by signature before calling this. Nothing else may call it.
 *
 * Refused for a client who is archived or inactive, so access ending ends the
 * record keeping with it. Only the Curator click reaches the timeline: a client
 * reading four journeys on a Sunday would otherwise bury the interactions staff
 * actually write.
 *
 * Also refused for a `staff` record. They pass the gate so the site can be
 * checked, but nothing they do is interest, and writing it would put testing
 * into the same table the desk reads for demand. Keeping it out here rather
 * than filtering it later means the table only ever holds the real thing.
 */
export async function recordPrivateAccessInterest(
  input: RecordInterestInput,
): Promise<boolean> {
  const parsed = interestSchema.safeParse(input);
  if (!parsed.success) return false;
  const data = parsed.data;

  const guest = await repo.findPrivateAccessGuestById(data.customerId);
  if (!guest) {
    logger.info("private_access.interest", { outcome: "not_found" });
    return false;
  }

  if (!countsAsClient(guest.status)) {
    logger.info("private_access.interest", { outcome: "tester" });
    return false;
  }

  await db.transaction(async (tx) => {
    await tx.insert(clientInterests).values({
      customerId: data.customerId,
      destination: data.destination,
      title: data.title,
      kind: data.kind,
      seconds: data.seconds,
    });

    if (data.kind === "cta_clicked") {
      await tx.insert(activityLog).values({
        entityType: "customer",
        entityId: data.customerId,
        customerId: data.customerId,
        action: "interaction_logged",
        summary: `Asked the Curator about ${data.title} on vara5.com`,
        // Nobody signed in as staff did this, so the trail records no actor.
        actorId: null,
      });
    }
  });

  logger.info("private_access.interest", {
    outcome: "recorded",
    customerId: data.customerId,
    kind: data.kind,
  });
  return true;
}

/** What a client has been reading on the members' site, for the Interest panel. */
export async function getClientInterest(customerId: string) {
  await requireCapability("client.read");
  return repo.summariseInterest(customerId);
}

/**
 * Links to the recordings of a client's visits, for the curator who wants to
 * watch rather than read a summary. Empty whenever PostHog is unconfigured or
 * unreachable, which the panel shows as simply having nothing to offer.
 */
export async function getClientReplays(customerId: string) {
  await requireCapability("client.read");
  if (!posthogIsConfigured()) return [];
  return sessionReplays(customerId);
}

/**
 * Opens one recording in PostHog's own player, inside the client's page.
 *
 * Staff still never need a PostHog login, and still never receive the API key.
 * What they do receive is a share token, which is a public URL for as long as
 * it exists — so it is minted here, at the moment somebody presses play, and
 * `closeClientReplay` takes it back. `shareRecording` refuses a session that
 * belongs to a different client, so a copied id mints nothing.
 */
export async function openClientReplay(customerId: string, sessionId: string) {
  await requireCapability("client.read");
  if (!posthogIsConfigured()) return null;
  return shareRecording(customerId, sessionId);
}

/**
 * Closes it again, which is what makes the link above acceptable.
 *
 * Deliberately not tied to the client: whoever can read a client can revoke a
 * link, and a revoke that fails closed would leave a public URL standing.
 */
export async function closeClientReplay(sessionId: string) {
  await requireCapability("client.read");
  if (!posthogIsConfigured()) return;
  await revokeRecordingShare(sessionId);
}

/**
 * The lighter signals: cards turned over, sections reached, buttons pressed.
 *
 * Read live from PostHog rather than stored, because none of it is worth a
 * column and all of it is worth seeing. Empty whenever PostHog is off, which
 * the panel renders as simply having less to say.
 */
export async function getClientSignals(customerId: string) {
  await requireCapability("client.read");
  if (!posthogIsConfigured()) return null;
  return clientSignals(customerId);
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createCustomer(input: CreateCustomerInput) {
  const actor = await requireCapability("client.create");
  const data = createCustomerSchema.parse(input);

  await assertPhoneIsFree(data.mobile, data.whatsapp);
  await assertHouseholdExists(data.householdId);

  const customer = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(customers)
      .values({
        ...data,
        profileUpdatedAt: new Date(),
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning();

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: created.id,
        action: "created",
        customerId: created.id,
        householdId: created.householdId,
        summary: `Client ${created.ref} created`,
      },
      tx,
    );

    return created;
  });

  return customer;
}

export async function updateCustomer(input: UpdateCustomerInput) {
  const actor = await requireCapability("client.update");
  const data = updateCustomerSchema.parse(input);
  const { id, ...parsed } = data;
  // Only what the caller sent: an edit form that omits a field must not blank it.
  const patch = onlyProvided(input as Record<string, unknown>, parsed);

  const existing = await repo.findCustomerById(id);
  if (!existing) throw new DomainError("Client not found");

  if (patch.primaryRmId !== undefined && patch.primaryRmId !== existing.primaryRmId) {
    await requireCapability("client.reassign_rm");
  }

  await assertPhoneIsFree(patch.mobile, patch.whatsapp, id);
  if (patch.householdId !== undefined)
    await assertHouseholdExists(patch.householdId);

  const changes = diffFields(existing, patch);
  if (Object.keys(changes).length === 0) return existing;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(customers)
      .set({
        ...patch,
        updatedAt: new Date(),
        updatedBy: actor.id,
        profileUpdatedAt: new Date(),
      })
      .where(eq(customers.id, id))
      .returning();

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: id,
        action: "updated",
        customerId: id,
        householdId: updated.householdId,
        summary: summariseChanges(changes),
        changes,
      },
      tx,
    );

    return updated;
  });
}

/** Free-text Client DNA plus the DO and DON'T lists, saved as one edit. */
export async function updateClientDna(input: ClientDnaInput) {
  const actor = await requireCapability("client.update");
  const data = clientDnaSchema.parse(input);

  const existing = await repo.findCustomerById(data.customerId);
  if (!existing) throw new DomainError("Client not found");

  return db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({
        clientDna: data.clientDna,
        // The editor re-sends both lists whole, so they are written whole and
        // the position in the array is the running order on screen.
        dos: data.dos,
        donts: data.donts,
        updatedAt: new Date(),
        updatedBy: actor.id,
        profileUpdatedAt: new Date(),
      })
      .where(eq(customers.id, data.customerId));

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: data.customerId,
        action: "updated",
        customerId: data.customerId,
        householdId: existing.householdId,
        summary: "Client DNA updated",
      },
      tx,
    );
  });
}

export async function archiveCustomer(customerId: string) {
  const actor = await requireCapability("client.archive");

  const existing = await repo.findCustomerById(customerId);
  if (!existing) throw new DomainError("Client not found");
  if (existing.archivedAt) return existing;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(customers)
      .set({
        archivedAt: new Date(),
        status: "inactive",
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(customers.id, customerId))
      .returning();

    // A household must never point at an archived primary client.
    if (existing.householdId) {
      await tx
        .update(households)
        .set({ primaryCustomerId: null })
        .where(
          and(
            eq(households.id, existing.householdId),
            eq(households.primaryCustomerId, customerId),
          ),
        );
    }

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: customerId,
        action: "archived",
        customerId,
        householdId: existing.householdId,
        summary: `Client ${existing.ref} archived`,
      },
      tx,
    );

    return updated;
  });
}

/**
 * Permanently destroys a client. There is no undo.
 *
 * Two deliberate constraints, both modelled on how Twenty treats its trash:
 * the record must already be archived, so erasure is always a second,
 * considered step rather than a mis-click; and the audit entry is written
 * before the delete, so the fact that an erasure happened outlives the data it
 * erased. The audit row's client reference is cleared by the foreign key as the
 * row goes, which is exactly what migration 0003 was for.
 */
export async function eraseCustomer(customerId: string, reason: string) {
  const actor = await requireCapability("client.destroy");

  const justification = reason.trim();
  if (justification.length < 10) {
    throw new DomainError(
      "Record why this client is being erased. It is the only trace that will remain.",
    );
  }

  const existing = await repo.findCustomerById(customerId);
  if (!existing) throw new DomainError("Client not found");
  if (!existing.archivedAt) {
    throw new DomainError(
      "Archive the client first. Erasure is deliberate, not a shortcut for archiving.",
    );
  }

  await db.transaction(async (tx) => {
    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: customerId,
        action: "archived",
        customerId,
        householdId: existing.householdId,
        summary: `Client ${existing.ref} permanently erased. Reason: ${justification}`,
      },
      tx,
    );

    await tx.delete(customers).where(eq(customers.id, customerId));
  });

  return { ref: existing.ref };
}

export async function restoreCustomer(customerId: string) {
  const actor = await requireCapability("client.archive");

  const existing = await repo.findCustomerById(customerId);
  if (!existing) throw new DomainError("Client not found");
  if (!existing.archivedAt) return existing;

  await assertPhoneIsFree(existing.mobile, existing.whatsapp, customerId);

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(customers)
      .set({
        archivedAt: null,
        status: "active",
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(customers.id, customerId))
      .returning();

    await logActivity(
      {
        actor,
        entityType: "customer",
        entityId: customerId,
        action: "restored",
        customerId,
        householdId: existing.householdId,
        summary: `Client ${existing.ref} restored`,
      },
      tx,
    );

    return updated;
  });
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

async function assertPhoneIsFree(
  mobile?: string | null,
  whatsapp?: string | null,
  excludeId?: string,
) {
  for (const [field, value] of [
    ["mobile", mobile],
    ["whatsapp", whatsapp],
  ] as const) {
    if (!value) continue;
    const clashes = await repo.findActiveByPhone(value, excludeId);
    if (clashes.length > 0) {
      const clash = clashes[0];
      throw new DomainError(
        `That number already belongs to ${fullName(clash)} (${clash.ref}).`,
        { [field]: [`Already used by ${clash.ref}`] },
      );
    }
  }
}

async function assertHouseholdExists(householdId: string | null | undefined) {
  if (!householdId) return;
  const household = await db.query.households.findFirst({
    where: eq(households.id, householdId),
  });
  if (!household) throw new DomainError("That household no longer exists");
}

function summariseChanges(changes: Record<string, unknown>): string {
  const fields = Object.keys(changes);
  if (fields.length === 1) return `Updated ${labelFor(fields[0])}`;
  if (fields.length <= 3)
    return `Updated ${fields.map(labelFor).join(", ")}`;
  return `Updated ${fields.length} fields`;
}

/**
 * What a changed field is called on the audit trail.
 *
 * Splitting the property name apart is a fair guess for most of them and a poor
 * one for the rest: `primaryRmId` came out as "primary Rm Id", which reads like
 * a database column because it is one. The trail is read by people, so the
 * fields whose names do not survive the translation are spelled out.
 */
const FIELD_LABELS: Record<string, string> = {
  primaryRmId: "relationship manager",
  householdId: "household",
  householdRole: "role in the household",
  clientDna: "client DNA",
  eaName: "assistant's name",
  eaEmail: "assistant's email",
  eaPhone: "assistant's phone",
  eaNotes: "assistant's notes",
  dateOfBirth: "date of birth",
  customerSince: "client since",
  locationUrl: "location pin",
  whatsapp: "WhatsApp number",
  mobile: "mobile number",
  preferredName: "preferred name",
};

function labelFor(field: string): string {
  return (
    FIELD_LABELS[field] ??
    field
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toLowerCase())
      .trim()
  );
}


/**
 * The last visits to the members' site, whoever made them.
 *
 * PostHog knows which recordings exist and who they belong to; it does not know
 * what to call anybody, and its idea of a name is a first name typed into an
 * analytics property. So the ids come from there and the names come from here,
 * which is the record of who a client actually is.
 *
 * A visit whose client is no longer in the book is dropped rather than shown as
 * an orphan. Empty whenever PostHog is unconfigured, like every other screen
 * that reads from it.
 */
export async function getRecentVisits(limit = 12, includeTesters = false) {
  await requireCapability("client.read");
  if (!posthogIsConfigured()) return [];

  const skip = includeTesters
    ? []
    : (await repo.testers()).map((tester) => tester.id);

  const visits = await recentVisits(limit, skip);
  if (visits.length === 0) return [];

  const clients = await repo.customersByIds([
    ...new Set(visits.map((visit) => visit.customerId)),
  ]);
  const byId = new Map(clients.map((client) => [client.id, client]));

  return visits.flatMap((visit) => {
    const client = byId.get(visit.customerId);
    if (!client) return [];

    return [
      {
        ...visit,
        name: displayName(client),
        ref: client.ref,
        archived: client.archivedAt !== null,
      },
    ];
  });
}

/**
 * Everything one client has done on the members' site, fetched on demand.
 *
 * The recent-visits list shows a name and a time; opening one asks for the rest
 * rather than loading every client's history to draw a list of twelve rows.
 */
export async function getClientActivity(customerId: string) {
  await requireCapability("client.read");

  const [interest, replays, signals] = await Promise.all([
    getClientInterest(customerId),
    getClientReplays(customerId),
    getClientSignals(customerId),
  ]);

  return { interest, replays, signals };
}


const reassignSchema = z.object({
  customerIds: z.array(uuidSchema).min(1).max(100),
  /** Null hands the clients back to nobody, which is a real answer. */
  primaryRmId: uuidSchema.nullable(),
});

export type ReassignInput = z.input<typeof reassignSchema>;

/**
 * Moves several clients to one relationship manager at once.
 *
 * The same capability as changing one, because it is the same act repeated: a
 * bulk path that asked for less would be the way round the check. One
 * transaction, so a failure halfway leaves nobody half-moved, and one audit row
 * per client rather than a single line about a batch — the trail is read one
 * client at a time, and "reassigned in a group of twelve" answers nothing on
 * the record of the client somebody is actually looking at.
 *
 * Clients already with that manager are skipped rather than rewritten, so the
 * trail records what changed instead of what was selected.
 */
export async function reassignClients(input: ReassignInput) {
  const actor = await requireCapability("client.reassign_rm");
  const data = reassignSchema.parse(input);

  if (data.primaryRmId) {
    const manager = await db.query.users.findFirst({
      where: eq(users.id, data.primaryRmId),
    });
    if (!manager) throw new DomainError("That colleague no longer has an account");
  }

  const targets = await db
    .select({
      id: customers.id,
      ref: customers.ref,
      primaryRmId: customers.primaryRmId,
    })
    .from(customers)
    .where(inArray(customers.id, data.customerIds));

  const moving = targets.filter((row) => row.primaryRmId !== data.primaryRmId);
  if (moving.length === 0) return { moved: 0 };

  const to = data.primaryRmId
    ? ((await db.query.users.findFirst({ where: eq(users.id, data.primaryRmId) }))?.name ??
      "another colleague")
    : "nobody";

  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({
        primaryRmId: data.primaryRmId,
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(inArray(customers.id, moving.map((row) => row.id)));

    for (const row of moving) {
      await logActivity(
        {
          entityType: "customer",
          entityId: row.id,
          customerId: row.id,
          action: "updated",
          summary: `Relationship manager changed to ${to}`,
          changes: {
            primaryRmId: { from: row.primaryRmId, to: data.primaryRmId },
          },
          actor,
        },
        tx,
      );
    }
  });

  logger.info("client.reassigned", { count: moving.length });
  return { moved: moving.length };
}
