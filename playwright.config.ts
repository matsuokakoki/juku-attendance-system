import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  reporter: [["list"]],
  webServer: {
    command: "node scripts/wrangler.mjs dev --port 8787",
    url: "http://127.0.0.1:8787/api/health",
    reuseExistingServer: !process.env.CI,
  },
});
