/// <reference types="vitest" />
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";

const SW_FILE = "sw.js";

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
}

// Fills the placeholders in public/sw.js with every emitted file (hashed bundles,
// manifest, icons) and a content hash, so each deploy gets a fresh cache.
function swPrecache(): Plugin {
  let outDir = "";
  return {
    name: "sw-precache",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const swPath = join(outDir, SW_FILE);
      const files = listFiles(outDir)
        .map((f) => relative(outDir, f).split(sep).join("/"))
        .filter((f) => f !== SW_FILE && f !== "index.html" && !f.endsWith(".map"))
        .sort();
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      hash.update(readFileSync(join(outDir, "index.html")));

      const source = readFileSync(swPath, "utf8");
      const output = source
        .replace("__SW_BUILD__", hash.digest("hex").slice(0, 12))
        .replace(/\/\* __SW_PRECACHE__ \*\/ \[[^\]]*\]/, JSON.stringify(["./", ...files]));
      if (output.includes("__SW_")) throw new Error(`sw-precache: placeholder left in ${SW_FILE}`);
      writeFileSync(swPath, output);
    },
  };
}

export default defineConfig({
  // The Pages workflow sets BASE_PATH (e.g. "/sudoku-solver/"); relative otherwise.
  base: process.env.BASE_PATH || "./",
  plugins: [swPrecache()],
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
});
