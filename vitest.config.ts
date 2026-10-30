import { fileURLToPath } from "node:url";

import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // tests/e2e is Playwright's (npm run test:e2e), not vitest's — vitest's
    // default include would otherwise pick up *.spec.ts files there.
    // defaultExclude keeps node_modules etc. out of the scan.
    exclude: [...defaultExclude, "tests/e2e/**"],
  },
});
