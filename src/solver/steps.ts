/**
 * Step-by-step solving: the moves a person could make, easiest first, from the givens
 * to the solution. Each step's explanation is built from the board at that moment.
 * When no technique below applies, the step is a labelled fallback that takes the
 * digit from the solver; it never claims a reason it does not have.
 *
 * Ladder (the first that applies wins; scan order is fixed, so output is deterministic):
 *  1. naked single   a cell with one candidate left
 *  2. hidden single  a digit with one place left in a box, row or column
 *  3. pointing       a digit confined to one line inside a box -> off the rest of the line
 *     claiming       a digit confined to one box inside a line -> off the rest of the box
 *  4. naked pair     two cells in a unit with the same two candidates
 *  5. hidden pair    two digits confined to the same two cells of a unit
 *  6. fallback       trial and error (the solver's digit for the most constrained cell)
 *
 * Candidates are the digits not already in a cell's row, column or box, minus those
 * removed by earlier elimination steps. That basic pencil-marking is not a step.
 */
import type { Grid } from "../types";
import { BOX, COL, PEERS, ROW, UNITS, solve } from "./solver";

export type Technique =
  | "naked-single"
  | "hidden-single"
  | "pointing"
  | "claiming"
  | "naked-pair"
  | "hidden-pair"
  | "fallback";

/** 0-based. */
export type Cell = { row: number; col: number };
export type Unit = { kind: "row" | "col" | "box"; index: number };
export type Placement = Cell & { digit: number };
export type Elimination = Cell & { digits: number[] };

export type Step = {
  technique: Technique;
  /** Display name, e.g. "Pointing triple". */
  title: string;
  /** At most one. */
  placements: Placement[];
  eliminations: Elimination[];
  /** The target or pattern cells, and the units the move is about. */
  highlight: { cells: Cell[]; units: Unit[] };
  explanation: string;
  /** The outcome first, for the explanation card: "Only 7 can go here." */
  conclusion: string;
  /** The reasoning behind it, one short sentence per bullet. */
  reasons: string[];
};

/** The three ways a step is described; built from the same pieces so they agree. */
type Say = Pick<Step, "explanation" | "conclusion" | "reasons">;

export const TECHNIQUE_LABEL: Record<Technique, string> = {
  "naked-single": "Naked single",
  "hidden-single": "Hidden single",
  pointing: "Pointing pair",
  claiming: "Box-line claim",
  "naked-pair": "Naked pair",
  "hidden-pair": "Hidden pair",
  fallback: "Trial and error",
};

export const FALLBACK_EXPLANATION =
  "No simple pattern applies here; this digit comes from trial and error.";

const ALL = 0x1ff; // bits 0-8 represent digits 1-9
const bit = (d: number) => 1 << (d - 1);

/** Boxes first, then rows, then columns: the order units are searched in. */
const UNIT_ORDER = [...Array(27).keys()].map((k) => (k + 18) % 27);

function digitsOf(mask: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= 9; d++) if (mask & bit(d)) out.push(d);
  return out;
}

function popcount(x: number): number {
  let n = 0;
  for (; x; x &= x - 1) n++;
  return n;
}

const toCell = (i: number): Cell => ({ row: ROW[i], col: COL[i] });
const index = (c: Cell) => c.row * 9 + c.col;

function toUnit(u: number): Unit {
  if (u < 9) return { kind: "row", index: u };
  if (u < 18) return { kind: "col", index: u - 9 };
  return { kind: "box", index: u - 18 };
}

const UNIT_WORD = { row: "row", col: "column", box: "box" } as const;
const unitName = (u: number) => {
  const { kind, index } = toUnit(u);
  return `${UNIT_WORD[kind]} ${index + 1}`;
};
const cellName = (i: number) => `row ${ROW[i] + 1}, column ${COL[i] + 1}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "6", "4 and 8", "1, 2, 5, and 7" (or with "or"). */
function list(items: (number | string)[], word = "and"): string {
  const xs = items.map(String);
  if (xs.length <= 2) return xs.join(` ${word} `);
  return `${xs.slice(0, -1).join(", ")}, ${word} ${xs[xs.length - 1]}`;
}

/** Cells by line where possible: "row 2, columns 4 and 7", else "row 1, column 3; row 2, column 1". */
function cellList(cells: number[]): string {
  if (cells.length === 1) return cellName(cells[0]);
  if (cells.every((i) => ROW[i] === ROW[cells[0]]))
    return `row ${ROW[cells[0]] + 1}, columns ${list(cells.map((i) => COL[i] + 1))}`;
  if (cells.every((i) => COL[i] === COL[cells[0]]))
    return `column ${COL[cells[0]] + 1}, rows ${list(cells.map((i) => ROW[i] + 1))}`;
  if (cells.length === 2) return `${cellName(cells[0])} and ${cellName(cells[1])}`;
  return `${cells.slice(0, -1).map(cellName).join("; ")}; and ${cellName(cells[cells.length - 1])}`;
}

/** Positions along a line: "columns 4 and 7" in a row, "rows 2 and 3" in a column. */
const along = (line: number, cells: number[]) =>
  line < 9
    ? `column${cells.length > 1 ? "s" : ""} ${list(cells.map((i) => COL[i] + 1))}`
    : `row${cells.length > 1 ? "s" : ""} ${list(cells.map((i) => ROW[i] + 1))}`;

/** Units grouped by kind: "row 1 or in columns 7 or 9". */
function unitList(units: number[]): string {
  const groups: string[] = [];
  for (const kind of ["row", "col", "box"] as const) {
    const idx = units
      .map(toUnit)
      .filter((x) => x.kind === kind)
      .map((x) => x.index + 1);
    if (idx.length)
      groups.push(
        `${UNIT_WORD[kind]}${idx.length > 1 ? "s" : ""} ${list(
          idx.sort((a, b) => a - b),
          "or",
        )}`,
      );
  }
  return groups.join(" or in ");
}

/** "4 from row 6, column 5; 4 and 7 from row 6, column 9". */
function describeEliminations(elims: Elimination[]): string {
  return elims.map((e) => `${list(e.digits)} from ${cellName(index(e))}`).join("; ");
}

/** The three units of a cell: row, column, box. */
const unitsOf = (i: number) => [ROW[i], 9 + COL[i], 18 + BOX[i]];

class Board {
  readonly values: number[];
  /** Digits removed from each cell by elimination steps (bitmask). */
  readonly removed = new Uint16Array(81);
  cands = new Uint16Array(81);

  constructor(grid: Grid) {
    this.values = grid.flat();
    this.refresh();
  }

  refresh() {
    for (let i = 0; i < 81; i++) {
      if (this.values[i]) {
        this.cands[i] = 0;
        continue;
      }
      let seen = 0;
      for (const p of PEERS[i]) if (this.values[p]) seen |= bit(this.values[p]);
      this.cands[i] = ALL & ~seen & ~this.removed[i];
    }
  }

  /** Mask of digits placed in unit `u`. */
  placed(u: number): number {
    let m = 0;
    for (const i of UNITS[u]) if (this.values[i]) m |= bit(this.values[i]);
    return m;
  }

  /** Empty cells of unit `u` where `d` is still a candidate. */
  spots(u: number, d: number): number[] {
    return UNITS[u].filter((i) => this.cands[i] & bit(d));
  }

  apply(step: Step) {
    for (const p of step.placements) this.values[index(p)] = p.digit;
    for (const e of step.eliminations) {
      for (const d of e.digits) this.removed[index(e)] |= bit(d);
    }
    this.refresh();
  }

  done(): boolean {
    return this.values.every((v) => v !== 0);
  }
}

function place(technique: Technique, i: number, d: number, units: number[], say: Say): Step {
  return {
    technique,
    title: TECHNIQUE_LABEL[technique],
    placements: [{ ...toCell(i), digit: d }],
    eliminations: [],
    highlight: { cells: [toCell(i)], units: units.map(toUnit) },
    ...say,
  };
}

function nakedSingle(b: Board): Step | null {
  for (let i = 0; i < 81; i++) {
    if (b.values[i] || popcount(b.cands[i]) !== 1) continue;
    const d = digitsOf(b.cands[i])[0];
    const clauses: string[] = [];
    const reasons: string[] = [];
    let covered = 0;
    for (const u of unitsOf(i)) {
      const adds = b.placed(u) & ~covered;
      covered |= adds;
      if (!adds) continue;
      const digits = list(digitsOf(adds));
      clauses.push(
        clauses.length
          ? `${unitName(u)} adds ${digits}`
          : `${capitalize(unitName(u))} already contains ${digits}`,
      );
      reasons.push(
        `${capitalize(unitName(u))} ${reasons.length ? "rules out" : "already contains"} ${digits}.`,
      );
    }
    const ruled = b.removed[i] & ~covered & ~bit(d);
    if (ruled) {
      const clause = `earlier steps ruled out ${list(digitsOf(ruled))}`;
      clauses.push(clauses.length ? clause : capitalize(clause));
      reasons.push(`${capitalize(clause)}.`);
    }
    return place("naked-single", i, d, unitsOf(i), {
      explanation: `${clauses.join("; ")}, so this cell can only be ${d}.`,
      conclusion: `Only ${d} can go here.`,
      reasons,
    });
  }
  return null;
}

function hiddenSingle(b: Board): Step | null {
  for (const u of UNIT_ORDER) {
    const placed = b.placed(u);
    for (let d = 1; d <= 9; d++) {
      if (placed & bit(d)) continue;
      const spots = b.spots(u, d);
      if (spots.length !== 1) continue;
      const i = spots[0];
      // Why each other empty cell of the unit cannot hold d.
      const blockers = new Set<number>();
      let byElimination = false;
      for (const j of UNITS[u]) {
        if (j === i || b.values[j]) continue;
        const other = unitsOf(j).find((v) => v !== u && b.placed(v) & bit(d));
        if (other === undefined) byElimination = true;
        else blockers.add(other);
      }
      const name = unitName(u);
      let why: string;
      if (!blockers.size && !byElimination) why = "it is the last empty cell there.";
      else {
        const parts: string[] = [];
        if (blockers.size) {
          parts.push(`already see a ${d} in ${unitList([...blockers])}`);
        }
        if (byElimination) parts.push(`had ${d} ruled out by an earlier step`);
        why = `the other empty cells ${parts.join(" or ")}.`;
      }
      const where = `In ${name}, ${d} can only go in this cell`;
      return place("hidden-single", i, d, [u], {
        explanation: `${where}: ${why}`,
        conclusion: `${d} has to go here.`,
        reasons: [`${where}.`, capitalize(why)],
      });
    }
  }
  return null;
}

/**
 * Elimination steps read "<why>, so <so>. <remove>"; the card leads with <lead>
 * (default <remove>) and lists <why> and <so> as the reasons.
 */
function eliminationStep(
  technique: Technique,
  title: string,
  pattern: number[],
  units: number[],
  elims: Elimination[],
  [why, so, remove, lead = remove]: [string, string, string, string?],
): Step {
  return {
    technique,
    title,
    placements: [],
    eliminations: elims,
    highlight: { cells: pattern.map(toCell), units: units.map(toUnit) },
    explanation: `${why}, so ${so}. ${remove}`,
    conclusion: lead,
    reasons: [`${why}.`, `So ${so}.`],
  };
}

/** Remove `mask` digits from `cells` wherever they are candidates. */
function removals(b: Board, cells: number[], mask: number): Elimination[] {
  return cells
    .filter((j) => b.cands[j] & mask)
    .map((j) => ({ ...toCell(j), digits: digitsOf(b.cands[j] & mask) }));
}

function pointing(b: Board): Step | null {
  for (let box = 0; box < 9; box++) {
    const u = 18 + box;
    for (let d = 1; d <= 9; d++) {
      const spots = b.spots(u, d);
      if (spots.length < 2) continue;
      for (const line of [ROW, COL]) {
        const l = line[spots[0]];
        if (!spots.every((i) => line[i] === l)) continue;
        const lineUnit = line === ROW ? l : 9 + l;
        const elims = removals(
          b,
          UNITS[lineUnit].filter((j) => BOX[j] !== box),
          bit(d),
        );
        if (!elims.length) continue;
        const title = spots.length === 2 ? "Pointing pair" : "Pointing triple";
        return eliminationStep("pointing", title, spots, [u, lineUnit], elims, [
          `In box ${box + 1}, ${d} can only go in ${unitName(lineUnit)} (${along(lineUnit, spots)})`,
          `the ${d} in ${unitName(lineUnit)} must be inside box ${box + 1}`,
          `Remove ${d} from the rest of ${unitName(lineUnit)}: ${along(lineUnit, elims.map(index))}.`,
        ]);
      }
    }
  }
  return null;
}

function claiming(b: Board): Step | null {
  for (let u = 0; u < 18; u++) {
    for (let d = 1; d <= 9; d++) {
      const spots = b.spots(u, d);
      if (spots.length < 2) continue;
      const box = BOX[spots[0]];
      if (!spots.every((i) => BOX[i] === box)) continue;
      const elims = removals(
        b,
        UNITS[18 + box].filter((j) => !UNITS[u].includes(j)),
        bit(d),
      );
      if (!elims.length) continue;
      return eliminationStep("claiming", TECHNIQUE_LABEL.claiming, spots, [u, 18 + box], elims, [
        `In ${unitName(u)}, ${d} can only go inside box ${box + 1} (${along(u, spots)})`,
        `the ${d} in box ${box + 1} must be in ${unitName(u)}`,
        `Remove ${d} from the rest of box ${box + 1}: ${cellList(elims.map(index))}.`,
      ]);
    }
  }
  return null;
}

function nakedPair(b: Board): Step | null {
  for (const u of UNIT_ORDER) {
    const twos = UNITS[u].filter((i) => !b.values[i] && popcount(b.cands[i]) === 2);
    for (let x = 0; x < twos.length; x++) {
      for (let y = x + 1; y < twos.length; y++) {
        const [i, j] = [twos[x], twos[y]];
        const mask = b.cands[i];
        if (b.cands[j] !== mask) continue;
        const elims = removals(
          b,
          UNITS[u].filter((k) => k !== i && k !== j),
          mask,
        );
        if (!elims.length) continue;
        const [p, q] = digitsOf(mask);
        return eliminationStep("naked-pair", TECHNIQUE_LABEL["naked-pair"], [i, j], [u], elims, [
          `${capitalize(cellList([i, j]))} can each only be ${p} or ${q}`,
          `in ${unitName(u)} those two cells take ${p} and ${q} between them`,
          `Remove ${p} and ${q} from the other cells of ${unitName(u)}: ${describeEliminations(elims)}.`,
        ]);
      }
    }
  }
  return null;
}

function hiddenPair(b: Board): Step | null {
  for (const u of UNIT_ORDER) {
    const placed = b.placed(u);
    for (let p = 1; p <= 9; p++) {
      if (placed & bit(p)) continue;
      const sp = b.spots(u, p);
      if (sp.length !== 2) continue;
      for (let q = p + 1; q <= 9; q++) {
        if (placed & bit(q)) continue;
        const sq = b.spots(u, q);
        if (sq.length !== 2 || sq[0] !== sp[0] || sq[1] !== sp[1]) continue;
        const keep = bit(p) | bit(q);
        const elims = removals(b, sp, ALL & ~keep);
        if (!elims.length) continue;
        return eliminationStep("hidden-pair", TECHNIQUE_LABEL["hidden-pair"], sp, [u], elims, [
          `In ${unitName(u)}, ${p} and ${q} can only go in ${cellList(sp)}`,
          `those two cells must hold ${p} and ${q}`,
          `Remove their other candidates: ${describeEliminations(elims)}.`,
          // Read first, "their" would point nowhere.
          `Remove the other candidates: ${describeEliminations(elims)}.`,
        ]);
      }
    }
  }
  return null;
}

function fallback(b: Board, solution: number[]): Step {
  let best = -1;
  for (let i = 0; i < 81; i++) {
    if (b.values[i]) continue;
    if (best === -1 || popcount(b.cands[i]) < popcount(b.cands[best])) best = i;
  }
  return place("fallback", best, solution[best], [], {
    explanation: FALLBACK_EXPLANATION,
    conclusion: `${solution[best]} goes here.`,
    reasons: [FALLBACK_EXPLANATION],
  });
}

const LADDER = [nakedSingle, hiddenSingle, pointing, claiming, nakedPair, hiddenPair];

/**
 * The ordered steps from `grid`'s givens to its solution. Does not mutate `grid`.
 * Throws a RangeError unless `solve(grid)` finds exactly one solution.
 */
export function generateSteps(grid: Grid): Step[] {
  const res = solve(grid);
  if (res.status !== "solved" || !res.solution) {
    throw new RangeError(`generateSteps needs a uniquely solvable grid (got ${res.status})`);
  }
  const solution = res.solution.flat();
  const b = new Board(grid);
  const steps: Step[] = [];
  while (!b.done()) {
    let step: Step | null = null;
    for (const technique of LADDER) if ((step = technique(b))) break;
    step ??= fallback(b, solution);
    steps.push(step);
    b.apply(step);
  }
  return steps;
}

/** The board after applying `steps[0..n)` to `grid` (placements only). */
export function boardAfter(grid: Grid, steps: Step[], n: number): Grid {
  const out = grid.map((row) => [...row]);
  for (const s of steps.slice(0, n)) for (const p of s.placements) out[p.row][p.col] = p.digit;
  return out;
}

/**
 * Candidates of (row, col) once `steps[0..n)` are applied: digits not in its row,
 * column or box, minus those removed by elimination steps. Empty for a filled cell.
 */
export function candidatesAt(grid: Grid, steps: Step[], n: number, cell: Cell): number[] {
  const b = new Board(grid);
  for (const s of steps.slice(0, n)) b.apply(s);
  return digitsOf(b.cands[index(cell)]);
}
