import { defineConfig } from "@playwright/test";

// The PWA and perf specs against the deployed site: `npm run test:live`, or
// LIVE_URL=https://.../ for another deployment. No local server is started.
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: ["pwa.spec.ts", "perf.spec.ts"],
  outputDir: "test-results/live",
  use: { baseURL: process.env.LIVE_URL ?? "https://bradsmith712.github.io/sudoku-solver/" },
});
