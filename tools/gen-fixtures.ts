/**
 * Offline fixture generator. Run: npx vite-node tools/gen-fixtures.ts
 * Writes tests/fixtures/solver/*.json. Deterministic (seeded PRNG).
 * Never imported by src.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { solve } from "../src/solver/solver";
import type { Grid } from "../src/types";

const OUT = new URL("../tests/fixtures/solver/", import.meta.url).pathname;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(a: T[], r: () => number): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Random complete grid: shuffled canonical pattern. */
function randomSolution(r: () => number): Grid {
  const bands = shuffle([0, 1, 2], r);
  const rows = bands.flatMap((b) => shuffle([0, 1, 2], r).map((x) => b * 3 + x));
  const stacks = shuffle([0, 1, 2], r);
  const cols = stacks.flatMap((s) => shuffle([0, 1, 2], r).map((x) => s * 3 + x));
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], r);
  return rows.map((rr) => cols.map((cc) => digits[((rr % 3) * 3 + Math.floor(rr / 3) + cc) % 9]));
}

const clone = (g: Grid): Grid => g.map((row) => [...row]);
const clues = (g: Grid) => g.flat().filter((v) => v !== 0).length;

/** Remove cells in random order while the puzzle stays unique, until `target` clues remain. */
function dig(full: Grid, target: number, r: () => number): Grid {
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

const parse = (s: string): Grid =>
  Array.from({ length: 9 }, (_, i) =>
    [...s.slice(i * 9, i * 9 + 9)].map((c) => (c === "." || c === "0" ? 0 : Number(c))),
  );

type Fixture = { name: string; category: string; expected: string; grid: Grid; solution?: Grid };
const fixtures: Fixture[] = [];

function add(category: string, n: number, grid: Grid, expected: string) {
  const name = `${category}-${String(n).padStart(2, "0")}`;
  const res = solve(grid);
  if (res.status !== expected)
    throw new Error(`${name}: expected ${expected}, solver said ${res.status}`);
  fixtures.push({
    name,
    category,
    expected,
    grid,
    ...(res.solution && { solution: res.solution }),
  });
}

const r = rng(20261019);

// Solved by construction, so each is unique.
const targets = { easy: 40, medium: 32, hard: 25 } as const;
for (const [cat, target] of Object.entries(targets)) {
  for (let n = 1; n <= 10; n++) add(cat, n, dig(randomSolution(r), target, r), "solved");
}

// Well-known hard puzzles (unique solutions).
const known = [
  "8..........36......7..9.2...5...7.......457.....1...3...1....68..85...1..9....4..",
  "..............3.85..1.2.......5.7.....4...1...9.......5......73..2.1........4...9",
  "4.....8.5.3..........7......2.....6.....8.4......1.......6.3.7.5..2.....1.4......",
];
known.forEach((s, i) => add("hard-known", i + 1, parse(s), "solved"));

// Invalid: duplicate in a row, column or box.
for (let n = 1; n <= 9; n++) {
  const g = dig(randomSolution(r), 36, r);
  const kind = n % 3; // 0 row, 1 column, 2 box
  let done = false;
  for (let tries = 0; tries < 500 && !done; tries++) {
    const a = Math.floor(r() * 81);
    const b = Math.floor(r() * 81);
    const [ai, aj, bi, bj] = [Math.floor(a / 9), a % 9, Math.floor(b / 9), b % 9];
    if (a === b || g[bi][bj] !== 0) continue;
    const same =
      kind === 0
        ? ai === bi
        : kind === 1
          ? aj === bj
          : Math.floor(ai / 3) === Math.floor(bi / 3) && Math.floor(aj / 3) === Math.floor(bj / 3);
    if (!same || g[ai][aj] === 0) continue;
    g[bi][bj] = g[ai][aj];
    done = true;
  }
  if (!done) throw new Error("could not build invalid fixture");
  add("invalid", n, g, "invalid");
}

// Malformed shapes are covered in solver.test.ts; add value-range cases here is not possible in JSON-safe form.

// Unsolvable: no duplicates, but no solution. Change one given to another digit with no clash.
let uns = 0;
while (uns < 8) {
  const g = dig(randomSolution(r), 30, r);
  const filled = [...Array(81).keys()].filter((k) => g[Math.floor(k / 9)][k % 9] !== 0);
  const k = filled[Math.floor(r() * filled.length)];
  const [i, j] = [Math.floor(k / 9), k % 9];
  g[i][j] = ((g[i][j] + Math.floor(r() * 8)) % 9) + 1;
  if (solve(g).status === "unsolvable") add("unsolvable", ++uns, g, "unsolvable");
}
// Classic: a blank cell whose row holds 1-8 and whose column holds 9.
{
  const g = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  for (let c = 0; c < 8; c++) g[0][c] = c + 1;
  g[1][8] = 9;
  add("unsolvable", ++uns, g, "unsolvable");
}

// Multiple solutions: over-dug puzzles, plus the empty grid.
add(
  "multiple",
  1,
  Array.from({ length: 9 }, () => new Array<number>(9).fill(0)),
  "multiple",
);
let mult = 1;
while (mult < 8) {
  const full = randomSolution(r);
  const g = clone(full);
  for (const idx of shuffle([...Array(81).keys()], r)) {
    g[Math.floor(idx / 9)][idx % 9] = 0;
    if (solve(g).status === "multiple") break;
  }
  if (solve(g).status === "multiple") add("multiple", ++mult, g, "multiple");
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of fixtures) writeFileSync(`${OUT}${f.name}.json`, JSON.stringify(f) + "\n");
console.log(`wrote ${fixtures.length} fixtures to ${OUT}`);
