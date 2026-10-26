/**
 * scan(image): the whole vision pipeline behind the SPEC.md contract. Detect and warp
 * the board (board.ts), resolve its orientation, read it (recognize.ts).
 *
 * Orientation: the four corners of a board look alike and puzzles are 180-degree
 * symmetric, so neither the outline nor the blank pattern says which way is up. The
 * board is read at all four quarter turns; the turn whose grid has no repeated digit
 * wins, and among those (or among all, if every turn repeats a digit) the one with
 * the highest mean confidence over its digit cells. Upside-down or sideways digits
 * read as other digits, mostly with low confidence and inconsistently, which
 * breaks both tests. One ONNX session serves all four reads (recognize.ts).
 */
import type { Grid, ScanResult } from "../types";
import { detectBoard } from "./board";
import { loadOpenCv } from "./opencv";
import { loadDigitModel, recognizeBoard } from "./recognize";
import { rotateHomography, rotateImage, type QuarterTurns } from "./rotate";
import { BOARD_SIZE } from "./warp";

/** Milliseconds per stage; `recognize` has one entry per quarter turn tried. */
export type ScanTimings = {
  detect: number;
  warp: number;
  recognize: number[];
  total: number;
};

export type OrientationCandidate = {
  turns: QuarterTurns;
  duplicates: boolean;
  /** Mean confidence over the cells read as digits (0 if none). */
  meanConfidence: number;
};

export type ScanDetails = {
  result: ScanResult;
  /** Clockwise quarter turns applied to the detected board to make it upright. */
  turns: QuarterTurns;
  candidates: OrientationCandidate[];
  timings: ScanTimings;
};

const TURNS: QuarterTurns[] = [0, 1, 2, 3];

/** True if a digit repeats in a row, column or box. (src/vision may not import src/solver.) */
export function hasDuplicates(grid: Grid): boolean {
  for (let k = 0; k < 9; k++) {
    const seen = [0, 0, 0];
    for (let i = 0; i < 9; i++) {
      const cells = [
        grid[k][i],
        grid[i][k],
        grid[Math.floor(k / 3) * 3 + Math.floor(i / 3)][(k % 3) * 3 + (i % 3)],
      ];
      for (let u = 0; u < 3; u++) {
        if (!cells[u]) continue;
        const bit = 1 << cells[u];
        if (seen[u] & bit) return true;
        seen[u] |= bit;
      }
    }
  }
  return false;
}

function meanDigitConfidence(grid: Grid, confidence: number[][]): number {
  let sum = 0;
  let n = 0;
  grid.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v) {
        sum += confidence[r][c];
        n++;
      }
    }),
  );
  return n ? sum / n : 0;
}

/**
 * Publish the stage timings as performance measures ("scan:detect", "scan:warp",
 * "scan:recognize-0".."-3", "scan:total") so the UI's callers and the browser perf
 * test can read them without reaching past scan().
 */
function recordTimings(start: number, t: ScanTimings): void {
  if (typeof performance.measure !== "function") return;
  try {
    performance.measure("scan:detect", { start, duration: t.detect });
    performance.measure("scan:warp", { start: start + t.detect, duration: t.warp });
    let at = start + t.detect + t.warp;
    t.recognize.forEach((d, i) => {
      performance.measure(`scan:recognize-${i}`, { start: at, duration: d });
      at += d;
    });
    performance.measure("scan:total", { start, duration: t.total });
  } catch {
    // Timing is diagnostic only.
  }
}

/** scan() plus which turn won, every turn's score and per-stage timings (eval, perf report). */
export async function scanDetailed(image: ImageData): Promise<ScanDetails> {
  const start = performance.now();
  const stages: { detect?: number; warp?: number } = {};
  const board = await detectBoard(image, stages);

  const reads = [];
  const recognize: number[] = [];
  for (const turns of TURNS) {
    const t = performance.now();
    const warped = rotateImage(board.warped, turns);
    const read = await recognizeBoard(warped);
    recognize.push(performance.now() - t);
    reads.push({ turns, warped, read });
  }

  const candidates: OrientationCandidate[] = reads.map(({ turns, read }) => ({
    turns,
    duplicates: hasDuplicates(read.grid),
    meanConfidence: meanDigitConfidence(read.grid, read.confidence),
  }));
  const pool = candidates.some((c) => !c.duplicates)
    ? candidates.filter((c) => !c.duplicates)
    : candidates;
  const best = pool.reduce((a, b) => (b.meanConfidence > a.meanConfidence ? b : a));
  const { warped, read } = reads[best.turns];

  const timings: ScanTimings = {
    detect: stages.detect ?? 0,
    warp: stages.warp ?? 0,
    recognize,
    total: performance.now() - start,
  };
  recordTimings(start, timings);
  return {
    result: {
      grid: read.grid,
      confidence: read.confidence,
      second: read.second,
      margin: read.margin,
      warped,
      homography: rotateHomography(board.homography, best.turns, BOARD_SIZE),
    },
    turns: best.turns,
    candidates,
    timings,
  };
}

/**
 * Start loading OpenCV.js and the digit model without scanning, e.g. when the user
 * opens the camera or file picker, so the first scan does not wait for them.
 */
export async function warmUp(): Promise<void> {
  await Promise.all([loadOpenCv(), loadDigitModel()]);
}

/**
 * Read the sudoku in a photo (already turned upright per its EXIF orientation).
 * Throws ScanError("no_board_found") if no board is detected. Loads OpenCV.js and the
 * digit model on first use.
 */
export async function scan(image: ImageData): Promise<ScanResult> {
  return (await scanDetailed(image)).result;
}
