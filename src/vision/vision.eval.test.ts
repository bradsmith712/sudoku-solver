/**
 * `npm run eval:vision`: digit recognition accuracy against the SPEC.md targets.
 * Skipped unless EVAL_VISION=1 (it is slow and needs local fixtures).
 *
 * Sets:
 *  - synthetic: tests/fixtures/synthetic (or $VISION_SYNTHETIC_DIR) when generated,
 *    otherwise the committed sample; boards warped from their labelled corners.
 *  - real: tests/fixtures/real positives (local only), boards from detectBoard,
 *    reported per split. EVAL_SPLITS=train evaluates only split=train, so test photos
 *    are never seen while tuning; their target is then skipped.
 *
 * For every set, split and tag: (1) cells correct, over all 81 cells per board;
 * (2) printed-digit cells read correctly; (3) boards read perfectly. Targets: synthetic
 * (1) >= 98% and (3) >= 90%; real split=test (1) >= 90%. Also: true-blank cells under
 * 0.9 confidence per board, the share of missed digits under 0.9 (what the review
 * screen would flag), and the 10 most frequent confusions. Calibration: ECE, misreads
 * under 0.9 and correct cells under 0.9 per board, at T = 1 and at the shipped
 * temperature, plus (information only) a margin flag with the same cell budget. Writes
 * test-results/vision-eval/report.json and fails if a target is missed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFixtures, readJpeg } from "./__fixtures__/fixtures";
import { expectedCalibrationError, type Prediction } from "./__fixtures__/calibration";
import { isNegative, listRealFixtures, tally, type Score } from "./__fixtures__/real";
import { detectBoard, warpBoardAt } from "./board";
import { recognizeBoard, TEMPERATURE } from "./recognize";
import type { Grid } from "../types";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT_DIR = join(ROOT, "test-results/vision-eval");
const REVIEW = 0.9;
const TARGETS = { syntheticCells: 0.98, syntheticBoards: 0.9, realTestCells: 0.9 };
const SPLITS = (process.env.EVAL_SPLITS ?? "train,test").split(",");

type Board = {
  name: string;
  truth: Score["truth"];
  want: Grid;
  got: Grid;
  /** Calibrated (temperature-scaled) confidence, as scan() returns it. */
  confidence: number[][];
  /** The same read at temperature 1 (before calibration). */
  rawConfidence: number[][];
  /** Calibrated top-two margin; 1 on blank cells. */
  margin: number[][];
};

/** Read a warped board at the shipped temperature and at T = 1. */
async function read(warped: ImageData) {
  const [cal, raw] = [await recognizeBoard(warped), await recognizeBoard(warped, 1)];
  return {
    got: cal.grid,
    confidence: cal.confidence,
    rawConfidence: raw.confidence,
    margin: cal.margin,
  };
}

type Calibration = {
  /** ECE over digit predictions (cells the model classified). */
  ece: number;
  misreads: number;
  /** Misreads under the 0.9 review threshold. */
  misreadsFlagged: number;
  /** Correctly read cells (digits and blanks) under 0.9, per board. */
  correctFlaggedPerBoard: number;
};

function calibration(boards: Board[], conf: (b: Board) => number[][]): Calibration {
  const preds: Prediction[] = [];
  let misreads = 0;
  let flagged = 0;
  let correctFlagged = 0;
  for (const b of boards) {
    const c = conf(b);
    b.want.forEach((row, r) =>
      row.forEach((want, col) => {
        const got = b.got[r][col];
        const low = c[r][col] < REVIEW;
        if (got) preds.push({ confidence: c[r][col], correct: got === want });
        if (got !== want) {
          misreads++;
          if (low) flagged++;
        } else if (low) correctFlagged++;
      }),
    );
  }
  return {
    ece: expectedCalibrationError(preds),
    misreads,
    misreadsFlagged: flagged,
    correctFlaggedPerBoard: correctFlagged / Math.max(1, boards.length),
  };
}

/**
 * Informational only (nothing ships on it): a margin flag set to mark as many cells as
 * calibrated confidence < 0.9 does, and how many misreads it would catch.
 */
function marginFlag(boards: Board[]) {
  const cells = boards.flatMap((b) =>
    b.want.flatMap((row, r) =>
      row.map((want, c) => ({
        margin: b.margin[r][c],
        low: b.confidence[r][c] < REVIEW,
        wrong: b.got[r][c] !== want,
      })),
    ),
  );
  const budget = cells.filter((x) => x.low).length;
  const sorted = [...cells].sort((a, b) => a.margin - b.margin);
  const flagged = sorted.slice(0, budget);
  return {
    cutoff: budget ? sorted[budget - 1].margin : 0,
    flaggedCells: budget,
    misreadsCaught: flagged.filter((x) => x.wrong).length,
    misreads: cells.filter((x) => x.wrong).length,
  };
}

function calibrationLines(name: string, boards: Board[]): string[] {
  const before = calibration(boards, (b) => b.rawConfidence);
  const after = calibration(boards, (b) => b.confidence);
  const m = marginFlag(boards);
  const row = (label: string, c: Calibration) =>
    `       ${label.padEnd(17)} ECE ${c.ece.toFixed(4)}  misreads under ${REVIEW}: ` +
    `${c.misreadsFlagged}/${c.misreads}  correct cells under ${REVIEW} per board: ${c.correctFlaggedPerBoard.toFixed(2)}`;
  return [
    `[eval] ${name} calibration:`,
    row("before (T = 1)", before),
    row(`after (T = ${TEMPERATURE})`, after),
    `       margin flag (info only, same ${m.flaggedCells} cells flagged, margin <= ${m.cutoff.toFixed(3)}): ` +
      `catches ${m.misreadsCaught}/${m.misreads} misreads`,
  ];
}

type Summary = {
  boards: number;
  cells: [number, number];
  digits: [number, number];
  perfect: [number, number];
  blanksUnderReview: number;
  missedDigits: number;
  missedUnderReview: number;
  confusions: { want: number; got: number; count: number }[];
};

function summarize(boards: Board[]): Summary {
  const s: Summary = {
    boards: boards.length,
    cells: [0, 0],
    digits: [0, 0],
    perfect: [0, boards.length],
    blanksUnderReview: 0,
    missedDigits: 0,
    missedUnderReview: 0,
    confusions: [],
  };
  const pairs = new Map<string, number>();
  for (const b of boards) {
    let ok = 0;
    b.want.forEach((row, r) =>
      row.forEach((want, c) => {
        const got = b.got[r][c];
        const low = b.confidence[r][c] < REVIEW;
        if (got === want) ok++;
        else pairs.set(`${want}>${got}`, (pairs.get(`${want}>${got}`) ?? 0) + 1);
        if (want === 0 && got === 0 && low) s.blanksUnderReview++;
        if (want !== 0) {
          s.digits[1]++;
          if (got === want) s.digits[0]++;
          else {
            s.missedDigits++;
            if (low) s.missedUnderReview++;
          }
        }
      }),
    );
    s.cells[0] += ok;
    s.cells[1] += 81;
    if (ok === 81) s.perfect[0]++;
  }
  s.confusions = [...pairs]
    .map(([k, count]) => {
      const [want, got] = k.split(">").map(Number);
      return { want, got, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return s;
}

const pct = ([a, b]: [number, number]) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-");
const frac = ([a, b]: [number, number]) => `${pct([a, b])} (${a}/${b})`;

/** One table: per split (if any) and per tag, the three numbers. */
function table(title: string, boards: Board[]): string {
  const score = (f: (b: Board) => [number, number]): Score[] =>
    boards.map((b) => {
      const [passed, total] = f(b);
      return { truth: b.truth, passed, total };
    });
  const one = (b: Board) => summarize([b]);
  const cells = tally(score((b) => one(b).cells));
  const digits = tally(score((b) => one(b).digits));
  const perfect = tally(score((b) => one(b).perfect));
  const keys = (k: "split" | "tag") => [...cells[k].keys()];
  const width = Math.max(
    8,
    ...keys("split")
      .concat(keys("tag"))
      .map((k) => k.length),
  );
  const line = (k: string, kind: "split" | "tag") => {
    const t = (m: typeof cells) => m[kind].get(k)!;
    return (
      `  ${k.padEnd(width)}  ${frac([t(cells).passed, t(cells).total]).padStart(20)}` +
      `  ${frac([t(digits).passed, t(digits).total]).padStart(20)}` +
      `  ${frac([t(perfect).passed, t(perfect).total]).padStart(14)}`
    );
  };
  return [
    title,
    `  ${"".padEnd(width)}  ${"(1) all cells".padStart(20)}  ${"(2) digit cells".padStart(20)}  ${"(3) boards".padStart(14)}`,
    ...(keys("split").length ? [" by split:", ...keys("split").map((k) => line(k, "split"))] : []),
    " by tag:",
    ...keys("tag").map((k) => line(k, "tag")),
  ].join("\n");
}

function headline(name: string, s: Summary): string {
  const missed = s.missedDigits ? `${s.missedUnderReview}/${s.missedDigits}` : "0/0";
  return (
    `[eval] ${name}: (1) cells ${frac(s.cells)}  (2) digit cells ${frac(s.digits)}  (3) boards ${frac(s.perfect)}\n` +
    `       true blanks under ${REVIEW} per board: ${(s.blanksUnderReview / Math.max(1, s.boards)).toFixed(2)};` +
    ` missed digits under ${REVIEW}: ${missed}\n` +
    `       most confused (want>got, 0 = blank): ${s.confusions.map((c) => `${c.want}>${c.got} x${c.count}`).join(", ") || "none"}`
  );
}

async function syntheticBoards(): Promise<{ set: string; boards: Board[] }> {
  const full = process.env.VISION_SYNTHETIC_DIR ?? join(ROOT, "tests/fixtures/synthetic");
  let fixtures = listFixtures(full);
  let set = "synthetic";
  if (fixtures.length === 0) {
    fixtures = listFixtures(join(ROOT, "tests/fixtures/synthetic/sample"));
    set = "synthetic sample";
  }
  const boards: Board[] = [];
  for (const f of fixtures) {
    const corners = f.truth.corners!.map(([x, y]) => ({ x, y }));
    const { warped } = await warpBoardAt(readJpeg(f.imagePath), corners);
    boards.push({
      name: f.name,
      truth: { tags: f.truth.tags ?? [] },
      want: f.truth.grid,
      ...(await read(warped)),
    });
  }
  return { set, boards };
}

async function realBoards(): Promise<Board[]> {
  const boards: Board[] = [];
  for (const f of listRealFixtures(join(ROOT, "tests/fixtures/real"))) {
    if (isNegative(f) || !SPLITS.includes(f.truth.split)) continue;
    const { warped } = await detectBoard(readJpeg(f.imagePath));
    boards.push({ name: f.name, truth: f.truth, want: f.truth.grid!, ...(await read(warped)) });
  }
  return boards;
}

describe.skipIf(!process.env.EVAL_VISION)("eval:vision", () => {
  it("meets the SPEC.md accuracy targets", async () => {
    const synthetic = await syntheticBoards();
    const real = await realBoards();
    const bySplit = (split: string) => real.filter((b) => b.truth.split === split);
    const report: Record<string, unknown> = { splits: SPLITS };
    const lines: string[] = [];
    const add = (name: string, boards: Board[]) => {
      if (!boards.length) return undefined;
      const s = summarize(boards);
      report[name] = {
        ...s,
        boards: boards.map((b) => ({
          name: b.name,
          want: b.want,
          got: b.got,
          confidence: b.confidence,
        })),
      };
      lines.push(headline(name, s));
      return s;
    };

    const syn = add(synthetic.set, synthetic.boards)!;
    lines.push(...calibrationLines(synthetic.set, synthetic.boards));
    report.calibration = {
      temperature: TEMPERATURE,
      [synthetic.set]: {
        before: calibration(synthetic.boards, (b) => b.rawConfidence),
        after: calibration(synthetic.boards, (b) => b.confidence),
        marginFlag: marginFlag(synthetic.boards),
      },
    };
    lines.push(table(`[eval] ${synthetic.set}`, synthetic.boards));
    for (const split of ["train", "test"])
      if (SPLITS.includes(split) && add(`real ${split}`, bySplit(split)))
        lines.push(...calibrationLines(`real ${split}`, bySplit(split)));
    if (real.length) lines.push(table("[eval] real", real));
    console.log(lines.join("\n\n"));
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 1) + "\n");

    const misses: string[] = [];
    const rate = ([a, b]: [number, number]) => a / b;
    if (rate(syn.cells) < TARGETS.syntheticCells)
      misses.push(`synthetic cells ${pct(syn.cells)} < 98%`);
    if (rate(syn.perfect) < TARGETS.syntheticBoards)
      misses.push(`synthetic boards ${pct(syn.perfect)} < 90%`);
    const test = bySplit("test");
    if (SPLITS.includes("test") && test.length) {
      const t = summarize(test);
      if (rate(t.cells) < TARGETS.realTestCells)
        misses.push(`real test cells ${pct(t.cells)} < 90%`);
    }
    expect(misses).toEqual([]);
  }, 1_800_000);
});
