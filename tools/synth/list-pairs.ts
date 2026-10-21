/**
 * List image / ground-truth pairs in the fixture directories.
 *
 *   npx vite-node tools/synth/list-pairs.ts [--json] [dir ...]
 *
 * Defaults to tests/fixtures/synthetic, tests/fixtures/synthetic/sample and tests/fixtures/real.
 * Prints "image<TAB>truth" per line (or a JSON array with --json) and a count per directory.
 */
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { listPairs } from "./pairs";

const ROOT = new URL("../../", import.meta.url).pathname;
const { values, positionals } = parseArgs({
  options: { json: { type: "boolean", default: false } },
  allowPositionals: true,
});
const dirs = positionals.length
  ? positionals
  : ["tests/fixtures/synthetic", "tests/fixtures/synthetic/sample", "tests/fixtures/real"];

const rel = (p: string) => relative(ROOT, p);
const all = dirs.map((d) => ({ dir: d, pairs: listPairs(resolve(ROOT, d)) }));
if (values.json) {
  const rows = all.flatMap(({ pairs }) =>
    pairs.map((p) => ({ image: rel(p.image), truth: rel(p.truthPath), tags: p.truth.tags ?? [] })),
  );
  console.log(JSON.stringify(rows, null, 2));
} else {
  for (const { pairs } of all)
    for (const p of pairs) console.log(`${rel(p.image)}\t${rel(p.truthPath)}`);
  for (const { dir, pairs } of all) console.error(`${dir}: ${pairs.length} pairs`);
}
