/**
 * Node-only loader for the owner's real photos in tests/fixtures/real/ (local only, never
 * committed; see FIXTURES-README.md). Each `<name>.json` sits next to `<name>.jpg` and has
 * `puzzleId`, `split` and `tags`. Positive cases have a `grid`; negative cases have
 * `"expect": "no_board_found"` and no grid. Subfolders are searched except pending/.
 * Used by the fixture tests, the detection test and tools/synth/list-pairs.ts.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { Grid } from "../../types";

export const SPLITS = ["train", "test"] as const;
export type Split = (typeof SPLITS)[number];

/** Folders under the real set that are not loaded (shots waiting for a retake). */
export const IGNORED_DIRS = ["pending"];

export type RealTruth = {
  /** Photos of the same printed puzzle share it and must share a split. */
  puzzleId: string;
  /** Never train on "test". */
  split: Split;
  /** Photo conditions, for per-tag results. */
  tags: string[];
  /** Printed givens, 0 = blank. Absent on negative cases. */
  grid?: Grid;
  /** Set on negative cases: scanning must throw ScanError with this code. */
  expect?: "no_board_found";
};

export type RealFixture = {
  /** Path relative to the set without extension, e.g. "book-002" or "negative/book-229". */
  name: string;
  imagePath: string;
  truthPath: string;
  truth: RealTruth;
};

const IMAGE_EXTS = [".jpg", ".jpeg"];

const isGrid = (g: unknown): g is Grid =>
  Array.isArray(g) &&
  g.length === 9 &&
  g.every(
    (row) =>
      Array.isArray(row) &&
      row.length === 9 &&
      row.every((v) => Number.isInteger(v) && v >= 0 && v <= 9),
  );

export const isNegative = (f: RealFixture) => f.truth.expect === "no_board_found";

/** The problems with one parsed JSON record, empty when it is a valid RealTruth. */
export function validateTruth(t: Record<string, unknown>): string[] {
  const errors = [];
  if (typeof t.puzzleId !== "string" || !t.puzzleId) errors.push("missing puzzleId");
  if (!SPLITS.includes(t.split as Split)) errors.push(`split must be one of ${SPLITS.join(", ")}`);
  if (!Array.isArray(t.tags) || t.tags.length === 0 || !t.tags.every((s) => typeof s === "string"))
    errors.push("tags must be a non-empty list of strings");
  if (t.expect !== undefined && t.expect !== "no_board_found")
    errors.push(`unknown expect "${String(t.expect)}"`);
  if (t.expect === "no_board_found") {
    if (t.grid !== undefined) errors.push("negative case must not have a grid");
  } else if (!isGrid(t.grid)) errors.push("grid must be 9x9 of 0-9");
  return errors;
}

/** puzzleIds whose photos are in more than one split. */
export function splitConflicts(fixtures: RealFixture[]): string[] {
  const splits = new Map<string, Set<Split>>();
  for (const { truth } of fixtures) {
    const s = splits.get(truth.puzzleId) ?? new Set();
    splits.set(truth.puzzleId, s.add(truth.split));
  }
  return [...splits].filter(([, s]) => s.size > 1).map(([id]) => id);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (!e.isDirectory()) return [join(dir, e.name)];
    return IGNORED_DIRS.includes(e.name) ? [] : walk(join(dir, e.name));
  });
}

/**
 * Every fixture under `dir` except pending/, sorted by name. A missing directory yields [].
 * Throws on an unpaired image or JSON, invalid metadata, or a puzzleId split across
 * train and test, so a broken set fails loudly instead of skewing results.
 */
export function listRealFixtures(dir: string): RealFixture[] {
  if (!existsSync(dir)) return [];
  const files = walk(dir);
  const stem = (f: string) => f.slice(0, -extname(f).length);
  const images = new Map(
    files.filter((f) => IMAGE_EXTS.includes(extname(f).toLowerCase())).map((f) => [stem(f), f]),
  );
  const truths = files.filter((f) => extname(f) === ".json").map(stem);
  const rel = (p: string) => relative(dir, p);
  const problems = [
    ...[...images].filter(([s]) => !truths.includes(s)).map(([, f]) => `${rel(f)}: no .json`),
    ...truths.filter((s) => !images.has(s)).map((s) => `${rel(s)}.json: no image`),
  ];

  const fixtures: RealFixture[] = [];
  for (const s of truths.filter((s) => images.has(s))) {
    const truthPath = `${s}.json`;
    const truth = JSON.parse(readFileSync(truthPath, "utf8")) as Record<string, unknown>;
    const errors = validateTruth(truth);
    if (errors.length) problems.push(`${rel(truthPath)}: ${errors.join("; ")}`);
    else
      fixtures.push({
        name: rel(s),
        imagePath: images.get(s)!,
        truthPath,
        truth: truth as RealTruth,
      });
  }
  for (const id of splitConflicts(fixtures))
    problems.push(`${id}: photos are in both train and test`);
  if (problems.length) throw new Error(`bad real fixtures in ${dir}:\n  ${problems.join("\n  ")}`);
  return fixtures.sort((a, b) => a.name.localeCompare(b.name));
}

/** One scored fixture: `passed` out of `total` (1/1 for a board, n/81 for cells). */
export type Score = { truth: RealTruth; passed: number; total: number };
export type Tally = { passed: number; total: number; fixtures: number };

/** Totals per split and per tag. A fixture counts once under its split and under each tag. */
export function tally(scores: Score[]): { split: Map<string, Tally>; tag: Map<string, Tally> } {
  const split = new Map<string, Tally>();
  const tag = new Map<string, Tally>();
  const add = (m: Map<string, Tally>, key: string, s: Score) => {
    const t = m.get(key) ?? { passed: 0, total: 0, fixtures: 0 };
    m.set(key, { passed: t.passed + s.passed, total: t.total + s.total, fixtures: t.fixtures + 1 });
  };
  for (const s of scores) {
    add(split, s.truth.split, s);
    for (const t of s.truth.tags) add(tag, t, s);
  }
  const sorted = (m: Map<string, Tally>) => new Map([...m].sort(([a], [b]) => a.localeCompare(b)));
  return { split: sorted(split), tag: sorted(tag) };
}

/** Plain-text table of a tally, e.g. for console output. */
export function formatTally(title: string, scores: Score[]): string {
  const { split, tag } = tally(scores);
  const width = Math.max(5, ...[...split.keys(), ...tag.keys()].map((k) => k.length));
  const row = (k: string, t: Tally) =>
    `  ${k.padEnd(width)}  ${`${t.passed}/${t.total}`.padStart(7)}  ${((100 * t.passed) / t.total).toFixed(0).padStart(3)}%`;
  return [
    title,
    " by split:",
    ...[...split].map(([k, t]) => row(k, t)),
    " by tag:",
    ...[...tag].map(([k, t]) => row(k, t)),
  ].join("\n");
}
