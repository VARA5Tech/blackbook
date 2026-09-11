/**
 * Applies pending migrations.
 *
 *   pnpm db:migrate          against DEV_DATABASE_URL
 *   pnpm db:migrate:prod     against DATABASE_URL
 *
 * Plain JavaScript with no build step, and it uses drizzle-orm's own migrator
 * rather than the drizzle-kit CLI. drizzle-kit is a development tool: it pulls
 * in esbuild and a config loader, and it is not present in the production
 * image. The migrator needs only the driver and the SQL files, so the same
 * command works on a laptop and inside the container.
 *
 * drizzle-kit is still what generates migrations. It is simply not what applies
 * them in production.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const target =
  process.env.MIGRATE_TARGET === "production" ? "production" : "development";

const url =
  target === "production"
    ? process.env.DATABASE_URL
    : process.env.DEV_DATABASE_URL;

if (!url) {
  const name = target === "production" ? "DATABASE_URL" : "DEV_DATABASE_URL";
  console.error(`${name} is not set, so there is no ${target} database to migrate.`);
  process.exit(1);
}

function describe(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "an unparseable URL";
  }
}

console.log(`Migrating ${target}: ${describe(url)}`);

// One connection, no prepared statements: correct through a transaction pooler
// as well as directly, and a migration run is short-lived either way.
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 20 });

try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
} catch (error) {
  console.error(`\nMigration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
