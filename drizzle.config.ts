import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { resolveToolDatabaseUrl } from "./src/db/url";

// .env.local holds developer-local secrets and is git-ignored.
config({ path: [".env.local", ".env"], quiet: true });

/**
 * Targets the development database unless DRIZZLE_TARGET=production is set,
 * which the `db:*:prod` scripts do explicitly. A migration must never reach the
 * live database because someone forgot which variable was which.
 */
const target =
  process.env.DRIZZLE_TARGET === "production" ? "production" : "development";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveToolDatabaseUrl(target),
  },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
