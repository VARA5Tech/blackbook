import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { customerPreferences, customers, trips } from "@/db/schema";
import type { StoredTravelDocument } from "@/domain/trips";
import { ternBridge } from "@/lib/tern";
import {
  applyTernImport,
  populateClientFromTern,
  populateTripFromTern,
  previewTernClient,
  searchTern,
  tripsForClient,
} from "@/services/tern-service";
import { actingAs, resetData, seedCatalogue, seedStaff, type StaffFixtures } from "./helpers";

/**
 * The whole chain, against live Tern: this service, a signed request, the
 * bridge, a signed-in Chrome, Tern, and back into the test database.
 *
 * Opt-in, because it reads a real Tern account: it runs only with
 * `TERN_E2E=1` and the bridge variables set, and writes only to the throwaway
 * test database. It reads, never writes, on Tern's side. The query is a
 * surname known to have a client with several trips; set `TERN_E2E_QUERY` to
 * use another.
 */
const live = Boolean(process.env.TERN_E2E && process.env.TERN_BRIDGE_URL && process.env.TERN_BRIDGE_SECRET);

describe.skipIf(!live)("Tern, end to end", () => {
  let staff: StaffFixtures;
  const query = process.env.TERN_E2E_QUERY ?? "Goyal";

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
    await resetData();
    actingAs(staff.admin);
  });

  it("finds the bridge signed in", async () => {
    const health = await ternBridge.health();
    expect(health).toMatchObject({ ok: true, data: { signedIn: true } });
  });

  /**
   * The path the screen takes: preview, choose, import. The preview must show
   * every trip with a name, carry no passport number, and write nothing.
   */
  it("previews before importing, and imports only what was chosen", { timeout: 600_000 }, async () => {
    await resetData();
    const found = await searchTern(query);
    if (!found.ok) throw new Error(found.message);
    const pick = found.hits.find((h) => h.email) ?? found.hits[0];

    // The avatar's initials no longer run into the first name.
    expect(pick.firstName).not.toMatch(/^[A-Z]{2}[A-Z][a-z]/);

    const plan = await previewTernClient({ ternId: pick.ternId });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.trips.length).toBeGreaterThan(0);
    expect(plan.trips.every((t) => t.title && !t.title.startsWith("Trip "))).toBe(true);
    expect(plan.trips.filter((t) => t.status).length).toBe(plan.trips.length);
    expect(await db.select().from(customers)).toHaveLength(0);

    // Take only two trips and no preferences, to prove the choice is honoured.
    const chosen = plan.trips.slice(0, 2).map((t) => t.ternId);
    const done = await applyTernImport({
      ternId: pick.ternId,
      target: { mode: "new" },
      fields: Object.fromEntries(plan.fields.map((f) => [f.field, "take"])),
      preferences: [],
      milestones: [],
      travelDocuments: plan.travelDocuments.items.map((d) => d.key),
    });
    for (const id of chosen) await populateTripFromTern({ ternId: id, customerId: done.customerId });

    expect(await tripsForClient(done.customerId)).toHaveLength(chosen.length);
    const prefs = await db.select().from(customerPreferences).where(eq(customerPreferences.customerId, done.customerId));
    expect(prefs).toHaveLength(0);
  });

  it("populates a client and every one of their trips", { timeout: 600_000 }, async () => {
    await resetData();
    const found = await searchTern(query);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.hits.length).toBeGreaterThan(0);

    // The contact with an email is the client; companions rarely carry one.
    const pick = found.hits.find((h) => h.email) ?? found.hits[0];
    const client = await populateClientFromTern({ ternId: pick.ternId, createNew: true });
    expect(client.status).toBe("done");
    if (client.status !== "done") return;

    let brought = 0;
    for (const tripId of client.tripIds) {
      const trip = await populateTripFromTern({ ternId: tripId, customerId: client.customerId });
      if (trip.ok) brought++;
    }
    expect(brought).toBe(client.tripIds.length);

    const row = await db.query.customers.findFirst({ where: eq(customers.id, client.customerId) });
    expect(row?.ternId).toBe(pick.ternId);
    expect(row?.ternRaw).toBeTruthy();

    // Whatever Tern held for passports is sealed: no readable number anywhere.
    for (const doc of (row?.travelDocuments ?? []) as StoredTravelDocument[]) {
      expect(doc.sealed.startsWith("v1.")).toBe(true);
      expect(JSON.stringify(row)).not.toContain(`"number"`);
    }
    expect(JSON.stringify(row?.ternRaw)).not.toContain("passport_number");

    const history = await tripsForClient(client.customerId);
    expect(history.length).toBe(client.tripIds.length);

    // The shape of what arrived, for the person running this to read.
    const all = await db.select().from(trips).where(eq(trips.customerId, client.customerId));
    const summary = {
      trips: all.length,
      withDates: all.filter((t) => t.startsOn).length,
      statuses: Object.fromEntries(
        [...new Set(all.map((t) => t.status))].map((s) => [s, all.filter((t) => t.status === s).length]),
      ),
      itineraryItems: all.reduce((n, t) => n + (t.itinerary as { items: unknown[] }[]).reduce((m, d) => m + d.items.length, 0), 0),
      flagged: all.filter((t) => t.flags.length).length,
      travellersLinked: all.reduce((n, t) => n + (t.travelers as { customerId: string | null }[]).filter((x) => x.customerId).length, 0),
      phonesToConfirm: client.phonesToConfirm.length,
      travelDocuments: client.travelDocuments,
      preferences: client.preferences,
    };
    console.info("TERN_E2E", JSON.stringify(summary));
    expect(summary.withDates).toBeGreaterThan(0);

    // Running it again changes nothing that should not change: no second copy.
    const again = await populateClientFromTern({ ternId: pick.ternId });
    expect(again).toMatchObject({ status: "done", customerId: client.customerId, created: false });
    for (const tripId of client.tripIds) await populateTripFromTern({ ternId: tripId, customerId: client.customerId });
    const after = await db.select().from(trips).where(eq(trips.customerId, client.customerId));
    expect(after.length).toBe(all.length);
  });
});
