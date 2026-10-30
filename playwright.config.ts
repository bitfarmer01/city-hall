import { defineConfig } from "@playwright/test";

// E2E for the web app (D7): runs against the production build (`next
// start`) — the same artifact CI ships. CI builds first, then runs
// `npm run test:e2e`; locally, `reuseExistingServer` lets you point the
// suite at an already-running instance.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${process.env.E2E_PORT ?? "3311"}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next start -p ${process.env.E2E_PORT ?? "3311"}`,
    url: `http://localhost:${process.env.E2E_PORT ?? "3311"}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
