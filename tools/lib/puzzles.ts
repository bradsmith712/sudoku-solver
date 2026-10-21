/**
 * Shared offline helpers for generating sudoku puzzles. Deterministic (seeded PRNG).
 * Never imported by src.
 */
import { solve } from "../../src/solver/solver";
import type { Grid } from "../../src/types";

/** Seeded PRNG (mulberry32), returns floats in [0, 1). */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(a: T[], r: () => number): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Random complete grid: shuffled canonical pattern. */
export function randomSolution(r: () => number): Grid {
  const bands = shuffle([0, 1, 2], r);
  const rows = bands.flatMap((b) => shuffle([0, 1, 2], r).map((x) => b * 3 + x));
  const stacks = shuffle([0, 1, 2], r);
  const cols = stacks.flatMap((s) => shuffle([0, 1, 2], r).map((x) => s * 3 + x));
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], r);
  return rows.map((rr) => cols.map((cc) => digits[((rr % 3) * 3 + Math.floor(rr / 3) + cc) % 9]));
}

export const clone = (g: Grid): Grid => g.map((row) => [...row]);
export const clues = (g: Grid) => g.flat().filter((v) => v !== 0).length;

/** Remove cells in random order while the puzzle stays unique, until `target` clues remain. */
export function dig(full: Grid, target: number, r: () => number): Grid {
  const g = clone(full);
  for (const idx of shuffle([...Array(81).keys()], r)) {
    if (clues(g) <= target) break;
    const [i, j] = [Math.floor(idx / 9), idx % 9];
    const keep = g[i][j];
    g[i][j] = 0;
    if (solve(g).status !== "solved") g[i][j] = keep;
  }
  return g;
}
