import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Grid } from "../types";
import { solve } from "./solver";
import {
  candidatesAt,
  FALLBACK_EXPLANATION,
  generateSteps,
  type Step,
  type Technique,
} from "./steps";

type Fixture = { name: string; category: string; expected: string; grid: Grid; solution?: Grid };
type Puzzle = { name: string; category: string; grid: Grid; solution: Grid };

const dir = new URL("../../tests/fixtures/solver/", import.meta.url);
const fixtures: Fixture[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Fixture);
const solvable: Puzzle[] = fixtures
  .filter((f) => f.expected === "solved")
  .map((f) => ({ name: f.name, category: f.category, grid: f.grid, solution: f.solution as Grid }));

// Real-photo grids (gitignored; absent in CI). Used only as a correctness check, never to tune.
const realDir = new URL("../../tests/fixtures/real/", import.meta.url);
const real: Puzzle[] = existsSync(realDir)
  ? readdirSync(realDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => JSON.parse(readFileSync(new URL(f, realDir), "utf8")))
      .map((j: { puzzleId: string; split: string; grid: Grid }) => ({
        name: j.puzzleId,
        category: `real-${j.split}`,
        grid: j.grid,
        solution: solve(j.grid).solution as Grid,
      }))
  : [];

// ---- independent checker: plain arrays, written without reference to steps.ts ----

type RC = [number, number];
type UnitRef = { kind: "row" | "col" | "box"; index: number; cells: RC[] };

const UNITS: UnitRef[] = [];
for (let k = 0; k < 9; k++) {
  UNITS.push({ kind: "row", index: k, cells: [...Array(9).keys()].map((c): RC => [k, c]) });
  UNITS.push({ kind: "col", index: k, cells: [...Array(9).keys()].map((r): RC => [r, k]) });
  const [r0, c0] = [Math.floor(k / 3) * 3, (k % 3) * 3];
  UNITS.push({
    kind: "box",
    index: k,
    cells: [...Array(9).keys()].map((n): RC => [r0 + Math.floor(n / 3), c0 + (n % 3)]),
  });
}
const unitAt = (kind: string, index: number) =>
  UNITS.find((u) => u.kind === kind && u.index === index) as UnitRef;
const boxOf = (r: number, c: number) => Math.floor(r / 3) * 3 + Math.floor(c / 3);
const inUnit = (u: UnitRef, r: number, c: number) =>
  u.kind === "row" ? r === u.index : u.kind === "col" ? c === u.index : boxOf(r, c) === u.index;
const same = <T>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const key = (r: number, c: number) => `${r},${c}`;

class Checker {
  grid: Grid;
  /** "r,c" -> digits removed by elimination steps. */
  removed = new Map<string, Set<number>>();
  cand: number[][][] = [];

  constructor(givens: Grid) {
    this.grid = givens.map((row) => [...row]);
    this.recompute();
  }

  recompute() {
    this.cand = this.grid.map((row, r) =>
      row.map((v, c) => {
        if (v) return [];
        const out: number[] = [];
        for (let d = 1; d <= 9; d++) {
          if (this.grid[r].includes(d)) continue;
          if (this.grid.some((rr) => rr[c] === d)) continue;
          if (unitAt("box", boxOf(r, c)).cells.some(([a, b]) => this.grid[a][b] === d)) continue;
          if (this.removed.get(key(r, c))?.has(d)) continue;
          out.push(d);
        }
        return out;
      }),
    );
  }

  placedIn = (u: UnitRef, d: number) => u.cells.some(([r, c]) => this.grid[r][c] === d);
  spots = (u: UnitRef, d: number) => u.cells.filter(([r, c]) => this.cand[r][c].includes(d));

  hasNakedSingle = () => this.cand.some((row) => row.some((cs) => cs.length === 1));

  hasHiddenSingle = () =>
    UNITS.some((u) =>
      [1, 2, 3, 4, 5, 6, 7, 8, 9].some(
        (d) => !this.placedIn(u, d) && this.spots(u, d).length === 1,
      ),
    );

  hasBoxLine = () =>
    UNITS.some((u) =>
      [1, 2, 3, 4, 5, 6, 7, 8, 9].some((d) => {
        const sp = this.spots(u, d);
        if (sp.length < 2) return false;
        // Every other unit containing all the spots: any candidate there outside u is removable.
        return UNITS.some(
          (v) =>
            v !== u &&
            sp.every(([r, c]) => inUnit(v, r, c)) &&
            this.spots(v, d).some(([r, c]) => !inUnit(u, r, c)),
        );
      }),
    );

  hasNakedPair = () =>
    UNITS.some((u) => {
      const twos = u.cells.filter(([r, c]) => this.cand[r][c].length === 2);
      return twos.some(([r1, c1], i) =>
        twos.slice(i + 1).some(([r2, c2]) => {
          const pair = this.cand[r1][c1];
          if (!same(pair, this.cand[r2][c2])) return false;
          return u.cells.some(
            ([r, c]) =>
              !(r === r1 && c === c1) &&
              !(r === r2 && c === c2) &&
              this.cand[r][c].some((d) => pair.includes(d)),
          );
        }),
      );
    });

  hasHiddenPair = () =>
    UNITS.some((u) => {
      const byDigit = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) =>
        this.spots(u, d).map(([r, c]) => key(r, c)),
      );
      for (let p = 0; p < 9; p++)
        for (let q = p + 1; q < 9; q++) {
          if (byDigit[p].length !== 2 || !same(byDigit[p], byDigit[q])) continue;
          const extra = byDigit[p].some((k) => {
            const [r, c] = k.split(",").map(Number);
            return this.cand[r][c].some((d) => d !== p + 1 && d !== q + 1);
          });
          if (extra) return true;
        }
      return false;
    });

  apply(step: Step) {
    for (const p of step.placements) this.grid[p.row][p.col] = p.digit;
    for (const e of step.eliminations) {
      const s = this.removed.get(key(e.row, e.col)) ?? new Set<number>();
      e.digits.forEach((d) => s.add(d));
      this.removed.set(key(e.row, e.col), s);
    }
    this.recompute();
  }
}

const TIER: Record<Technique, number> = {
  "naked-single": 1,
  "hidden-single": 2,
  pointing: 3,
  claiming: 3,
  "naked-pair": 4,
  "hidden-pair": 5,
  fallback: 6,
};

/** Parse "1, 2, 5, and 7" / "7 or 9" into numbers. */
const nums = (s: string) => (s.match(/\d/g) ?? []).map(Number);
const WORD_KIND: Record<string, "row" | "col" | "box"> = { row: "row", column: "col", box: "box" };

/** Throws (via expect) unless `step` is a true, simplest-available move on `ck`'s board. */
function checkStep(ck: Checker, step: Step, solution: Grid, where: string) {
  const ctx = `${where} (${step.technique}): ${step.explanation}`;
  const tier = TIER[step.technique];
  const lower = [
    ck.hasNakedSingle,
    ck.hasHiddenSingle,
    ck.hasBoxLine,
    ck.hasNakedPair,
    ck.hasHiddenPair,
  ];
  for (let t = 1; t < tier; t++)
    expect(lower[t - 1](), `${ctx}: tier ${t} was available`).toBe(false);

  expect(step.placements.length + step.eliminations.length, ctx).toBeGreaterThan(0);
  expect(step.placements.length, ctx).toBeLessThanOrEqual(1);
  for (const p of step.placements) {
    expect(ck.grid[p.row][p.col], `${ctx}: placed on a filled cell`).toBe(0);
    expect(p.digit, `${ctx}: placement differs from the solution`).toBe(solution[p.row][p.col]);
  }
  for (const e of step.eliminations) {
    expect(e.digits.length, ctx).toBeGreaterThan(0);
    for (const d of e.digits) {
      expect(ck.cand[e.row][e.col], `${ctx}: removed a non-candidate`).toContain(d);
      expect(d, `${ctx}: removed the solution digit`).not.toBe(solution[e.row][e.col]);
    }
  }
  const units = step.highlight.units.map((u) => unitAt(u.kind, u.index));
  const pattern = step.highlight.cells.map((c): RC => [c.row, c.col]);
  const keys = (cs: RC[]) => cs.map(([r, c]) => key(r, c)).sort();
  const elimDigits = [...new Set(step.eliminations.flatMap((e) => e.digits))];

  switch (step.technique) {
    case "naked-single": {
      const { row, col, digit } = step.placements[0];
      expect(ck.cand[row][col], ctx).toEqual([digit]);
      expect(step.explanation.endsWith(`this cell can only be ${digit}.`), ctx).toBe(true);
      // Every digit the text says a unit holds is really there; with any earlier
      // eliminations they cover every digit but the answer.
      const mentioned = new Set<number>();
      for (const clause of step.explanation.replace(/, so this cell.*$/, "").split("; ")) {
        const m = clause.match(/^(row|column|box) (\d) (?:already contains|adds) (.+)$/i);
        if (m) {
          const u = unitAt(WORD_KIND[m[1].toLowerCase()], Number(m[2]) - 1);
          expect(inUnit(u, row, col), ctx).toBe(true);
          for (const d of nums(m[3])) {
            expect(ck.placedIn(u, d), `${ctx}: ${d} not in ${m[1]} ${m[2]}`).toBe(true);
            mentioned.add(d);
          }
          continue;
        }
        const e = clause.match(/^earlier steps ruled out (.+)$/i);
        expect(e, `${ctx}: unexpected clause "${clause}"`).not.toBeNull();
        for (const d of nums((e as RegExpMatchArray)[1])) {
          expect(ck.removed.get(key(row, col))?.has(d), ctx).toBe(true);
          mentioned.add(d);
        }
      }
      expect([...mentioned].sort(), ctx).toEqual(
        [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => d !== digit),
      );
      break;
    }
    case "hidden-single": {
      const { row, col, digit } = step.placements[0];
      expect(units.length, ctx).toBe(1);
      const [u] = units;
      expect(ck.placedIn(u, digit), ctx).toBe(false);
      expect(keys(ck.spots(u, digit)), ctx).toEqual([key(row, col)]);
      const word = u.kind === "col" ? "column" : u.kind;
      expect(
        step.explanation.startsWith(`In ${word} ${u.index + 1}, ${digit} can only go`),
        ctx,
      ).toBe(true);
      // The units named as blockers really hold the digit, and they (or earlier
      // eliminations, if the text says so) rule out every other empty cell.
      const see = step.explanation.match(/already see a \d in (.+?)(?: or had|\.$)/);
      const blockers: UnitRef[] = [];
      for (const g of see?.[1].split(" or in ") ?? []) {
        const m = g.match(/^(row|column|box)s? (.+)$/) as RegExpMatchArray;
        for (const n of nums(m[2])) blockers.push(unitAt(WORD_KIND[m[1]], n - 1));
      }
      for (const b of blockers) expect(ck.placedIn(b, digit), ctx).toBe(true);
      const viaElim = step.explanation.includes("ruled out by an earlier step");
      for (const [r, c] of u.cells) {
        if ((r === row && c === col) || ck.grid[r][c]) continue;
        const blocked = blockers.some((b) => inUnit(b, r, c));
        const removed = !!ck.removed.get(key(r, c))?.has(digit);
        expect(blocked || (viaElim && removed), `${ctx}: cell ${r},${c} unexplained`).toBe(true);
      }
      break;
    }
    case "pointing":
    case "claiming": {
      expect(elimDigits.length, ctx).toBe(1);
      const d = elimDigits[0];
      const [from, to] = units; // pointing: [box, line]; claiming: [line, box]
      expect(from.kind === "box", ctx).toBe(step.technique === "pointing");
      expect(keys(ck.spots(from, d)), ctx).toEqual(keys(pattern));
      expect(
        pattern.every(([r, c]) => inUnit(to, r, c)),
        ctx,
      ).toBe(true);
      for (const e of step.eliminations) {
        expect(inUnit(to, e.row, e.col) && !inUnit(from, e.row, e.col), ctx).toBe(true);
      }
      break;
    }
    case "naked-pair": {
      expect(units.length, ctx).toBe(1);
      expect(pattern.length, ctx).toBe(2);
      const [[r1, c1], [r2, c2]] = pattern;
      const pair = ck.cand[r1][c1];
      expect(pair.length, ctx).toBe(2);
      expect(ck.cand[r2][c2], ctx).toEqual(pair);
      expect(
        pattern.every(([r, c]) => inUnit(units[0], r, c)),
        ctx,
      ).toBe(true);
      for (const e of step.eliminations) {
        expect(inUnit(units[0], e.row, e.col), ctx).toBe(true);
        expect(keys(pattern), ctx).not.toContain(key(e.row, e.col));
        for (const d of e.digits) expect(pair, ctx).toContain(d);
      }
      break;
    }
    case "hidden-pair": {
      expect(units.length, ctx).toBe(1);
      const [u] = units;
      const confined = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) =>
        same(keys(ck.spots(u, d)), keys(pattern)),
      );
      expect(pattern.length, ctx).toBe(2);
      expect(confined.length, ctx).toBe(2);
      for (const e of step.eliminations) {
        expect(keys(pattern), ctx).toContain(key(e.row, e.col));
        for (const d of e.digits) expect(confined, ctx).not.toContain(d);
      }
      break;
    }
    case "fallback":
      expect(step.explanation, ctx).toBe(FALLBACK_EXPLANATION);
      expect(step.placements.length, ctx).toBe(1);
      break;
  }
}

/** Replays every step through the checker; returns the final board. */
function replay(p: Puzzle, steps: Step[]): Grid {
  const ck = new Checker(p.grid);
  steps.forEach((s, k) => {
    checkStep(ck, s, p.solution, `${p.name} step ${k + 1}`);
    ck.apply(s);
  });
  return ck.grid;
}

// ---- seeded symmetry variants (relabel, transpose, band/stack and row/column shuffles) ----

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A line order that keeps bands together: shuffled bands, shuffled lines inside each. */
const lineOrder = (rand: () => number) =>
  shuffle([0, 1, 2], rand).flatMap((b) => shuffle([0, 1, 2], rand).map((k) => b * 3 + k));

function variant(p: Puzzle, n: number, rand: () => number): Puzzle {
  const digits = [0, ...shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rand)];
  const rows = lineOrder(rand);
  const cols = lineOrder(rand);
  const flip = rand() < 0.5;
  const map = (g: Grid): Grid => rows.map((r) => cols.map((c) => digits[flip ? g[c][r] : g[r][c]]));
  return {
    name: `${p.name}~v${n}`,
    category: p.category,
    grid: map(p.grid),
    solution: map(p.solution),
  };
}

// ---- tests ----

describe("generateSteps", () => {
  it("covers every solvable fixture", () => {
    expect(solvable.length).toBe(33);
  });

  for (const p of [...solvable, ...real]) {
    it(`${p.name}: every step checks out and replay reaches the solution`, () => {
      const before = JSON.stringify(p.grid);
      const steps = generateSteps(p.grid);
      expect(JSON.stringify(p.grid)).toBe(before); // input not mutated
      expect(replay(p, steps)).toEqual(p.solution);
    });
  }

  it("is deterministic", () => {
    for (const p of solvable) expect(generateSteps(p.grid)).toEqual(generateSteps(p.grid));
  });

  it("throws for grids without exactly one solution", () => {
    for (const f of fixtures.filter((x) => x.expected !== "solved")) {
      expect(() => generateSteps(f.grid), f.name).toThrow(RangeError);
    }
  });

  it("returns no steps for a complete grid", () => {
    expect(generateSteps(solvable[0].solution)).toEqual([]);
  });
});

describe("property: steps never place a wrong digit or remove a right one", () => {
  const rand = mulberry32(20261026);
  const variants = Array.from({ length: 6 }, (_, n) =>
    solvable.map((p) => variant(p, n, rand)),
  ).flat();

  it(`holds on ${variants.length} symmetry variants`, () => {
    expect(variants.length).toBeGreaterThanOrEqual(198);
    for (const v of variants) expect(replay(v, generateSteps(v.grid))).toEqual(v.solution);
  });
});

/** Fixtures solved by logic alone when this report was first run; must not drop. */
const LOGIC_ONLY_FLOOR = 30;

describe("report", () => {
  it("logic-only coverage, fallback puzzles, technique counts and timing", () => {
    const totals: Partial<Record<Technique, number>> = {};
    const byCategory = new Map<string, { n: number; logic: number }>();
    const needFallback: string[] = [];
    let logicOnly = 0;
    for (const p of [...solvable, ...real]) {
      const steps = generateSteps(p.grid);
      for (const s of steps) totals[s.technique] = (totals[s.technique] ?? 0) + 1;
      const fallbacks = steps.filter((s) => s.technique === "fallback").length;
      const cat = byCategory.get(p.category) ?? { n: 0, logic: 0 };
      cat.n++;
      if (fallbacks) needFallback.push(`${p.name} (${fallbacks} of ${steps.length} steps)`);
      else {
        cat.logic++;
        if (!p.category.startsWith("real")) logicOnly++;
      }
      byCategory.set(p.category, cat);
    }

    for (const p of solvable) generateSteps(p.grid); // warm up the JIT
    let worst = { name: "", ms: 0 };
    for (const p of solvable) {
      const runs = Array.from({ length: 5 }, () => {
        const t0 = performance.now();
        generateSteps(p.grid);
        return performance.now() - t0;
      }).sort((a, b) => a - b);
      if (runs[2] > worst.ms) worst = { name: p.name, ms: runs[2] };
    }

    const lines = [
      `logic only: ${logicOnly}/${solvable.length} fixtures`,
      ...[...byCategory].map(([c, v]) => `  ${c}: ${v.logic}/${v.n}`),
      `need the fallback: ${needFallback.join(", ") || "none"}`,
      `techniques: ${JSON.stringify(totals)}`,
      `slowest generateSteps (median of 5): ${worst.name} ${worst.ms.toFixed(2)} ms`,
    ];
    console.log(lines.join("\n"));
    expect(logicOnly).toBeGreaterThanOrEqual(LOGIC_ONLY_FLOOR);
    expect(worst.ms).toBeLessThan(100);
  });
});

describe("candidatesAt", () => {
  it("matches the checker's candidates before every step", () => {
    for (const p of solvable
      .slice(0, 5)
      .concat(solvable.filter((x) => x.name === "hard-known-01"))) {
      const steps = generateSteps(p.grid);
      const ck = new Checker(p.grid);
      steps.forEach((s, n) => {
        const target = s.placements[0] ?? s.eliminations[0];
        expect(candidatesAt(p.grid, steps, n, target), `${p.name} step ${n + 1}`).toEqual(
          ck.cand[target.row][target.col],
        );
        ck.apply(s);
      });
    }
  });
});
