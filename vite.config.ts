/// <reference types="vitest" />
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";

const SW_FILE = "sw.js";
// Never part of the shell: these must only download when the user first scans.
const HEAVY = /\.(wasm|onnx)$|opencv/;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

// Fills the placeholders in public/sw.js. The shell is what index.html loads up front
// (the entry chunk, its static imports and CSS) plus the public files; everything
// else in the bundle (the vision chunk, OpenCV.js, onnxruntime, its wasm and the
// model) is lazy, cached on first use and listed with a SHA-256 so the worker only
// keeps complete downloads. Each list gets a content hash for its cache name.
function swPrecache(): Plugin {
  let outDir = "";
  let lazy: string[] = [];
  return {
    name: "sw-precache",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      const eager = new Set<string>();
      const visit = (file: string) => {
        if (eager.has(file)) return;
        eager.add(file);
        const out = bundle[file];
        if (out?.type !== "chunk") return;
        out.imports.forEach(visit);
        out.viteMetadata?.importedCss.forEach((f) => eager.add(f));
        out.viteMetadata?.importedAssets.forEach((f) => eager.add(f));
      };
      for (const out of Object.values(bundle)) {
        if (out.type === "chunk" && out.isEntry) visit(out.fileName);
      }
      lazy = Object.keys(bundle)
        .filter((f) => !eager.has(f) && f !== "index.html" && !f.endsWith(".map"))
        .sort();
    },
    closeBundle() {
      const swPath = join(outDir, SW_FILE);
      const lazySet = new Set(lazy);
      const shell = listFiles(outDir)
        .map((f) => relative(outDir, f).split(sep).join("/"))
        .filter((f) => f !== SW_FILE && f !== "index.html" && !f.endsWith(".map"))
        .filter((f) => !lazySet.has(f))
        .sort();
      const heavyInShell = shell.filter((f) => HEAVY.test(f));
      if (heavyInShell.length)
        throw new Error(`sw-precache: heavy files in shell: ${heavyInShell}`);

      const shellHash = createHash("sha256");
      for (const f of shell) shellHash.update(f).update(readFileSync(join(outDir, f)));
      shellHash.update(readFileSync(join(outDir, "index.html")));
      const entries = lazy.map((url) => ({ url, sha256: sha256(readFileSync(join(outDir, url))) }));

      const source = readFileSync(swPath, "utf8");
      const output = source
        .replace("__SW_SHELL_VERSION__", shellHash.digest("hex").slice(0, 12))
        .replace("__SW_ASSETS_VERSION__", sha256(JSON.stringify(entries)).slice(0, 12))
        .replace(/\/\* __SW_SHELL__ \*\/ \[[^\]]*\]/, JSON.stringify(["./", ...shell]))
        .replace(/\/\* __SW_LAZY__ \*\/ \[[^\]]*\]/, JSON.stringify(entries));
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
    // vite-node's default-export interop wraps CJS deps in a Proxy that forwards
    // `then` to the module. OpenCV.js has its own `then`, so importing it would hang.
    deps: { interopDefault: false },
  },
});
