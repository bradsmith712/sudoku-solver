import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Grid } from "../types";
import { solve } from "./solver";

type Fixture = { name: string; category: string; expected: string; grid: Grid; solution?: Grid };

const dir = new URL("../../tests/fixtures/solver/", import.meta.url);
const fixtures: Fixture[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Fixture);

const DIGITS = "123456789";

/** Independent validity check: every row, column and box is a permutation of 1-9. */
function isValidSolution(g: Grid): boolean {
  const ok = (cells: number[]) => [...cells].sort().join("") === DIGITS;
  for (let i = 0; i < 9; i++) {
    if (!ok(g[i])) return false;
    if (!ok(g.map((row) => row[i]))) return false;
    const [bi, bj] = [Math.floor(i / 3) * 3, (i % 3) * 3];
    const box = [0, 1, 2].flatMap((a) => [0, 1, 2].map((b) => g[bi + a][bj + b]));
    if (!ok(box)) return false;
  }
  return true;
}

const empty = (): Grid => Array.from({ length: 9 }, () => new Array<number>(9).fill(0));

describe("fixtures", () => {
  it("has at least 50 fixtures covering every category", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(50);
    const cats = new Set(fixtures.map((f) => f.category));
    for (const c of ["easy", "medium", "hard", "invalid", "unsolvable", "multiple"])
      expect(cats.has(c)).toBe(true);
  });

  for (const f of fixtures) {
    it(`${f.name} -> ${f.expected}`, () => {
      const before = JSON.stringify(f.grid);
      const res = solve(f.grid);
      expect(res.status).toBe(f.expected);
      expect(JSON.stringify(f.grid)).toBe(before); // input not mutated
      if (f.expected === "solved") {
        expect(res.solution).toEqual(f.solution);
      } else {
        expect(res.solution).toBeUndefined();
      }
    });
  }
});

describe("property: solutions are valid and preserve givens", () => {
  for (const f of fixtures.filter((x) => x.expected === "solved")) {
    it(f.name, () => {
      const { solution } = solve(f.grid);
      expect(solution).toBeDefined();
      const s = solution as Grid;
      expect(isValidSolution(s)).toBe(true);
      for (let i = 0; i < 9; i++)
        for (let j = 0; j < 9; j++) if (f.grid[i][j] !== 0) expect(s[i][j]).toBe(f.grid[i][j]);
    });
  }
});

describe("edge cases", () => {
  it("rejects malformed grids as invalid", () => {
    expect(solve([]).status).toBe("invalid");
    expect(solve(empty().slice(0, 8)).status).toBe("invalid");
    const shortRow = empty();
    shortRow[3] = [0, 0, 0];
    expect(solve(shortRow).status).toBe("invalid");
    const tooBig = empty();
    tooBig[0][0] = 10;
    expect(solve(tooBig).status).toBe("invalid");
    const negative = empty();
    negative[0][0] = -1;
    expect(solve(negative).status).toBe("invalid");
    const fractional = empty();
    fractional[0][0] = 1.5;
    expect(solve(fractional).status).toBe("invalid");
  });

  it("returns multiple for an empty grid and never a solution", () => {
    expect(solve(empty())).toEqual({ status: "multiple" });
  });

  it("returns the grid unchanged when already complete", () => {
    const full = fixtures.find((f) => f.expected === "solved")?.solution as Grid;
    expect(solve(full)).toEqual({ status: "solved", solution: full });
  });

  it("flags a completely filled grid with a duplicate as invalid", () => {
    const full = (fixtures.find((f) => f.expected === "solved")?.solution as Grid).map((r) => [
      ...r,
    ]);
    full[0][0] = full[0][1];
    expect(solve(full).status).toBe("invalid");
  });
});

describe("benchmark", () => {
  it("solves the hardest fixture in under 100 ms", () => {
    const solvable = fixtures.filter((f) => f.expected === "solved");
    for (const f of solvable) solve(f.grid); // warm up the JIT
    let worst = { name: "", ms: 0 };
    for (const f of solvable) {
      const t0 = performance.now();
      solve(f.grid);
      const ms = performance.now() - t0;
      if (ms > worst.ms) worst = { name: f.name, ms };
    }
    console.log(`slowest solvable fixture: ${worst.name} ${worst.ms.toFixed(2)} ms`);
    expect(worst.ms).toBeLessThan(100);
  });

  it("detects multiple solutions in under 100 ms", () => {
    const t0 = performance.now();
    for (const f of fixtures.filter((x) => x.expected === "multiple")) solve(f.grid);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
