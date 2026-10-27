/**
 * The home screen's illustration (docs/mockups-home.png): one board, an instance of
 * the shared grid, that starts as a tilted paper "photo" with only the givens,
 * flattens into a clean board, fills in the missing digits in the order the steps
 * find them, then highlights the last step. Decorative: the board is aria-hidden and
 * the caption says what it shows. Under prefers-reduced-motion it shows the finished
 * board once, with no timers.
 */
import { generateSteps } from "../solver/steps";
import type { Grid } from "../types";
import { createSudokuGrid, type CellState } from "./grid";

/** The classic puzzle from the mockups; logic alone solves it. */
export const DEMO_PUZZLE: Grid = [
  [5, 3, 0, 0, 7, 0, 0, 0, 0],
  [6, 0, 0, 1, 9, 5, 0, 0, 0],
  [0, 9, 8, 0, 0, 0, 0, 6, 0],
  [8, 0, 0, 0, 6, 0, 0, 0, 3],
  [4, 0, 0, 8, 0, 3, 0, 0, 1],
  [7, 0, 0, 0, 2, 0, 0, 0, 6],
  [0, 6, 0, 0, 0, 0, 2, 8, 0],
  [0, 0, 0, 4, 1, 9, 0, 0, 5],
  [0, 0, 0, 0, 8, 0, 0, 7, 9],
];

/** Milliseconds. */
const PHOTO_HOLD = 1800;
const FLATTEN = 700;
const PER_DIGIT = 45;
const EXPLORE_HOLD = 3200;
const FADE = 400;

export type Hero = {
  el: HTMLElement;
  /** Start (or restart) the loop; idempotent. */
  start(): void;
  stop(): void;
};

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function createHero(): Hero {
  const steps = generateSteps(DEMO_PUZZLE);
  const placements = steps.flatMap((s) => s.placements);
  const last = placements[placements.length - 1];
  const box = (r: number, c: number) => Math.floor(r / 3) * 3 + Math.floor(c / 3);

  const el = document.createElement("figure");
  el.className = "hero";
  el.innerHTML = `
    <div class="hero-stage" aria-hidden="true"></div>
    <figcaption>
      <ol class="hero-phases">
        <li data-phase="photo"><b>Your puzzle</b><span>Snap a photo</span></li>
        <li data-phase="solve"><b>We solve it</b><span>In seconds</span></li>
        <li data-phase="explore"><b>Explore the steps</b><span>See the logic behind each move</span></li>
      </ol>
    </figcaption>`;

  const grid = createSudokuGrid({ mode: "readonly", label: "Example puzzle" });
  (el.querySelector(".hero-stage") as HTMLElement).appendChild(grid.el);

  let timer = 0;
  let running = false;

  /** The givens plus the first `filled` placements; on a full board, the last step marked. */
  function paint(filled: number) {
    const board = DEMO_PUZZLE.map((row) => [...row]);
    for (const p of placements.slice(0, filled)) board[p.row][p.col] = p.digit;
    const done = filled === placements.length;
    grid.setMode(done ? "steps" : "readonly");
    const cells: CellState[][] = board.map((row, r) =>
      row.map((value, c) => {
        const target = done && r === last.row && c === last.col;
        return {
          value,
          given: DEMO_PUZZLE[r][c] !== 0,
          focus: target,
          fresh: target,
          area: done && (r === last.row || c === last.col || box(r, c) === box(last.row, last.col)),
        };
      }),
    );
    grid.render(cells);
  }

  function phase(name: "photo" | "solve" | "explore" | "still") {
    el.dataset.phase = name;
  }

  const after = (ms: number, fn: () => void) => {
    timer = window.setTimeout(fn, ms);
  };

  function photo() {
    el.classList.remove("fading");
    paint(0);
    phase("photo");
    after(PHOTO_HOLD, solveIt);
  }

  function solveIt() {
    phase("solve");
    let n = 0;
    const tick = () => {
      paint(++n);
      if (n < placements.length) after(PER_DIGIT, tick);
      else explore();
    };
    after(FLATTEN, tick);
  }

  function explore() {
    phase("explore");
    after(EXPLORE_HOLD, () => {
      el.classList.add("fading");
      after(FADE, photo);
    });
  }

  function onVisibility() {
    if (!running) return;
    window.clearTimeout(timer);
    if (document.visibilityState === "visible") photo();
  }

  return {
    el,
    start() {
      window.clearTimeout(timer);
      if (reducedMotion()) {
        running = false;
        el.classList.remove("fading");
        paint(placements.length);
        phase("still");
        return;
      }
      if (!running) document.addEventListener("visibilitychange", onVisibility);
      running = true;
      photo();
    },
    stop() {
      window.clearTimeout(timer);
      running = false;
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
