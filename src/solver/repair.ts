/**
 * Repair confident misreads. A scanned grid that is invalid, unsolvable or has
 * several solutions almost always holds a misread digit, and the model's runner-up
 * digit is usually the right one. Try swapping the least certain digit cells to their
 * runner-up, one, two, then three at a time, and accept a swap set only if the grid
 * then has exactly one solution. Pure; no DOM, no vision code.
 */
import type { Grid } from "../types";
import { findConflicts } from "./conflicts";
import { solve, type SolveStatus } from "./solver";

export type Change = { row: number; col: number; from: number; to: number };

export type RepairOptions = {
  /** How many of the lowest-margin digit cells to consider (conflicting cells are always added). */
  pool?: number;
  /** Largest number of cells swapped at once. */
  maxSwaps?: number;
};

export type RepairResult = {
  /** The repaired grid, or a copy of the input when no repair was needed or found. */
  grid: Grid;
  /** Cells swapped to their runner-up digit; empty when nothing changed. */
  changed: Change[];
  /** solve() status of `grid`. */
  status: SolveStatus;
  solution?: Grid;
  /** Candidate grids solved (for timing reports). */
  tried: number;
};

/**
 * Checked on the 240 synthetic boards and 10 split=train photos only (end-to-end
 * scans at 1024 px): every pool from 2 to 20 repaired the same board with no wrong
 * repair and at most 4 ms per board, so 10 leaves headroom for real misreads that
 * rank lower.
 */
export const REPAIR_POOL = 10;
export const REPAIR_MAX_SWAPS = 3;

function* combinations<T>(items: T[], k: number, start = 0): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = start; i <= items.length - k; i++)
    for (const rest of combinations(items, k - 1, i + 1)) yield [items[i], ...rest];
}

/**
 * Repair `grid` using each digit cell's runner-up digit (`second`, 0 = none) and
 * top-two margin (`margin`, lower = less certain). Among swap sets of the smallest
 * size that yields a unique solution, the one with the lowest summed margin wins.
 * A grid that already has a unique solution is returned unchanged.
 */
export function repair(
  grid: Grid,
  margin: number[][],
  second: Grid,
  { pool = REPAIR_POOL, maxSwaps = REPAIR_MAX_SWAPS }: RepairOptions = {},
): RepairResult {
  const copy = () => grid.map((row) => [...row]);
  const first = solve(grid);
  if (first.status === "solved") return { grid: copy(), changed: [], ...first, tried: 1 };

  const swappable = (r: number, c: number) => grid[r][c] !== 0 && second[r]?.[c] > 0;
  const cells: { row: number; col: number; margin: number }[] = [];
  grid.forEach((row, r) =>
    row.forEach((_, c) => swappable(r, c) && cells.push({ row: r, col: c, margin: margin[r][c] })),
  );
  cells.sort((a, b) => a.margin - b.margin);
  const chosen = new Set(cells.slice(0, pool));
  for (const { row, col } of findConflicts(grid)) {
    const cell = cells.find((x) => x.row === row && x.col === col);
    if (cell) chosen.add(cell);
  }
  const candidates = [...chosen];

  let tried = 1;
  for (let k = 1; k <= maxSwaps; k++) {
    let best: { set: typeof candidates; cost: number; grid: Grid; solution: Grid } | null = null;
    for (const set of combinations(candidates, k)) {
      const g = copy();
      for (const { row, col } of set) g[row][col] = second[row][col];
      tried++;
      const res = solve(g);
      if (res.status !== "solved" || !res.solution) continue;
      const cost = set.reduce((sum, x) => sum + x.margin, 0);
      if (!best || cost < best.cost) best = { set, cost, grid: g, solution: res.solution };
    }
    if (best) {
      const changed = best.set
        .map(({ row, col }) => ({ row, col, from: grid[row][col], to: second[row][col] }))
        .sort((a, b) => a.row - b.row || a.col - b.col);
      return { grid: best.grid, changed, status: "solved", solution: best.solution, tried };
    }
  }
  return { grid: copy(), changed: [], status: first.status, tried };
}
