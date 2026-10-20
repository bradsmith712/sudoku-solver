import type { Grid } from "../types";

export type SolveStatus = "solved" | "invalid" | "unsolvable" | "multiple";
export type SolveResult = { status: SolveStatus; solution?: Grid };

const ALL = 0x1ff; // bits 0-8 represent digits 1-9

const ROW = new Uint8Array(81);
const COL = new Uint8Array(81);
const BOX = new Uint8Array(81);
for (let i = 0; i < 81; i++) {
  ROW[i] = Math.floor(i / 9);
  COL[i] = i % 9;
  BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3);
}

/** The 27 units (9 rows, 9 columns, 9 boxes), each as a list of 9 cell indices. */
const UNITS: number[][] = Array.from({ length: 27 }, () => []);
for (let i = 0; i < 81; i++) {
  UNITS[ROW[i]].push(i);
  UNITS[9 + COL[i]].push(i);
  UNITS[18 + BOX[i]].push(i);
}

const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const set = new Set<number>();
  for (const u of [ROW[i], 9 + COL[i], 18 + BOX[i]])
    for (const c of UNITS[u]) if (c !== i) set.add(c);
  return [...set];
});

function popcount(x: number): number {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

function isValidShape(grid: Grid): boolean {
  if (!Array.isArray(grid) || grid.length !== 9) return false;
  return grid.every(
    (row) =>
      Array.isArray(row) &&
      row.length === 9 &&
      row.every((v) => Number.isInteger(v) && v >= 0 && v <= 9),
  );
}

/** True if no digit repeats in any row, column or box. */
export function hasNoDuplicates(grid: Grid): boolean {
  for (const unit of UNITS) {
    let seen = 0;
    for (const i of unit) {
      const v = grid[ROW[i]][COL[i]];
      if (v === 0) continue;
      const bit = 1 << (v - 1);
      if (seen & bit) return false;
      seen |= bit;
    }
  }
  return true;
}

/**
 * Assign `digit` to `cell` and propagate (naked and hidden singles).
 * Mutates `cands`; returns false on contradiction.
 */
function assign(cands: Uint16Array, cell: number, digit: number): boolean {
  const queue: number[] = [cell, digit];
  while (queue.length) {
    const d = queue.pop() as number;
    const c = queue.pop() as number;
    const bit = 1 << d;
    if (!(cands[c] & bit)) return false;
    cands[c] = bit;
    for (const p of PEERS[c]) {
      if (cands[p] & bit) {
        cands[p] &= ~bit;
        if (cands[p] === 0) return false;
        if ((cands[p] & (cands[p] - 1)) === 0) queue.push(p, Math.log2(cands[p]));
      }
    }
    // Hidden singles in the units of c.
    for (const u of [ROW[c], 9 + COL[c], 18 + BOX[c]]) {
      for (let d2 = 0; d2 < 9; d2++) {
        const b2 = 1 << d2;
        let count = 0;
        let place = -1;
        for (const i of UNITS[u]) {
          if (cands[i] & b2) {
            count++;
            place = i;
          }
        }
        if (count === 0) return false;
        if (count === 1 && cands[place] !== b2) queue.push(place, d2);
      }
    }
  }
  return true;
}

/** Depth-first search collecting up to `limit` solutions. */
function search(cands: Uint16Array, found: Uint16Array[], limit: number): void {
  let best = -1;
  let bestCount = 10;
  for (let i = 0; i < 81; i++) {
    const n = popcount(cands[i]);
    if (n > 1 && n < bestCount) {
      best = i;
      bestCount = n;
      if (n === 2) break;
    }
  }
  if (best === -1) {
    found.push(cands.slice());
    return;
  }
  for (let d = 0; d < 9 && found.length < limit; d++) {
    if (!(cands[best] & (1 << d))) continue;
    const next = cands.slice();
    if (assign(next, best, d)) search(next, found, limit);
  }
}

/**
 * Solve a sudoku. Does not mutate `grid`.
 * - "invalid": malformed grid (not 9x9 of integers 0-9) or duplicate in a row, column or box.
 * - "unsolvable": no solution exists.
 * - "multiple": at least two solutions (counting stops at 2); no solution is returned.
 * - "solved": exactly one solution, returned in `solution`.
 */
export function solve(grid: Grid): SolveResult {
  if (!isValidShape(grid) || !hasNoDuplicates(grid)) return { status: "invalid" };

  const cands = new Uint16Array(81).fill(ALL);
  for (let i = 0; i < 81; i++) {
    const v = grid[ROW[i]][COL[i]];
    if (v !== 0 && !assign(cands, i, v - 1)) return { status: "unsolvable" };
  }

  const found: Uint16Array[] = [];
  search(cands, found, 2);
  if (found.length === 0) return { status: "unsolvable" };
  if (found.length > 1) return { status: "multiple" };

  const solution: Grid = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  for (let i = 0; i < 81; i++) solution[ROW[i]][COL[i]] = Math.log2(found[0][i]) + 1;
  return { status: "solved", solution };
}
