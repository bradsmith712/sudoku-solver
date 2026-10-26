import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Grid } from "../types";
import { repair } from "./repair";
import { solve } from "./solver";

type Fixture = { grid: Grid; solution: Grid };
const load = (name: string): Fixture =>
  JSON.parse(
    readFileSync(new URL(`../../tests/fixtures/solver/${name}.json`, import.meta.url), "utf8"),
  ) as Fixture;

/**
 * A scan of `puzzle` with confident misreads at `cells`: each holds another given of
 * its row (so the grid is invalid), with the true digit as runner-up and a low margin.
 * Every other digit cell is sure (margin 0.95) with a wrong runner-up.
 */
function misread(puzzle: Grid, cells: [number, number][]) {
  const grid = puzzle.map((row) => [...row]);
  const margin = puzzle.map((row) => row.map((v) => (v ? 0.95 : 1)));
  const second = puzzle.map((row) => row.map((v) => (v ? (v % 9) + 1 : 0)));
  cells.forEach(([r, c], i) => {
    const wrong = puzzle[r].find((v, cc) => v && cc !== c && v !== puzzle[r][c])!;
    grid[r][c] = wrong;
    second[r][c] = puzzle[r][c];
    margin[r][c] = 0.2 + 0.1 * i;
  });
  return { grid, margin, second };
}

/** The first given in each of the first `n` rows. */
const givens = (puzzle: Grid, n: number): [number, number][] =>
  puzzle.slice(0, n).map((row, r) => [r, row.findIndex((v) => v !== 0)]);

describe("repair", () => {
  const { grid: puzzle, solution } = load("easy-01");

  it("leaves a grid with a unique solution untouched", () => {
    const { margin, second } = misread(puzzle, []);
    const res = repair(puzzle, margin, second);
    expect(res.changed).toEqual([]);
    expect(res.grid).toEqual(puzzle);
    expect(res.status).toBe("solved");
  });

  for (const k of [1, 2, 3]) {
    it(`repairs ${k} confident misread${k > 1 ? "s" : ""} to the runner-up digit`, () => {
      const cells = givens(puzzle, k);
      const scan = misread(puzzle, cells);
      expect(solve(scan.grid).status).not.toBe("solved");
      const res = repair(scan.grid, scan.margin, scan.second);
      expect(res.status).toBe("solved");
      expect(res.grid).toEqual(puzzle);
      expect(res.solution).toEqual(solution);
      expect(res.changed).toEqual(
        cells.map(([row, col]) => ({ row, col, from: scan.grid[row][col], to: puzzle[row][col] })),
      );
    });
  }

  it("does not mutate its inputs", () => {
    const scan = misread(puzzle, givens(puzzle, 1));
    const before = JSON.stringify(scan);
    repair(scan.grid, scan.margin, scan.second);
    expect(JSON.stringify(scan)).toBe(before);
  });

  it("gives up without changes when no swap set gives a unique solution", () => {
    const scan = misread(puzzle, givens(puzzle, 1));
    const none = scan.grid.map((row) => row.map(() => 0));
    const res = repair(scan.grid, scan.margin, none);
    expect(res.changed).toEqual([]);
    expect(res.status).toBe("invalid");
    expect(res.grid).toEqual(scan.grid);
  });

  it("does not try more swaps than maxSwaps", () => {
    const scan = misread(puzzle, givens(puzzle, 3));
    const res = repair(scan.grid, scan.margin, scan.second, { maxSwaps: 2 });
    expect(res.changed).toEqual([]);
  });

  it("finishes the worst case (three swaps, full pool) quickly", () => {
    const { grid: hard } = load("hard-01");
    const scan = misread(hard, givens(hard, 3));
    // Every set of one, two and three pool cells is solved before the best triple is kept.
    const t = performance.now();
    const res = repair(scan.grid, scan.margin, scan.second);
    const ms = performance.now() - t;
    expect(res.status).toBe("solved");
    expect(ms).toBeLessThan(500);
  });
});
