/**
 * Development seed.
 *
 * Idempotent: safe to run repeatedly. Creates the preference catalogue, the
 * bootstrap staff accounts, and one demo household so the Client 360 screen has
 * something real to render.
 *
 *   pnpm db:seed
 */
import { uuidv7 } from "@/domain/shared";
import { eq, sql as raw } from "drizzle-orm";
import { auth } from "@/auth";
import { CATALOGUE } from "@/db/catalogue";
import { db, sql } from "@/db";
import {
  assertSafeToMutate,
  describeDatabase,
  resolveDevDatabaseUrl,
} from "@/db/url";
import {
  accounts,
  activityLog,
  clientDirectives,
  customerPreferenceProfile,
  customerPreferences,
  customers,
  households,
  interactions,
  milestones,
  preferenceOptions,
  users,
  type UserRole,
} from "@/db/schema";

const DEMO_PASSWORD = "vara5-demo-password";

async function seedCatalogue() {
  const rows = CATALOGUE.map((entry, index) => ({
    kind: entry.kind,
    slug: entry.slug,
    label: entry.label,
    grouping: entry.grouping ?? null,
    isCustom: false,
    sortOrder: index,
  }));

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

  console.log(`  catalogue: ${rows.length} options`);
}

async function seedUser(input: {
  name: string;
  email: string;
  role: UserRole;
}): Promise<string> {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });
  if (existing) return existing.id;

  const ctx = await auth.$context;
  const hash = await ctx.password.hash(DEMO_PASSWORD);
  const id = uuidv7();

  await db.insert(users).values({
    id,
    name: input.name,
    email: input.email,
    emailVerified: true,
    role: input.role,
  });

  await db.insert(accounts).values({
    id: uuidv7(),
    userId: id,
    accountId: id,
    providerId: "credential",
    password: hash,
  });

  console.log(`  user: ${input.email} (${input.role})`);
  return id;
}

/** Resolve catalogue options by slug so demo preferences read legibly below. */
async function optionMap() {
  const all = await db.select().from(preferenceOptions);
  const map = new Map<string, string>();
  for (const option of all) map.set(`${option.kind}:${option.slug}`, option.id);
  return map;
}

async function seedDemoHousehold(rmId: string, actorId: string) {
  const existing = await db.query.households.findFirst({
    where: eq(households.name, "Sharma Family"),
  });
  if (existing) {
    console.log("  demo household already present, skipping");
    return;
  }

  const options = await optionMap();
  const opt = (kind: string, slug: string) => {
    const id = options.get(`${kind}:${slug}`);
    if (!id) throw new Error(`Missing catalogue option ${kind}:${slug}`);
    return id;
  };

  const [household] = await db
    .insert(households)
    .values({
      name: "Sharma Family",
      city: "Delhi",
      travelPattern: "family",
      notes:
        "Travel as a couple for anniversaries, as a full family over school holidays.",
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();

  const [rishabh, neha, aarav] = await db
    .insert(customers)
    .values([
      {
        householdId: household.id,
        householdRole: "primary" as const,
        firstName: "Rishabh",
        lastName: "Sharma",
        preferredName: "Rishabh",
        mobile: "+91 98100 11223",
        whatsapp: "+91 98100 11223",
        email: "rishabh.sharma@example.com",
        dateOfBirth: "1982-04-18",
        gender: "male" as const,
        nationality: "IN",
        city: "Delhi",
        address: "12 Amrita Shergill Marg, New Delhi",
        primaryRmId: rmId,
        customerSince: "2021-03-01",
        clientDna:
          "Appreciates intimate properties and highly personalised service. Anniversary trips should feel private rather than commercial. Responds best to WhatsApp, rarely picks up unknown numbers.",
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        householdId: household.id,
        householdRole: "spouse" as const,
        firstName: "Neha",
        lastName: "Sharma",
        mobile: "+91 98100 44556",
        email: "neha.sharma@example.com",
        dateOfBirth: "1985-09-27",
        gender: "female" as const,
        nationality: "IN",
        city: "Delhi",
        primaryRmId: rmId,
        customerSince: "2021-03-01",
        clientDna: "Leads the planning for family trips. Keen on wellness and art.",
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        householdId: household.id,
        householdRole: "child" as const,
        firstName: "Aarav",
        lastName: "Sharma",
        dateOfBirth: "2013-11-05",
        gender: "male" as const,
        nationality: "IN",
        city: "Delhi",
        primaryRmId: rmId,
        customerSince: "2021-03-01",
        createdBy: actorId,
        updatedBy: actorId,
      },
    ])
    .returning();

  await db
    .update(households)
    .set({ primaryCustomerId: rishabh.id })
    .where(eq(households.id, household.id));

  await db.insert(customerPreferenceProfile).values({
    customerId: rishabh.id,
    travelTypicalTripNights: 7,
    travelParty: "couple",
    travelFrequency: "three_to_four_per_year",
    travelBudgetRange: "25l_50l",
    travelBookingLeadTime: "three_to_six_months",
    travelNotes: "Prefers to lock dates early, flexible on destination.",
    hotelNotes: "Always a suite for stays longer than four nights.",
    flightCabin: "business",
    flightDirectPreference: "always_direct",
    flightNotes: "Will pay a premium to avoid connections.",
    diningDietary: "no_restriction",
    diningFineDining: "essential",
    diningNotes: "Books omakase wherever available.",
    lifestyleExperienceStyle: "private_bespoke",
    updatedBy: actorId,
  });

  await db.insert(customerPreferences).values([
    { customerId: rishabh.id, optionId: opt("destination", "japan"), polarity: "prefer" as const, rank: 0 },
    { customerId: rishabh.id, optionId: opt("destination", "maldives"), polarity: "prefer" as const, rank: 1 },
    { customerId: rishabh.id, optionId: opt("destination", "italy"), polarity: "wishlist" as const },
    { customerId: rishabh.id, optionId: opt("destination", "united_arab_emirates"), polarity: "avoid" as const, note: "Been too often for work." },
    { customerId: rishabh.id, optionId: opt("travel_style", "luxury"), polarity: "prefer" as const },
    { customerId: rishabh.id, optionId: opt("travel_style", "gastronomy"), polarity: "prefer" as const },
    { customerId: rishabh.id, optionId: opt("travel_style", "romantic"), polarity: "prefer" as const },
    { customerId: rishabh.id, optionId: opt("travel_season", "cherry_blossom"), polarity: "prefer" as const },
    { customerId: rishabh.id, optionId: opt("hotel_brand", "aman"), polarity: "prefer" as const, note: "First choice wherever they operate." },
    { customerId: rishabh.id, optionId: opt("hotel_brand", "belmond"), polarity: "prefer" as const },
    { customerId: rishabh.id, optionId: opt("room_type", "suite"), polarity: "prefer" as const },
    { customerId: rishabh.id, optionId: opt("view_preference", "quiet_side"), polarity: "prefer" as const },
    { customerId: rishabh.id, optionId: opt("airline", "singapore_airlines"), polarity: "prefer" as const },
    { customerId: rishabh.id, optionId: opt("loyalty_programme", "singapore_krisflyer"), polarity: "prefer" as const, note: "PPS Club" },
    { customerId: rishabh.id, optionId: opt("seat_preference", "aisle_seat"), polarity: "prefer" as const, note: "Long-haul especially." },
    { customerId: rishabh.id, optionId: opt("flight_timing", "early_morning"), polarity: "avoid" as const },
    { customerId: rishabh.id, optionId: opt("cuisine", "japanese"), polarity: "prefer" as const },
    { customerId: rishabh.id, optionId: opt("beverage_preference", "single_malt_whisky"), polarity: "prefer" as const },
    { customerId: rishabh.id, optionId: opt("interest", "art"), polarity: "prefer" as const },
    { customerId: rishabh.id, optionId: opt("activity", "private_guided_tours"), polarity: "prefer" as const },
    { customerId: neha.id, optionId: opt("travel_style", "wellness"), polarity: "prefer" as const },
    { customerId: neha.id, optionId: opt("travel_style", "art_and_design"), polarity: "prefer" as const },
    { customerId: neha.id, optionId: opt("allergy", "shellfish"), polarity: "avoid" as const, note: "Severe. Must be flagged to every property." },
    { customerId: aarav.id, optionId: opt("activity", "scuba_diving"), polarity: "wishlist" as const },
  ]);

  await db.insert(clientDirectives).values([
    { customerId: rishabh.id, kind: "do" as const, body: "Boutique properties under 60 keys", sortOrder: 0 },
    { customerId: rishabh.id, kind: "do" as const, body: "Direct flights only on long-haul", sortOrder: 1 },
    { customerId: rishabh.id, kind: "do" as const, body: "Confirm everything on WhatsApp", sortOrder: 2 },
    { customerId: rishabh.id, kind: "dont" as const, body: "Large resorts or convention hotels", sortOrder: 0 },
    { customerId: rishabh.id, kind: "dont" as const, body: "Departures before 9am", sortOrder: 1 },
    { customerId: rishabh.id, kind: "dont" as const, body: "Group tours or shared transfers", sortOrder: 2 },
  ]);

  await db.insert(milestones).values([
    { customerId: rishabh.id, type: "birthday" as const, title: "Rishabh's birthday", date: "1982-04-18", createdBy: actorId },
    { customerId: neha.id, type: "birthday" as const, title: "Neha's birthday", date: "1985-09-27", createdBy: actorId },
    { customerId: aarav.id, type: "birthday" as const, title: "Aarav's birthday", date: "2013-11-05", createdBy: actorId },
    {
      householdId: household.id,
      type: "wedding_anniversary" as const,
      title: "Rishabh and Neha wedding anniversary",
      date: "2010-10-11",
      celebrationStyle: "Private dinner, no public celebration or cake parade.",
      notes: "Intimate, never commercial.",
      createdBy: actorId,
    },
  ]);

  const [interaction] = await db
    .insert(interactions)
    .values({
      customerId: rishabh.id,
      type: "call" as const,
      occurredAt: new Date(Date.now() - 41 * 24 * 60 * 60 * 1000),
      summary: "Discussed Japan for cherry blossom season",
      details:
        "Thinking about late March, likely travelling as a couple. Reiterated dislike of early departures.",
      loggedBy: rmId,
    })
    .returning();

  await db
    .update(customers)
    .set({
      lastInteractionAt: interaction.occurredAt,
      profileUpdatedAt: new Date(),
    })
    .where(eq(customers.id, rishabh.id));

  await db.insert(activityLog).values([
    {
      entityType: "customer" as const,
      entityId: rishabh.id,
      action: "created" as const,
      customerId: rishabh.id,
      householdId: household.id,
      summary: "Client profile created",
      actorId,
    },
    {
      entityType: "interaction" as const,
      entityId: interaction.id,
      action: "interaction_logged" as const,
      customerId: rishabh.id,
      householdId: household.id,
      summary: "Call logged: discussed Japan for cherry blossom season",
      actorId: rmId,
    },
  ]);

  console.log("  demo household: Sharma Family (3 clients)");
}

async function main() {
  /**
   * Development fixtures only. These accounts share a published password, so
   * the seed refuses to run anywhere but a local database. Production is
   * bootstrapped by scripts/bootstrap-admin.ts instead.
   */
  const target = resolveDevDatabaseUrl();
  assertSafeToMutate(target, "seed demo data");

  console.log(`Seeding ${describeDatabase(target)}...`);

  await seedCatalogue();

  const adminId = await seedUser({
    name: "Vara5 Admin",
    email: "admin@vara5.com",
    role: "admin",
  });
  const rmId = await seedUser({
    name: "Priya Nair",
    email: "priya@vara5.com",
    role: "rm",
  });
  await seedUser({
    name: "Ops Viewer",
    email: "viewer@vara5.com",
    role: "viewer",
  });

  await seedDemoHousehold(rmId, adminId);

  console.log(`\nDone. Sign in with any seeded email, password: ${DEMO_PASSWORD}`);
}

main()
  .then(() => sql.end())
  .catch(async (error) => {
    console.error(error);
    await sql.end();
    process.exit(1);
  });
