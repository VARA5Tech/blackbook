import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: [".env.test", ".env.local"], quiet: true });

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // `server-only` throws unless a bundler selects its react-server export.
      // The modules under test are server modules, so it has nothing to guard.
      "server-only": resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Services share one Postgres database, so tests run in one process and
    // each file resets the tables it touches.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      include: ["src/services/**", "src/repositories/**", "src/domain/**"],
      reporter: ["text-summary"],
    },
  },
});
