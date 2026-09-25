/**
 * Refreshes the loyalty programme catalogue from the reference list.
 *
 *   pnpm loyalty:import                  reports and writes
 *   pnpm loyalty:import --dry-run        reports only
 *   pnpm loyalty:import --reclassify     re-groups what is already stored
 *
 * A loyalty programme is a membership, not a taste: these rows carry a client's
 * membership number and tier on `customer_preference`, so the tiers a
 * programme actually offers belong on the option beside it.
 *
 * The programmes the desk curated keep their own label and slug and only gain
 * the tier list. Nothing is ever deleted: a programme somebody has already
 * recorded a membership against must not vanish underneath them.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, sql } from "@/db/index";
import { preferenceOptions } from "@/db/schema/preferences";

type Programme = { id: number; name: string; levels: { id: number; name: string }[] };

const source = JSON.parse(
  readFileSync(new URL("../src/db/loyalty-programmes.json", import.meta.url), "utf8"),
) as { programs: Programme[] };

/** Ignores punctuation, case and the parenthesised programme name. */
function normalise(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const slugify = (name: string) => normalise(name).replace(/\s+/g, "_").slice(0, 60);

/*
 * What sort of thing the programme is, so the Hotels section can show hotel
 * memberships and the Flights section airline ones.
 *
 * Brand names are tried before the generic words, because the generic words do
 * not separate them: Radisson Rewards and Rapid Rewards share "rewards", and
 * half the airlines say "miles" while half the hotels say "club". Anything
 * still unplaced is left ungrouped rather than filed somewhere plausible and
 * wrong, and the editor shows those under Other.
 */
const BRANDS: [string, RegExp][] = [
  [
    "Airline",
    /(delta|united|american airlines|jetblue|southwest|alaska|frontier|spirit|hawaiian|iberia|finnair|avios|aeroplan|lufthansa|swiss|austrian|brussels|eurowings|klm|ana mileage|qantas|virgin|westjet|porter|indigo|vistara|garuda|srilankan|icelandair|easyjet|ryanair|jet2|flybe|flynas|tunisair|belavia|nordavia|utair|latam|avianca|azul|copa|aeromexico|aerolineas|lingus|airberlin|atlasglobal|atmos|cebu|tuifly|compagnie|monarch|saga club|mileageplus|skymiles|trueblue|rapid rewards|aeroloft|star alliance|velocity|sun country|skybonus|bluebiz|perksplus|emirates|etihad|qatar|turkish|egypt|ethiopian|kenya|asiana|korean|cathay|singapore|krisflyer|malaysia|vietnam|philippine)/,
  ],
  [
    "Hotel",
    /(marriott|hilton|hyatt|accor|ihg|wyndham|choice|radisson|sheraton|westin|sonesta|omni|kimpton|fairmont|peninsula|mandarin|dorchester|belmond|jumeirah|shangri|banyan|oberoi|taj|leela|melia|pestana|paradores|montcalm|swissotel|millennium|copthorne|otani|rydges|sandals|dorint|americinn|quinta|frasers|jin jiang|tsogo|relais|chateaux|trump|yelloh|hostelworld|hotelclub|hotelbooker|tablethotels|gha discovery|golden circle|leaders club|red lion|silver cloud|future inns|club med|four seasons|dan hotels|elite hotels|coast|cosmopolitan|borgata|caesar|invited|repeat guest|sirius|bellini|select guest|priority guest|preferred)/,
  ],
  [
    "Cruise",
    /(cruise|cunard|celebrity|carnival|azamara|waterways|yacht|voyages|voyager|silversea|seabourn|ponant|scenic|riverside|lindblad|hurtigruten|holland america|royal caribbean|norwegian|princess|viking|crystal|emerald|explora|windstar|moby|stena|peninsular|expeditions|castaway|atlas)/,
  ],
  [
    "Car hire",
    /(hertz|avis|alamo|enterprise|sixt|europcar|budget fastbreak|thrifty|rent a car|rental|emerald club|parker|park-n-go)/,
  ],
  ["Rail", /(rail|bahn|amtrak|eurostar|sncf|thalys|trenitalia|voyageur)/],
  [
    "Tour operator",
    /(tours|trafalgar|contiki|cosmos|collette|insight|brendan|keystone|gate 1|luxury gold|national geographic|vacations|adventures)/,
  ],
  ["Booking", /(booking\.com|expedia|tripadvisor|hostel|aarp|allways)/],
];

function grouping(name: string): string | null {
  const text = name.toLowerCase();
  for (const [label, pattern] of BRANDS) if (pattern.test(text)) return label;
  // Generic fallbacks, reached only when no brand matched.
  // "Air India" and "Air Astana" carry no other clue, and there is no hotel
  // whose name is the word "air" on its own.
  if (/(^air |\bair\b|airline|airways|fly|flying|miles|aero|jet)/.test(text)) return "Airline";
  if (/(hotel|inn|resort|suites|guest|western)/.test(text)) return "Hotel";
  if (/(rent-a-car|otel\.com)/.test(text)) return "Car hire";
  return null;
}

/* Words every programme uses, which say nothing about which one it is. */
const NOISE = new Set([
  "club", "rewards", "reward", "miles", "programme", "program", "loyalty",
  "airlines", "airline", "airways", "air", "hotels", "hotel", "group", "the",
  "and", "plus", "card", "member", "membership", "guest", "flyer", "bonus",
]);

const tokensOf = (name: string) =>
  new Set(normalise(name).split(" ").filter((w) => w.length > 2 && !NOISE.has(w)));

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared === 0 ? 0 : shared / Math.max(a.size, b.size);
}

const dryRun = process.argv.includes("--dry-run");
const reclassify = process.argv.includes("--reclassify");

const url = process.env.DEV_DATABASE_URL;
if (!url || !/localhost|127\.0\.0\.1/.test(url)) {
  throw new Error("This writes the catalogue; point DEV_DATABASE_URL at a local database.");
}

const existing = await db
  .select()
  .from(preferenceOptions)
  .where(eq(preferenceOptions.kind, "loyalty_programme"));

const byName = new Map(existing.map((row) => [normalise(row.label), row]));
const bySlug = new Set(existing.map((row) => row.slug));
const held = existing.map((row) => ({ row, tokens: tokensOf(row.label) }));
const heldById = new Map(existing.map((row) => [row.id, row]));

/*
 * Each programme the desk holds is claimed by its closest match and by nothing
 * else. Several entries can look like one row — British Airways has both the
 * Executive Club and the corporate On Business scheme — and taking whichever
 * arrived first overwrote the desk's tiers with a corporate tier list.
 */
const claims = new Map<string, { programme: Programme; score: number }>();
for (const programme of source.programs) {
  const exact = byName.get(normalise(programme.name));
  let best = exact ? { id: exact.id, score: 1 } : null;

  if (!best) {
    const wanted = tokensOf(programme.name);
    for (const candidate of held) {
      const score = similarity(wanted, candidate.tokens);
      if (score > 0 && (!best || score > best.score)) best = { id: candidate.row.id, score };
    }
  }

  if (!best || best.score < 0.5) continue;
  const standing = claims.get(best.id);
  if (!standing || best.score > standing.score) {
    claims.set(best.id, { programme, score: best.score });
  }
}

const claimedBy = new Map<number, string>();
for (const [optionId, claim] of claims) claimedBy.set(claim.programme.id, optionId);

const additions: { slug: string; label: string; grouping: string | null; tiers: string[] }[] = [];
const updates: { id: string; label: string; tiers: string[] }[] = [];
let unchanged = 0;

for (const programme of source.programs) {
  const tiers = programme.levels
    .map((level) => level.name.trim())
    .filter((name) => name.length > 0 && name !== "-");

  const claimedId = claimedBy.get(programme.id);
  const found = claimedId ? heldById.get(claimedId) : undefined;
  if (found) {
    if (tiers.length > 0 && found.tiers.join("|") !== tiers.join("|")) {
      updates.push({ id: found.id, label: found.label, tiers });
    } else {
      unchanged += 1;
    }
    continue;
  }

  const slug = slugify(programme.name);
  if (bySlug.has(slug)) {
    unchanged += 1;
    continue;
  }
  bySlug.add(slug);
  additions.push({ slug, label: programme.name.trim(), grouping: grouping(programme.name), tiers });
}

/*
 * Re-grouping is opt-in. The grouping is a guess, and a curator who has moved
 * a programme by hand should not have it moved back on the next refresh.
 */
const regrouped = reclassify
  ? existing.flatMap((row) => {
      const wanted = grouping(row.label);
      return wanted && wanted !== row.grouping
        ? [{ id: row.id, label: row.label, grouping: wanted }]
        : [];
    })
  : [];

const unplaced = [...existing.map((row) => row.label), ...additions.map((row) => row.label)].filter(
  (label) => !grouping(label),
);

console.log(`source            ${source.programs.length} programmes`);
console.log(`already held      ${existing.length}`);
console.log(`tiers filled in   ${updates.length}`);
console.log(`to add            ${additions.length}`);
console.log(`left alone        ${unchanged}`);
if (reclassify) console.log(`re-grouped        ${regrouped.length}`);
console.log(`still ungrouped   ${unplaced.length}`);
if (unplaced.length > 0) {
  console.log(`  ${unplaced.slice(0, 24).join(", ")}`);
}

if (dryRun) {
  console.log("\nDry run: nothing written.");
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
}

await db.transaction(async (tx) => {
  for (const row of regrouped) {
    await tx
      .update(preferenceOptions)
      .set({ grouping: row.grouping })
      .where(eq(preferenceOptions.id, row.id));
  }

  for (const row of updates) {
    await tx
      .update(preferenceOptions)
      .set({ tiers: row.tiers })
      .where(eq(preferenceOptions.id, row.id));
  }

  if (additions.length > 0) {
    // Seeded, not staff-added: isCustom marks what somebody typed in, and a
    // catalogue arriving wholesale is not that.
    await tx.insert(preferenceOptions).values(
      additions.map((row, index) => ({
        kind: "loyalty_programme" as const,
        slug: row.slug,
        label: row.label,
        grouping: row.grouping,
        tiers: row.tiers,
        isCustom: false,
        sortOrder: 100 + index,
      })),
    );
  }
});

console.log(
  `\nWritten. ${regrouped.length} re-grouped, ${updates.length} updated, ${additions.length} added.`,
);
await sql.end({ timeout: 5 }).catch(() => {});
