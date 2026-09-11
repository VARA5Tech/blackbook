# Blackbook

Client 360 for Vara5 luxury travel. An internal system for storing, viewing and
managing client information so any team member can understand a client and their
household within seconds.

This is not a sales CRM. There are no leads, opportunities or pipelines. The
centre of the system is the client.

## Running it

Requires Node 20 or newer, pnpm, and Docker.

```bash
pnpm install
cp .env.example .env.local
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The seed creates the preference catalogue, three staff accounts and one demo
household. Sign in at http://localhost:3000 with `admin@vara5.com`,
`priya@vara5.com` or `viewer@vara5.com`. The seed prints the shared password.
Those accounts are development fixtures and the seed refuses to run against
anything but a local database.

To enable the AI briefing, add an `OPENROUTER_API_KEY` to `.env.local`. Without
one the Brief Me button explains that AI is not configured and everything else
works normally.

`AI_MODEL` takes any OpenRouter model slug and defaults to
`qwen/qwen3.7-flash`. One key reaches every model, so switching model is a
restart, not a new credential.

### Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm lint` | ESLint |
| `pnpm db:up` / `pnpm db:down` | Local Postgres container |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:check` | Preflight the development connection |
| `pnpm db:migrate` | Apply migrations to development |
| `pnpm db:studio` | Drizzle Studio against development |
| `pnpm db:seed` | Seed catalogue, staff and demo data. Local only |
| `pnpm db:check:prod` | Preflight the production connection |
| `pnpm db:migrate:prod` | Apply migrations to production |
| `pnpm db:bundle` | Write every migration to one SQL file |
| `pnpm test` | Run the test suite |
| `pnpm test:watch` | Run the tests in watch mode |

## Brand

Assets come from the supplied brand pack and live in `public/brand`, with the
icons and manifest at the public root. The palette in `src/app/globals.css` is
derived from the five production colours rather than invented: champagne
`#E8CFAB`, black `#090909`, ink `#151411`, ivory `#F7F4EE`, white `#FFFFFF`.

The guide's rule decides where each goes. Light interfaces are ink on ivory,
dark interfaces are champagne on black, and champagne is the only accent, kept
for upcoming milestones and primary actions. Components reference semantic
tokens, never a brand colour directly.

Lockups are chosen by size, as the guide instructs: the compact horizontal in
the navbar, the full lockup on the sign-in screen. Each ships drawn in ink and
in champagne, and where the mark follows the page theme both are rendered with
CSS picking between them, so it is correct on the first paint rather than after
hydration. There is no logo component: it is two `Image` tags where it appears,
which is less code than the abstraction was.

`--brand-surface` is a fixed black ground with the champagne mark, identical in
both themes, for places where the brand speaks rather than the interface. The
sign-in panel uses it. It exists because `--primary` inverts between themes, so
painting a fixed brand panel with it turned the panel champagne in dark mode
and hid the champagne logo completely.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript strict |
| Database | PostgreSQL 18 |
| Data access | Drizzle ORM with SQL migrations |
| Auth | Better Auth, email and password, no public sign-up |
| UI | Tailwind v4, shadcn/ui on Radix |
| Validation | Zod, shared between forms and services |
| AI | Vercel AI SDK over OpenRouter, model set by env var |

## Two databases, never confused

`DEV_DATABASE_URL` is local Postgres. `DATABASE_URL` is the live database.
Nothing falls back between them, because the production URL is allowed to sit
in a developer's `.env.local` so migrations can be applied from a laptop.

- `pnpm dev`, `pnpm test` and every `db:*` command use `DEV_DATABASE_URL`.
- Only the `db:*:prod` commands use `DATABASE_URL`, and they say so in the name.
- The test suite drops and recreates its database, and the seed writes fixture
  accounts. Both refuse to run against anything that is not a local host. The
  override has to be typed out in full, which is the point.

## Deploying

The image is a standard multi-stage Docker build producing Next's standalone
output, and runs unprivileged.

Two health endpoints, and the distinction matters. `/api/health/live` checks
nothing and is what the container health check calls: an orchestrator kills and
reschedules an unhealthy task, so that probe must only ask whether the process
is serving. `/api/health` reports the database and is for you and for
monitoring. Restarting a container does not make a database reachable, and a
probe that conflates the two turns a bad connection string into a restart loop
that serves 502s and hides the cause.

Environment the running container needs:

| Variable | Value |
|---|---|
| `DATABASE_URL` | The live Postgres connection |
| `BETTER_AUTH_SECRET` | Its own secret, not the development one |
| `BETTER_AUTH_URL` | `https://blackbook.vara5.travel` |
| `OPENROUTER_API_KEY` | Optional. Without it, Brief Me explains it is off |
| `AI_MODEL` | Optional. Defaults to a cheap current model |

Dokploy is driven from a web interface with no host shell, so nothing here
assumes one.

**Schema.** Either let the container apply it, by setting
`RUN_MIGRATIONS_ON_BOOT=true`, or run it yourself. `pnpm db:bundle` writes
`drizzle/schema-bundle.sql`, every migration in order plus drizzle's bookkeeping
rows, so a database built by hand is indistinguishable from one the migrator
built and the next deployment applies only what is new. Paste it into any SQL
console against an empty database. Regenerate it whenever a migration is added.

**First administrator.** Visit `/setup`. It exists only while the instance has
no accounts at all and closes permanently once one exists. It cannot be done
with SQL: Better Auth stores a scrypt hash in a format only it produces, so a
row written by hand has no usable password. It is deliberately not an
environment variable either, which would leave a password in a config screen.

Because that page is open to whoever reaches it first, deploy and complete it
in one go, or keep the domain unpublished until you have.

**Everyone else** is added from Team in the sidebar, which administrators see.
Nothing sends email yet, so an administrator sets an initial password and passes
it on.

Applying migrations uses drizzle-orm's migrator rather than the drizzle-kit
CLI, so the production image carries no build tooling. drizzle-kit still
generates migrations; it is simply not what applies them.

## How the code is arranged

```
src/
  app/              routes: (app) is the authenticated shell, sign-in is public
  components/       presentation only, no database access
  domain/           pure types, Zod schemas, labels. Safe on both sides.
  services/         business operations. Authorization, validation, audit.
  repositories/     query layer
  db/               schema, client, preference catalogue
  auth/             Better Auth setup, session, capabilities
  ai/               provider resolution
```

The rule that keeps this honest: **a component never touches the database**.
Every write goes through a service, which asserts a capability, validates with
Zod, runs inside a transaction and writes an audit row. Services are marked
`server-only`, so a component that imports one fails the build rather than
leaking the Postgres driver into the browser bundle.

The same service layer is what an AI tool, an automation or a future mobile API
would call. Nothing about it is web-specific.

## Data model notes

The decisions that are not obvious from reading the tables:

- **Household is a first-class entity**, not a column. A client belongs to zero
  or one household and keeps their own preferences either way.
- **Reference IDs come from database sequences** (`CUST-00100`, `HH-00100`), so
  two concurrent writers can never mint the same one.
- **Multi-select preferences are rows, not arrays.** One catalogue of options,
  one join table, and a `polarity` column of `prefer` / `wishlist` / `avoid`.
  That collapses the document's "Favourite / Wishlist / Avoid" columns into one
  relation and makes "likes Japan but avoids large resorts" a single indexed
  join. Staff can add catalogue options at runtime without a migration.
- **Genuinely single-valued preferences** live in one row per client, so the
  Client 360 screen needs one join rather than five.
- **Milestones are rows**, so a client can have any number of important dates.
  Month and day are stored as generated columns, and two SQL functions compute
  the next occurrence, clamping 29 February to the 28th in a common year.
- **Duplicate clients are blocked at the database**, by a unique index on a
  generated digits-only phone column, scoped to non-archived rows.
- **Search is Postgres native**: a weighted `tsvector` for names and references,
  plus trigram indexes for misspellings and partial phone numbers. At Vara5's
  data volume a dedicated search service would be infrastructure without a
  payoff. Query operators are escaped rather than stripped, so names like
  O'Brien and Jean-Luc match the tokens Postgres actually indexed.
- **Prepared statements are on unless the connection is a transaction pooler**,
  which is port 6543 by convention. A direct connection and a session-mode
  pooler both support them.
- **Archiving is the normal path.** Records are soft-deleted. Permanent erasure
  is a separate, administrator-only capability that requires the client to be
  archived first and a written reason, and it leaves an audit entry behind that
  outlives the data it erased.

## Sharing a database with Supabase

Blackbook talks to Postgres directly and authorizes in the service layer. It
does not use Supabase's APIs, keys or row-level policies.

That stack still runs PostgREST behind Kong, though, so anything readable in
`public` is reachable over HTTP with the anon key, and this database holds
client names, numbers, addresses and family details. Migration 0005 therefore
enables row-level security with no policies on every table and revokes the
`anon` and `authenticated` grants. The application connects as the table owner,
which bypasses RLS, so none of it is visible to the app.

Verified against a schema with the Supabase roles present: the owner reads its
row, `anon` reads none and cannot write. A new table must do the same in its
own migration.

## Audit trail and logs

There are two separate records, and they answer different questions.

`activity_log` is the audit trail: who edited which client, which fields moved,
from what to what. It is append-only, enforced by a database trigger rather than
by convention, so no future service, script or AI tool can quietly rewrite it.
It is kept forever and shown to staff on the Client 360 timeline.

`src/lib/logger.ts` is operational telemetry: a request failed, the database was
unreachable, a model call timed out. One JSON object per line to stdout in
production, which is what Dokploy's log viewer reads, and readable text locally.
It redacts client names, numbers, addresses and free text by field name, because
logs are the easiest place for personal data to leak out of the system.

An edit produces an audit row. Only a problem produces a log line.

One exception is deliberate: a foreign-key SET NULL may clear the client or
household reference. That is what makes a genuine erasure request possible. The
client row can be destroyed while the record that something happened survives
with its reference cleared. What happened, when, and who did it stay immutable.

## Access control

Capability-based. Services ask "can this actor do X?", never "is this actor an
admin?", so adding a role later means editing one table in
`src/auth/permissions.ts`.

Administrators manage the team from Team in the sidebar: adding colleagues and
changing roles. An administrator cannot demote themselves, so the last one
cannot lock everybody out.

| Role | Can |
|---|---|
| Viewer | Read clients, use AI |
| Relationship Manager | Viewer, plus create and edit clients, households, preferences, milestones, interactions and tasks |
| Manager | Relationship Manager, plus archive clients and reassign relationship managers |
| Administrator | Everything, plus user management and permanent erasure |

The proxy in `src/proxy.ts` is a cheap redirect for signed-out visitors, not the
authorization boundary. Every service call independently loads the session and
asserts a capability.

Session cookie caching is off. It would save a read per request but it caches
the role with it, so a demotion or a suspension kept working until the cache
expired. At this headcount the read costs nothing and access changes taking
effect on the next request is worth more.

## AI

Two rules, both from the handover:

1. The model reads a rendered view of one client's record, never the database,
   and never generates SQL. The record it sees has already passed the same read
   authorization the signed-in user did.
2. Stored facts and model suggestions are visually separated in the UI. The
   briefing's bullets are CRM facts; the closing line is labelled a suggestion.

Access goes through OpenRouter, behind `src/ai/model.ts`. One key reaches every
model, so changing model is an environment variable. The AI SDK stays above
that file as the vendor-neutral interface, which is what made switching
provider a one-file change.

## Tests

```bash
pnpm test
```

The suite is organised by the operations document, one file per section, so a
requirement can be traced to the tests that cover it.

| File | Requirements section |
|---|---|
| `tests/customer-master.test.ts` | 1. Customer master |
| `tests/household.test.ts` | 2. Household profile |
| `tests/milestones.test.ts` | 3. Milestones |
| `tests/preferences.test.ts` | 4, 5, 6. Travel, hotel and air, dining and lifestyle |
| `tests/client-dna.test.ts` | 7. Client DNA, DO and DON'T |
| `tests/crm-capabilities.test.ts` | 8. Search, filters, interactions, timeline, dashboard |
| `tests/permissions.test.ts` | 8. Role-based access, every operation as every role |
| `tests/harness.test.ts` | The harness itself |

They run against real Postgres in a throwaway `vara5_crm_test` database that is
dropped, recreated and migrated on every run. That is deliberate: a large part
of the behaviour lives in the database rather than in TypeScript, including the
generated phone column, the partial unique index behind duplicate detection,
the append-only trigger, the check constraints and the milestone date
functions. None of that would be exercised against a mock.

The only thing stubbed is reading the signed-in user out of an HTTP request.
Every authorization check runs for real, so the permission tests attempt each
operation as each of the four roles and assert both the allow and the deny.

## What was taken from Twenty CRM

The handover names Twenty as the reference implementation, not a foundation.
Its core is AGPLv3, with some files commercially licensed, so Blackbook studies
the approach and never copies the code.

Adopted, because Twenty's approach was better:

- **Escaping tsquery operators instead of stripping them.** Stripping turned
  O'Brien into OBrien, which matches none of the tokens Postgres indexes, so
  those clients were found only by the fuzzy fallback and ranked badly.
- **Soft delete and destroy as separate permissions.** Twenty splits
  `canSoftDeleteAllObjectRecords` from `canDestroyAllObjectRecords`. Archiving
  and erasing were one capability here, which would have let every manager
  destroy a client.

Deliberately not adopted:

- **Objects and fields as database rows.** Twenty stores its schema as metadata
  so views can reference `fieldMetadataId`, which is what makes it a CRM anyone
  can reshape. The handover asks for the opposite: concrete typed fields, and
  explicitly not a CRM framework. Our fixed schema is why the queries are plain
  and the tests assert real columns.
- **Their seven-table view model.** That complexity exists to describe filters
  over dynamic fields. With a fixed schema a saved view is a named, owned query.

Where this implementation is the better one: phone search. Twenty writes three
formatted variants of a number into the search vector. Blackbook derives a
digits-only column and matches substrings against a trigram index, which finds
a number however it was typed and also powers duplicate detection.

## Known gaps

Deliberately not built yet, per the handover's "do not overbuild" list:

- No outbound messaging. Milestone reminders are surfaced in the app; nothing is
  sent by email or WhatsApp yet. The query layer is already shaped so a
  scheduler can consume it unchanged.
- Tasks are minimal: title, details, assignee, due date, priority, status. The
  operations document does not specify them, so they wait for ops input.
- No import path. The ops team almost certainly has this data in a spreadsheet
  today; that should be settled before the schema is frozen.
- No consent or retention policy recorded against a client, which the DPDP Act
  will eventually require.
- No end-to-end browser tests. The service layer is covered; the screens have
  been exercised by hand.
