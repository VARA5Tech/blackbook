import { randomUUID } from "node:crypto";
import { sql as raw } from "drizzle-orm";
import { db, sql } from "@/db";
import { CATALOGUE } from "@/db/catalogue";
import { preferenceOptions, users } from "@/db/schema";
import type { UserRole } from "@/db/schema";
import { actingAs, getCurrentTestActor, type TestActor } from "./setup";

export { actingAs, getCurrentTestActor };

/**
 * Wipes every table except the preference catalogue and staff accounts, which
 * are seeded once and treated as fixtures.
 */
export async function resetData(): Promise<void> {
  await sql.unsafe(`
    truncate table
      activity_log,
      client_directive,
      customer_preference,
      customer_preference_profile,
      interaction,
      milestone,
      task,
      customer,
      household
    restart identity cascade
  `);
  // Reference IDs restart too, so assertions on CUST-00100 stay stable.
  await sql.unsafe(`alter sequence customer_ref_seq restart with 100`);
  await sql.unsafe(`alter sequence household_ref_seq restart with 100`);
}

export async function seedCatalogue(): Promise<void> {
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
      set: { label: raw`excluded.label` },
    });
}

export type StaffFixtures = Record<UserRole, TestActor>;

/** One account per role, so the permission matrix can be driven off them. */
export async function seedStaff(): Promise<StaffFixtures> {
  const roles: UserRole[] = ["admin", "manager", "rm", "viewer"];
  const fixtures = {} as StaffFixtures;

  for (const role of roles) {
    const email = `${role}@test.vara5.com`;
    const existing = await db.query.users.findFirst({
      where: raw`${users.email} = ${email}`,
    });

    if (existing) {
      fixtures[role] = {
        id: existing.id,
        name: existing.name,
        email: existing.email,
        role,
      };
      continue;
    }

    const id = randomUUID();
    await db.insert(users).values({
      id,
      name: `${role} user`,
      email,
      emailVerified: true,
      role,
    });
    fixtures[role] = { id, name: `${role} user`, email, role };
  }

  return fixtures;
}

/** Resolves a catalogue option id by facet and slug. */
export async function optionId(kind: string, slug: string): Promise<string> {
  const row = await db.query.preferenceOptions.findFirst({
    where: raw`${preferenceOptions.kind} = ${kind} and ${preferenceOptions.slug} = ${slug}`,
  });
  if (!row) throw new Error(`Catalogue option not found: ${kind}/${slug}`);
  return row.id;
}

/** The same month and day as `days` from now, but in a past year. */
export function birthdayDaysFromNow(days: number, yearsAgo = 30): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setFullYear(date.getFullYear() - yearsAgo);
  return date.toISOString().slice(0, 10);
}

