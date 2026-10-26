/**
 * Retake guard: some scans are too wrong to review cell by cell, typically a board
 * detected out of position, which reads dozens of cells wrong. Those get "couldn't
 * read this, try again" instead of a review screen full of mistakes. The proper fix
 * for a misplaced board is adjusting its corners by hand (Stretch in TASKS.md).
 *
 * Cut-offs were set on the 240 synthetic boards and 10 split=train photos only
 * (end-to-end scans at 1024 px, before repair):
 *  - Conflicting cells: every board with 6 or more misreads had 11-17, every
 *    perfectly read board had 0, and the one board repair fixes had 3. 8 sits in that gap.
 *  - Mean digit confidence did not separate them: synth-0118 (45 misreads) averaged
 *    0.922 and a perfect board 0.935. RETAKE_MEAN_CONFIDENCE is only a floor for
 *    scans that read too few digits to conflict; no board in the data came near it
 *    (lowest 0.902), so it is unexercised.
 */
import { findConflicts } from "../solver/conflicts";
import type { Grid } from "../types";

export const RETAKE_CONFLICT_CELLS = 8;
export const RETAKE_MEAN_CONFIDENCE = 0.8;

export type RetakeCheck = {
  retake: boolean;
  reason?: "conflicts" | "confidence";
  conflictCells: number;
  /** Mean confidence over cells read as digits (1 if none). */
  meanConfidence: number;
};

/** Whether a scan (before repair) should be retaken rather than reviewed. */
export function checkRetake(grid: Grid, confidence: number[][]): RetakeCheck {
  const conflictCells = findConflicts(grid).length;
  const digits = grid.flatMap((row, r) => row.flatMap((v, c) => (v ? [confidence[r][c]] : [])));
  const meanConfidence = digits.length ? digits.reduce((a, b) => a + b, 0) / digits.length : 1;
  const reason =
    conflictCells >= RETAKE_CONFLICT_CELLS
      ? "conflicts"
      : meanConfidence < RETAKE_MEAN_CONFIDENCE
        ? "confidence"
        : undefined;
  return { retake: reason !== undefined, reason, conflictCells, meanConfidence };
}
