/**
 * List image / ground-truth pairs in the fixture directories.
 *
 *   npx vite-node tools/synth/list-pairs.ts [--json] [--split train|test] [dir ...]
 *
 * Defaults to tests/fixtures/synthetic, tests/fixtures/synthetic/sample and tests/fixtures/real.
 * Prints "image<TAB>truth" per line (or a JSON array with --json) and a count per directory.
 * Real photos (tests/fixtures/real, pending/ skipped) add split, puzzleId, tags and, on
 * negative cases, "no_board_found"; their counts per split and tag go to stderr.
 * --split keeps only real photos in that split. Training must use --split train, never test.
 */
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  formatTally,
  listRealFixtures,
  SPLITS,
  type RealTruth,
  type Split,
} from "../../src/vision/__fixtures__/real";
import { listPairs } from "./pairs";

const ROOT = new URL("../../", import.meta.url).pathname;
const REAL_DIR = resolve(ROOT, "tests/fixtures/real");
const { values, positionals } = parseArgs({
  options: { json: { type: "boolean", default: false }, split: { type: "string" } },
  allowPositionals: true,
});
const split = values.split as Split | undefined;
if (split && !SPLITS.includes(split))
  throw new Error(`--split must be one of ${SPLITS.join(", ")}`);
const dirs = positionals.length
  ? positionals
  : ["tests/fixtures/synthetic", "tests/fixtures/synthetic/sample", "tests/fixtures/real"];

type Row = { image: string; truth: string; tags: string[]; real?: RealTruth };

const rel = (p: string) => relative(ROOT, p);
const isReal = (dir: string) => resolve(ROOT, dir).startsWith(REAL_DIR);
const all = dirs.map((dir): { dir: string; rows: Row[] } => {
  const rows: Row[] = isReal(dir)
    ? listRealFixtures(resolve(ROOT, dir)).map((f) => ({
        image: rel(f.imagePath),
        truth: rel(f.truthPath),
        tags: f.truth.tags,
        real: f.truth,
      }))
    : listPairs(resolve(ROOT, dir)).map((p) => ({
        image: rel(p.image),
        truth: rel(p.truthPath),
        tags: p.truth.tags ?? [],
      }));
  return { dir, rows: split ? rows.filter((r) => r.real?.split === split) : rows };
});

const rows = all.flatMap((d) => d.rows);
if (values.json) {
  const out = rows.map(({ image, truth, tags, real }) =>
    real
      ? { image, truth, tags, puzzleId: real.puzzleId, split: real.split, expect: real.expect }
      : { image, truth, tags },
  );
  console.log(JSON.stringify(out, null, 2));
} else {
  for (const { image, truth, real } of rows) {
    const extra = real
      ? [real.split, real.puzzleId, real.tags.join(","), real.expect].filter(Boolean)
      : [];
    console.log([image, truth, ...extra].join("\t"));
  }
}
for (const { dir, rows } of all) console.error(`${dir}: ${rows.length} pairs`);
const real = rows.filter((r) => r.real);
if (real.length) {
  const scores = real.map((r) => ({ truth: r.real!, passed: r.real!.expect ? 0 : 1, total: 1 }));
  console.error(formatTally("real photos (boards/all; the rest are negative cases)", scores));
}
