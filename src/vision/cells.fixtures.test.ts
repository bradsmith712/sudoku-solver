/**
 * Blank vs. digit accuracy per cell over labelled image sets, reported per tag (and
 * per split for the owner's photos):
 *  - synthetic: the committed sample and, when generated, tests/fixtures/synthetic
 *    (or $VISION_SYNTHETIC_DIR). Boards are warped from their labelled corners so
 *    detection errors do not count here. At least MIN_CELL_ACCURACY of cells must match.
 *  - real: tests/fixtures/real (local only; skipped when absent). Boards come from
 *    detectBoard. Reported only: real-photo pass/fail is cell accuracy in eval:vision.
 *    Orientation is not resolved yet (Phase 6), so each photo is scored at the best of
 *    the 4 rotations of its ground truth, and the report says how many needed one.
 * Images with any wrong cell get a montage of their crops in
 * test-results/vision-debug/cells/<set>/ (red frame = wrong); VISION_DEBUG=all writes
 * one for every image.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFixtures, readJpeg, writeJpeg } from "./__fixtures__/fixtures";
import { formatTally, isNegative, listRealFixtures, type Score } from "./__fixtures__/real";
import { inkFraction, isDigit, largestInkBlob } from "./blank";
import { detectBoard, warpBoardAt } from "./board";
import { CELL_SIZE, extractCells, type Cell } from "./cells";
import type { Grid } from "../types";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SYNTHETIC = [
  { name: "synthetic-sample", dir: join(ROOT, "tests/fixtures/synthetic/sample") },
  {
    name: "synthetic",
    dir: process.env.VISION_SYNTHETIC_DIR ?? join(ROOT, "tests/fixtures/synthetic"),
  },
];
const REAL_DIR = join(ROOT, "tests/fixtures/real");
const DEBUG_DIR = join(ROOT, "test-results/vision-debug/cells");
const MIN_CELL_ACCURACY = 0.995;

type Result = { name: string; score: Score; wrong: string[]; rotation: number };

/** `mask` rotated 90 degrees clockwise `k` times. */
function rotate(mask: boolean[][], k: number): boolean[][] {
  let m = mask;
  for (let i = 0; i < k; i++) m = m.map((_, r) => m.map((row) => row[r]).reverse());
  return m;
}

/**
 * Score one board: per cell, does isDigit match the ground truth? `anyRotation`
 * compares against the truth turned to whichever of 4 rotations matches best.
 */
function score(
  name: string,
  truth: Score["truth"],
  grid: Grid,
  cells: Cell[],
  anyRotation: boolean,
): Result & { want: boolean[][] } {
  const got = Array.from({ length: 9 }, (_, r) => cells.slice(r * 9, r * 9 + 9).map(isDigit));
  const base = grid.map((row) => row.map((v) => v !== 0));
  let best = { rotation: 0, want: base, passed: -1 };
  for (let k = 0; k < (anyRotation ? 4 : 1); k++) {
    const want = rotate(base, k);
    const passed = want.flat().filter((v, i) => v === got.flat()[i]).length;
    if (passed > best.passed) best = { rotation: k, want, passed };
  }
  const wrong = cells
    .filter((c) => got[c.row][c.col] !== best.want[c.row][c.col])
    .map(
      (c) =>
        `r${c.row}c${c.col} want ${best.want[c.row][c.col] ? "digit" : "blank"}` +
        ` (ink ${inkFraction(c).toFixed(2)}, blob ${largestInkBlob(c)})`,
    );
  return {
    name,
    score: { truth, passed: best.passed, total: 81 },
    wrong,
    rotation: best.rotation,
    want: best.want,
  };
}

/** 9x9 montage of the crops, 3x scale, framed green (right) or red (wrong). */
function writeMontage(path: string, cells: Cell[], want: boolean[][]): void {
  const S = CELL_SIZE * 3;
  const tile = S + 6;
  const side = tile * 9;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const c of cells) {
    const ok = isDigit(c) === want[c.row][c.col];
    const frame = ok ? [40, 170, 60] : [220, 30, 30];
    for (let y = 0; y < tile; y++)
      for (let x = 0; x < tile; x++) {
        const inner = x >= 3 && y >= 3 && x < tile - 3 && y < tile - 3;
        const v = inner
          ? Math.round(
              255 * c.pixels[Math.floor((y - 3) / 3) * CELL_SIZE + Math.floor((x - 3) / 3)],
            )
          : -1;
        const i = ((c.row * tile + y) * side + c.col * tile + x) * 4;
        data.set(v < 0 ? [...frame, 255] : [v, v, v, 255], i);
      }
  }
  writeJpeg(path, { data, width: side, height: side, colorSpace: "srgb" } as ImageData);
}

function report(set: string, results: Result[]): void {
  const debugDir = join(DEBUG_DIR, set);
  const failures = results.filter((r) => r.wrong.length);
  if (failures.length || process.env.VISION_DEBUG === "all") {
    mkdirSync(debugDir, { recursive: true });
    writeFileSync(
      join(debugDir, "report.json"),
      JSON.stringify(
        failures.map(({ name, wrong, rotation }) => ({ name, rotation, wrong })),
        null,
        2,
      ) + "\n",
    );
  }
  const passed = results.reduce((s, r) => s + r.score.passed, 0);
  const total = results.reduce((s, r) => s + r.score.total, 0);
  console.log(
    `[cells] ${set}: ${passed}/${total} cells blank/digit correct ` +
      `(${((100 * passed) / total).toFixed(2)}%), ${results.length - failures.length}/${results.length} boards all correct` +
      failures
        .slice(0, 10)
        .map((r) => `\n  ${r.name}: ${r.wrong.join("; ")}`)
        .join("") +
      (failures.length > 10 ? `\n  ... ${failures.length - 10} more in report.json` : "") +
      "\n" +
      formatTally(
        `[cells] ${set}: cells correct`,
        results.map((r) => r.score),
      ),
  );
}

for (const set of SYNTHETIC) {
  const fixtures = listFixtures(set.dir);
  describe.skipIf(fixtures.length === 0)(`blank vs. digit: ${set.name} set`, () => {
    it(`gets at least ${MIN_CELL_ACCURACY * 100}% of cells right on ${fixtures.length} boards`, async () => {
      const debugDir = join(DEBUG_DIR, set.name);
      rmSync(debugDir, { recursive: true, force: true });
      const results: Result[] = [];
      for (const f of fixtures) {
        const corners = f.truth.corners!.map(([x, y]) => ({ x, y }));
        const { warped } = await warpBoardAt(readJpeg(f.imagePath), corners);
        const cells = extractCells(warped);
        const r = score(f.name, { tags: f.truth.tags ?? [] }, f.truth.grid, cells, false);
        results.push(r);
        if (r.wrong.length || process.env.VISION_DEBUG === "all")
          writeMontage(join(debugDir, `${f.name}.jpg`), cells, r.want);
      }
      report(set.name, results);
      const passed = results.reduce((s, r) => s + r.score.passed, 0);
      expect(passed / (results.length * 81)).toBeGreaterThanOrEqual(MIN_CELL_ACCURACY);
    }, 600_000);
  });
}

const real = listRealFixtures(REAL_DIR).filter((f) => !isNegative(f));
describe.skipIf(real.length === 0)("blank vs. digit: real set", () => {
  it(`reports cell accuracy on ${real.length} photos (no pass bar)`, async () => {
    const debugDir = join(DEBUG_DIR, "real");
    rmSync(debugDir, { recursive: true, force: true });
    const results: Result[] = [];
    for (const f of real) {
      const { warped } = await detectBoard(readJpeg(f.imagePath));
      const cells = extractCells(warped);
      const r = score(f.name, f.truth, f.truth.grid!, cells, true);
      results.push(r);
      if (r.wrong.length || process.env.VISION_DEBUG === "all")
        writeMontage(join(debugDir, `${f.name.replace("/", "_")}.jpg`), cells, r.want);
    }
    report("real", results);
    const rotated = results
      .filter((r) => r.rotation !== 0)
      .map((r) => `${r.name} (${r.rotation * 90}°)`);
    console.log(
      `[cells] real: ${rotated.length} scored at a rotation${rotated.length ? `: ${rotated.join(", ")}` : ""}`,
    );
    expect(results).toHaveLength(real.length);
  }, 600_000);
});
