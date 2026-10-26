import type { Grid } from "../types";

export type Cell = { row: number; col: number };

/**
 * Cells that share a row, column or box with an equal digit, in row-major order.
 * Blanks (0) never conflict. Does not mutate `grid`.
 */
export function findConflicts(grid: Grid): Cell[] {
  const bad = Array.from({ length: 9 }, () => new Array<boolean>(9).fill(false));
  const units: Cell[][] = [];
  for (let k = 0; k < 9; k++) {
    const [br, bc] = [Math.floor(k / 3) * 3, (k % 3) * 3];
    units.push(Array.from({ length: 9 }, (_, i) => ({ row: k, col: i })));
    units.push(Array.from({ length: 9 }, (_, i) => ({ row: i, col: k })));
    units.push(
      Array.from({ length: 9 }, (_, i) => ({ row: br + Math.floor(i / 3), col: bc + (i % 3) })),
    );
  }
  for (const unit of units) {
    const seen = new Map<number, Cell>();
    for (const cell of unit) {
      const v = grid[cell.row][cell.col];
      if (!v) continue;
      const prev = seen.get(v);
      if (prev) {
        bad[prev.row][prev.col] = true;
        bad[cell.row][cell.col] = true;
      } else seen.set(v, cell);
    }
  }
  const out: Cell[] = [];
  for (let row = 0; row < 9; row++)
    for (let col = 0; col < 9; col++) if (bad[row][col]) out.push({ row, col });
  return out;
}
