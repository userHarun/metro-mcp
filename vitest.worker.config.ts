import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          METRO_GTFS_API_KEY: "test-only-key",
          METRO_TRANSIT_DATA_API_KEY: "test-only-key",
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    })),
  ],
  test: {
    include: ["tests-worker/**/*.test.ts"],
    setupFiles: ["./tests-worker/setup.ts"],
  },
});
