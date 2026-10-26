/**
 * Hint: the next step for the board as it stands (givens plus anything the user has
 * filled in), without applying it. Pure; app.ts shows it and selects its cell.
 */
import { solve, type SolveStatus } from "../../solver/solver";
import { generateSteps, type Cell, type Step } from "../../solver/steps";
import type { Grid } from "../../types";

export type Hint =
  { status: Exclude<SolveStatus, "solved"> } | { status: "solved"; step: Step | null };

export function nextHint(grid: Grid): Hint {
  const { status } = solve(grid);
  if (status !== "solved") return { status };
  return { status, step: generateSteps(grid)[0] ?? null };
}

/** The cell to select: the placement, else the first pattern cell. */
export function hintCell(step: Step): Cell {
  return step.placements[0] ?? step.highlight.cells[0];
}

/** "Hint · Hidden single at row 3, column 8: In box 3, 7 can only go in this cell: …" */
export function hintText(step: Step): string {
  const p = step.placements[0];
  const where = p ? ` at row ${p.row + 1}, column ${p.col + 1}` : "";
  return `Hint · ${step.title}${where}: ${step.explanation}`;
}
