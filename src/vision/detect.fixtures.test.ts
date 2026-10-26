/**
 * Detection accuracy over labelled image sets. Each set that exists is checked:
 *  - hand-made: src/vision/__fixtures__/boards (committed, always present)
 *  - synthetic: tests/fixtures/synthetic, or $VISION_SYNTHETIC_DIR (Phase 3 generator)
 *  - real:      tests/fixtures/real (owner photos, local only; pending/ is skipped)
 * A board counts as aligned when its detected corners are within 2% of the board side
 * of the labelled corners (if the label has corners) and the warped grid lines sit
 * within 6 px of where a 450x450 board puts them. Failures write overlay, binary and
 * warped images to test-results/vision-debug/<set>/; VISION_DEBUG=all writes them for
 * every image.
 *
 * Real photos use a looser bar: every board must be found with its grid lines within
 * 15 px (a quarter cell), because printed pages bow and a 4-corner warp cannot flatten
 * them; cell extraction finds each cell's lines locally. Results are printed per split
 * and per tag at both 15 px and the strict 6 px. Each negative case ("expect":
 * "no_board_found") must throw ScanError("no_board_found"). Real-photo pass/fail is
 * cell accuracy in eval:vision, not this test.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { cornerError, gridLineOffset } from "./__fixtures__/align";
import { listFixtures, readJpeg, writeJpeg } from "./__fixtures__/fixtures";
import { formatTally, isNegative, listRealFixtures, type RealTruth } from "./__fixtures__/real";
import { detectBoard, type DetectedBoard } from "./board";
import { ScanError } from "./errors";
import type { Point } from "./geometry";
import { toImageData } from "./image";
import { loadOpenCv, type CV } from "./opencv";
import { preprocess } from "./preprocess";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SETS = [
  { name: "hand-made", dir: join(ROOT, "src/vision/__fixtures__/boards") },
  {
    name: "synthetic",
    dir: process.env.VISION_SYNTHETIC_DIR ?? join(ROOT, "tests/fixtures/synthetic"),
  },
];
const REAL_DIR = join(ROOT, "tests/fixtures/real");
const DEBUG_DIR = join(ROOT, "test-results/vision-debug");
const MIN_ALIGNED_RATE = 0.95;
const MAX_CORNER_ERROR = 0.02;
const MAX_LINE_OFFSET = 6;
/** Grid-line search window around each expected line (gridLineOffset caps offsets at it). */
const LINE_WINDOW = 12;
/** Real photos: a quarter cell, set on principle (not fitted to the photos). */
const REAL_MAX_LINE_OFFSET = 15;
/** Half a cell, so offsets up to and past REAL_MAX_LINE_OFFSET are measured, not capped. */
const REAL_LINE_WINDOW = 25;

type Tolerance = { maxLineOffset: number; window: number };
const STRICT: Tolerance = { maxLineOffset: MAX_LINE_OFFSET, window: LINE_WINDOW };
const REAL: Tolerance = { maxLineOffset: REAL_MAX_LINE_OFFSET, window: REAL_LINE_WINDOW };

/** One image to detect. `corners` are the labelled board corners, when known. */
type Case = { name: string; imagePath: string; corners?: [number, number][]; real?: RealTruth };

type Outcome = {
  name: string;
  ok: boolean;
  reason?: string;
  cornerError?: number;
  lineOffset?: number;
};

let cv: CV;
beforeAll(async () => {
  cv = await loadOpenCv();
});

function evaluate(f: Case, board: DetectedBoard, tol: Tolerance): Outcome {
  const lineOffset = gridLineOffset(board.warped, tol.window);
  const truth = f.corners?.map(([x, y]) => ({ x, y }));
  const err = truth ? cornerError(board.corners, truth) : undefined;
  const reasons = [];
  if (err !== undefined && err > MAX_CORNER_ERROR)
    reasons.push(`corner error ${(err * 100).toFixed(1)}%`);
  if (lineOffset > tol.maxLineOffset) reasons.push(`grid lines off by ${lineOffset}px`);
  return {
    name: f.name,
    ok: reasons.length === 0,
    reason: reasons.join(", ") || undefined,
    cornerError: err,
    lineOffset,
  };
}

function writeDebug(dir: string, f: Case, image: ImageData, board?: DetectedBoard): void {
  const src = cv.matFromImageData(image);
  let binary;
  try {
    binary = preprocess(cv, src);
    const quad = (pts: Point[], color: number[]) =>
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % 4];
        cv.line(src, new cv.Point(p.x, p.y), new cv.Point(q.x, q.y), color, 2);
      });
    const truth = f.corners?.map(([x, y]) => ({ x, y }));
    if (truth) quad(truth, [0, 200, 0, 255]);
    if (board) quad(board.corners, [230, 0, 0, 255]);
    writeJpeg(join(dir, `${f.name}-overlay.jpg`), toImageData(src));
    const rgba = new cv.Mat();
    try {
      cv.cvtColor(binary, rgba, cv.COLOR_GRAY2RGBA);
      writeJpeg(join(dir, `${f.name}-binary.jpg`), toImageData(rgba));
    } finally {
      rgba.delete();
    }
    if (board) writeJpeg(join(dir, `${f.name}-warped.jpg`), board.warped);
  } finally {
    src.delete();
    binary?.delete();
  }
}

/** Detect every case, write debug output for failures and log a summary. */
async function detectAll(set: string, cases: Case[], tol = STRICT): Promise<Outcome[]> {
  const debugDir = join(DEBUG_DIR, set);
  rmSync(debugDir, { recursive: true, force: true });
  const outcomes: Outcome[] = [];
  for (const f of cases) {
    const image = readJpeg(f.imagePath);
    let board: DetectedBoard | undefined;
    let outcome: Outcome;
    try {
      board = await detectBoard(image);
      outcome = evaluate(f, board, tol);
    } catch (err) {
      outcome = {
        name: f.name,
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    outcomes.push(outcome);
    if (!outcome.ok || process.env.VISION_DEBUG === "all") writeDebug(debugDir, f, image, board);
  }

  const failures = outcomes.filter((o) => !o.ok);
  const rate = (outcomes.length - failures.length) / outcomes.length;
  if (failures.length || process.env.VISION_DEBUG === "all") {
    mkdirSync(debugDir, { recursive: true });
    writeFileSync(
      join(debugDir, "report.json"),
      JSON.stringify({ rate, outcomes }, null, 2) + "\n",
    );
  }
  console.log(
    `[vision] ${set}: ${outcomes.length - failures.length}/${outcomes.length} aligned` +
      failures.map((o) => `\n  FAIL ${o.name}: ${o.reason}`).join(""),
  );
  return outcomes;
}

function expectAlignedRate(outcomes: Outcome[]): void {
  const failures = outcomes.filter((o) => !o.ok);
  expect(
    (outcomes.length - failures.length) / outcomes.length,
    `failures: ${failures.map((o) => o.name).join(", ")}`,
  ).toBeGreaterThanOrEqual(MIN_ALIGNED_RATE);
}

for (const set of SETS) {
  const cases = listFixtures(set.dir).map((f) => ({ ...f, corners: f.truth.corners }));
  describe.skipIf(cases.length === 0)(`board detection: ${set.name} set`, () => {
    it(`detects and aligns at least ${MIN_ALIGNED_RATE * 100}% of ${cases.length} boards`, async () => {
      expectAlignedRate(await detectAll(set.name, cases));
    }, 300_000);
  });
}

const real = listRealFixtures(REAL_DIR);
const realBoards: Case[] = real.filter((f) => !isNegative(f)).map((f) => ({ ...f, real: f.truth }));
describe.skipIf(real.length === 0)("board detection: real set", () => {
  it.skipIf(realBoards.length === 0)(
    `finds all ${realBoards.length} boards with grid lines within ${REAL_MAX_LINE_OFFSET}px`,
    async () => {
      const outcomes = await detectAll("real", realBoards, REAL);
      const score = (ok: (o: Outcome) => boolean) =>
        realBoards.map((f, i) => ({ truth: f.real!, passed: ok(outcomes[i]) ? 1 : 0, total: 1 }));
      console.log(
        formatTally(
          `[vision] real: detected, lines within ${REAL_MAX_LINE_OFFSET}px`,
          score((o) => o.ok),
        ),
      );
      console.log(
        formatTally(
          `[vision] real: lines within ${MAX_LINE_OFFSET}px (reported only)`,
          score((o) => o.ok && o.lineOffset! <= MAX_LINE_OFFSET),
        ),
      );
      const failures = outcomes.filter((o) => !o.ok).map((o) => `${o.name}: ${o.reason}`);
      expect(failures).toEqual([]);
    },
    300_000,
  );

  it.each(real.filter(isNegative).map((f) => [f.name, f] as const))(
    "%s: no board found",
    async (_, f) => {
      const err = await detectBoard(readJpeg(f.imagePath)).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err, "a board was detected").toBeInstanceOf(ScanError);
      expect((err as ScanError).code).toBe(f.truth.expect);
    },
    60_000,
  );
});
