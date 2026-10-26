import { defineConfig } from "@playwright/test";

// Built and served under the GitHub Pages subpath, the way the site is deployed, so
// any URL that ignores Vite's `base` fails here. Specs navigate relative ("./").
const BASE_PATH = (process.env.BASE_PATH ?? "/sudoku-solver/").replace(/\/?$/, "/");
const ORIGIN = "http://localhost:4173";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: `${ORIGIN}${BASE_PATH}` },
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    env: { BASE_PATH },
    url: `${ORIGIN}${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
