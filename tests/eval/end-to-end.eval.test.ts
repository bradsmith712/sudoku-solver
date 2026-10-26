/**
 * `npm run eval:vision`, end-to-end part: the app's pipeline on whole photos.
 * Skipped unless EVAL_VISION=1.
 *
 * Each photo is shrunk to 1024 px on its longer side (as src/ui/photo.ts does),
 * scanned with scanDetailed (detect, warp, four orientations), then repaired
 * (src/solver/repair.ts) as the review screen does. Sets: the synthetic set
 * (tests/fixtures/synthetic, or the committed sample) and the owner's real photos
 * per split (EVAL_SPLITS, default train,test; test is reported, never tuned on).
 *
 * Reports, per set:
 *  - boards read perfectly without and with repair (a missed board counts as wrong);
 *  - the retake guard (src/ui/retake.ts): boards sent back for another photo, any
 *    of them read perfectly, and misreads that still reach the review screen;
 *  - of all misread cells (before repair): caught by (a) confidence under 0.9,
 *    (b) findConflicts, (c) either;
 *  - orientation: each photo also turned 90, 180 and 270 degrees; correct when the
 *    returned grid matches the truth better than any other quarter turn of it would;
 *  - timings (median and p95, ms): detect, warp, recognize x4, repair, total.
 * Writes test-results/vision-eval/end-to-end.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findConflicts } from "../../src/solver/conflicts";
import { repair } from "../../src/solver/repair";
import { checkRetake } from "../../src/ui/retake";
import type { Grid } from "../../src/types";
import { listFixtures, readJpeg } from "../../src/vision/__fixtures__/fixtures";
import { isNegative, listRealFixtures } from "../../src/vision/__fixtures__/real";
import { resizeToMax } from "../../src/vision/__fixtures__/resize";
import { rotateGrid, rotateImage, type QuarterTurns } from "../../src/vision/rotate";
import { scanDetailed, type ScanTimings } from "../../src/vision/scan";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT_DIR = join(ROOT, "test-results/vision-eval");
const REVIEW = 0.9;
const MAX_SIDE = 1024;
const SPLITS = (process.env.EVAL_SPLITS ?? "train,test").split(",");

type Item = { name: string; path: string; want: Grid };

type Result = {
  name: string;
  found: boolean;
  perfect: boolean;
  perfectAfterRepair: boolean;
  repaired: number;
  wrongRepair: boolean;
  misreads: number;
  /** The app would ask for another photo instead of showing review (src/ui/retake.ts). */
  retake: boolean;
  byConfidence: number;
  byConflict: number;
  byEither: number;
  /** Orientation correct at input turns 0, 90, 180, 270 (false if not found). */
  oriented: boolean[];
  timings?: ScanTimings & { repair: number };
};

const agree = (a: Grid, b: Grid) =>
  a.flat().filter((v, i) => v === b[Math.floor(i / 9)][i % 9]).length;
const same = (a: Grid, b: Grid) => agree(a, b) === 81;

/** True if no other quarter turn of `got` matches `want` better than `got` itself. */
function upright(got: Grid, want: Grid): boolean {
  const base = agree(got, want);
  return ([1, 2, 3] as QuarterTurns[]).every((t) => agree(rotateGrid(got, t), want) < base);
}

async function evaluate(item: Item): Promise<Result> {
  const photo = await resizeToMax(readJpeg(item.path), MAX_SIDE);
  const r: Result = {
    name: item.name,
    found: false,
    perfect: false,
    perfectAfterRepair: false,
    repaired: 0,
    wrongRepair: false,
    misreads: 0,
    retake: false,
    byConfidence: 0,
    byConflict: 0,
    byEither: 0,
    oriented: [],
  };
  for (const turns of [0, 1, 2, 3] as QuarterTurns[]) {
    let scanned;
    try {
      scanned = await scanDetailed(rotateImage(photo, turns));
    } catch {
      r.oriented.push(false);
      continue;
    }
    r.oriented.push(upright(scanned.result.grid, item.want));
    if (turns !== 0) continue;

    const { grid, confidence, margin, second } = scanned.result;
    r.found = true;
    r.perfect = same(grid, item.want);
    const conflicts = new Set(findConflicts(grid).map(({ row, col }) => `${row},${col}`));
    grid.forEach((row, i) =>
      row.forEach((v, j) => {
        if (v === item.want[i][j]) return;
        r.misreads++;
        const low = confidence[i][j] < REVIEW;
        const clash = conflicts.has(`${i},${j}`);
        if (low) r.byConfidence++;
        if (clash) r.byConflict++;
        if (low || clash) r.byEither++;
      }),
    );
    const t = performance.now();
    const fixed = repair(grid, margin!, second!);
    const repairMs = performance.now() - t;
    r.repaired = fixed.changed.length;
    r.perfectAfterRepair = same(fixed.grid, item.want);
    r.wrongRepair = fixed.changed.length > 0 && !r.perfectAfterRepair;
    r.retake = fixed.status !== "solved" && checkRetake(grid, confidence).retake;
    r.timings = { ...scanned.timings, repair: repairMs };
  }
  return r;
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

function summarize(set: string, results: Result[]) {
  const n = results.length;
  const sum = (f: (r: Result) => number) => results.reduce((a, r) => a + f(r), 0);
  const misreads = sum((r) => r.misreads);
  const timed = results.filter((r) => r.timings).map((r) => r.timings!);
  const stage = (f: (t: ScanTimings & { repair: number }) => number) => ({
    median: Math.round(quantile(timed.map(f), 0.5)),
    p95: Math.round(quantile(timed.map(f), 0.95)),
  });
  const orientations = results.flatMap((r) => r.oriented);
  return {
    set,
    boards: n,
    found: sum((r) => (r.found ? 1 : 0)),
    perfect: sum((r) => (r.perfect ? 1 : 0)),
    perfectAfterRepair: sum((r) => (r.perfectAfterRepair ? 1 : 0)),
    boardsRepaired: sum((r) => (r.repaired ? 1 : 0)),
    wrongRepairs: sum((r) => (r.wrongRepair ? 1 : 0)),
    misreads,
    retakes: sum((r) => (r.retake ? 1 : 0)),
    retakesOfPerfect: sum((r) => (r.retake && r.perfect ? 1 : 0)),
    retakeBoards: results.filter((r) => r.retake).map((r) => r.name),
    reviewedBoards: sum((r) => (r.found && !r.retake ? 1 : 0)),
    reviewedPerfectAfterRepair: sum((r) => (r.found && !r.retake && r.perfectAfterRepair ? 1 : 0)),
    misreadsReachingReview: sum((r) => (r.retake ? 0 : r.misreads)),
    caughtByConfidence: sum((r) => r.byConfidence),
    caughtByConflict: sum((r) => r.byConflict),
    caughtByEither: sum((r) => r.byEither),
    orientation: [orientations.filter(Boolean).length, orientations.length],
    orientationFailures: results
      .flatMap((r) => r.oriented.map((ok, t) => (ok ? "" : `${r.name}@${t * 90}`)))
      .filter(Boolean),
    timingsMs: {
      detect: stage((t) => t.detect),
      warp: stage((t) => t.warp),
      recognizeEach: stage((t) => t.recognize.reduce((a, b) => a + b, 0) / t.recognize.length),
      recognizeAll4: stage((t) => t.recognize.reduce((a, b) => a + b, 0)),
      repair: stage((t) => t.repair),
      total: stage((t) => t.total + t.repair),
    },
  };
}

function format(s: ReturnType<typeof summarize>): string {
  const f = (a: number, b: number) => `${a}/${b} (${b ? ((100 * a) / b).toFixed(1) : "-"}%)`;
  const t = s.timingsMs;
  const ms = (x: { median: number; p95: number }) => `${x.median}/${x.p95}`;
  return [
    `[e2e] ${s.set}: ${s.boards} boards, board found in ${s.found}`,
    `       perfect boards: without repair ${f(s.perfect, s.boards)}, with repair ${f(s.perfectAfterRepair, s.boards)}` +
      ` (${s.boardsRepaired} boards repaired, ${s.wrongRepairs} wrongly)`,
    `       misreads caught: (a) confidence < ${REVIEW} ${f(s.caughtByConfidence, s.misreads)},` +
      ` (b) conflicts ${f(s.caughtByConflict, s.misreads)}, (c) either ${f(s.caughtByEither, s.misreads)}`,
    `       retake guard: ${s.retakes} boards sent back (${s.retakesOfPerfect} read perfectly)` +
      (s.retakeBoards.length ? `: ${s.retakeBoards.join(", ")}` : "") +
      `; reviewed boards perfect after repair ${f(s.reviewedPerfectAfterRepair, s.reviewedBoards)},` +
      ` misreads reaching review ${s.misreadsReachingReview}`,
    `       orientation correct at 0/90/180/270: ${f(s.orientation[0], s.orientation[1])}` +
      (s.orientationFailures.length
        ? `; wrong or not found: ${s.orientationFailures.join(", ")}`
        : ""),
    `       ms median/p95: detect ${ms(t.detect)}, warp ${ms(t.warp)}, recognize ${ms(t.recognizeEach)} each,` +
      ` x4 ${ms(t.recognizeAll4)}, repair ${ms(t.repair)}, total ${ms(t.total)}`,
  ].join("\n");
}

describe.skipIf(!process.env.EVAL_VISION)("eval:vision end to end", () => {
  it("reports scan + repair accuracy, orientation and timing", async () => {
    const full = process.env.VISION_SYNTHETIC_DIR ?? join(ROOT, "tests/fixtures/synthetic");
    let synthetic = listFixtures(full);
    const setName = synthetic.length ? "synthetic" : "synthetic sample";
    if (!synthetic.length) synthetic = listFixtures(join(ROOT, "tests/fixtures/synthetic/sample"));
    const sets: [string, Item[]][] = [
      [setName, synthetic.map((f) => ({ name: f.name, path: f.imagePath, want: f.truth.grid }))],
    ];
    const real = listRealFixtures(join(ROOT, "tests/fixtures/real")).filter((f) => !isNegative(f));
    for (const split of ["train", "test"])
      if (SPLITS.includes(split)) {
        const items = real
          .filter((f) => f.truth.split === split)
          .map((f) => ({ name: f.name, path: f.imagePath, want: f.truth.grid! }));
        if (items.length) sets.push([`real ${split}`, items]);
      }

    const summaries = [];
    const lines = [];
    for (const [name, items] of sets) {
      const results = [];
      for (const item of items) results.push(await evaluate(item));
      const s = summarize(name, results);
      summaries.push({ ...s, results });
      lines.push(format(s));
    }
    console.log(lines.join("\n\n"));
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, "end-to-end.json"), JSON.stringify(summaries, null, 1) + "\n");
    expect(summaries.length).toBeGreaterThan(0);
  }, 3_600_000);
});
