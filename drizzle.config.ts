import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { resolveDevDatabaseUrl } from "./src/db/url";

// .env.local holds developer-local secrets and is git-ignored.
config({ path: [".env.local", ".env"], quiet: true });

/**
 * Development only, with no way to point it at production. drizzle-kit
 * generates migrations and opens Studio, both of which want a socket the live
 * database does not offer; production migrations are applied by the container
 * at boot.
 */
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDevDatabaseUrl(),
  },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
