/**
 * Photo to reviewed grid: decode (photo.ts), scan() through the SPEC.md contract,
 * then repair confident misreads (src/solver/repair.ts). The vision module (OpenCV.js,
 * onnxruntime and the model) is imported dynamically on the first scan, so manual
 * entry never loads it.
 */
import { repair, type Change } from "../solver/repair";
import type { SolveStatus } from "../solver/solver";
import type { Grid, ScanResult } from "../types";
import { decodePhoto } from "./photo";
import { checkRetake, type RetakeCheck } from "./retake";

export type ScanOutcome = {
  result: ScanResult;
  /** The grid to review: the scan, with any repair applied. */
  grid: Grid;
  /** Cells repair changed (from = scanned digit, to = runner-up). */
  changed: Change[];
  /** solve() status of `grid`. */
  status: SolveStatus;
  solution?: Grid;
  /** Whether to ask for another photo instead of a review (never after a successful repair). */
  retake: RetakeCheck;
};

let vision: Promise<typeof import("../vision/scan")> | undefined;

/**
 * Start loading the vision code, OpenCV.js and the model when the user opens the
 * camera or file picker, so they load while the user takes or picks a photo.
 */
export function preloadScanner(): void {
  if (vision) return;
  vision = import("../vision/scan").catch((err: unknown) => {
    vision = undefined; // let a retry load it again
    throw err;
  });
  // Errors surface from scanPhoto, which awaits the same loads.
  vision.then((m) => m.warmUp()).catch(() => undefined);
}

function measure(name: string, start: number): void {
  try {
    performance.measure(name, { start, duration: performance.now() - start });
  } catch {
    // Timing is diagnostic only.
  }
}

/** Throws ScanError("no_board_found") from scan(), or any load or decode error. */
export async function scanPhoto(file: Blob): Promise<ScanOutcome> {
  const start = performance.now();
  preloadScanner();
  const image = await decodePhoto(file);
  measure("photo:decode", start);
  try {
    performance.mark("photo:decoded", { detail: { width: image.width, height: image.height } });
  } catch {
    // diagnostic only
  }
  const { scan } = await vision!;
  const result = await scan(image);
  const t = performance.now();
  const second = result.second ?? result.grid.map((row) => row.map(() => 0));
  const margin = result.margin ?? result.grid.map((row) => row.map(() => 1));
  const fixed = repair(result.grid, margin, second);
  measure("repair", t);
  measure("photo:scan-total", start);
  const check = checkRetake(result.grid, result.confidence);
  return {
    result,
    retake: fixed.status === "solved" ? { ...check, retake: false, reason: undefined } : check,
    grid: fixed.grid,
    changed: fixed.changed,
    status: fixed.status,
    solution: fixed.solution,
  };
}
