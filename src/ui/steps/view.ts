/**
 * The step-by-step screen (SPEC Design screen 8): the shared board in "steps" mode
 * above an explanation card, the activity log of every step, and sticky
 * Previous/Next controls. Step N shows the givens plus the digits placed by steps
 * 1..N, so the last step shows the full solution.
 */
import { candidatesAt, generateSteps, type Cell, type Step, type Unit } from "../../solver/steps";
import type { Grid } from "../../types";
import { createSudokuGrid, type CellState } from "../grid";
import "./steps.css";

export type StepsView = {
  el: HTMLElement;
  /** Compute the steps for `givens` and show step 1. */
  open(givens: Grid): void;
  /** Drop the steps, stop listening for keys and detach `el` (only one board in the page). */
  close(): void;
};

const inUnit = (u: Unit, r: number, c: number) =>
  u.kind === "row"
    ? r === u.index
    : u.kind === "col"
      ? c === u.index
      : Math.floor(r / 3) * 3 + Math.floor(c / 3) === u.index;

const has = (cells: Cell[], r: number, c: number) => cells.some((x) => x.row === r && x.col === c);

/** One line for the activity log: "row 5, column 3 = 3" or "removes 4 and 7". */
function summary(step: Step): string {
  const p = step.placements[0];
  if (p) return `row ${p.row + 1}, column ${p.col + 1} = ${p.digit}`;
  const digits = [...new Set(step.eliminations.flatMap((e) => e.digits))].sort();
  const n = step.eliminations.length;
  return `removes ${digits.join(" and ")} from ${n} cell${n === 1 ? "" : "s"}`;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function createStepsView(opts: { onBack: () => void }): StepsView {
  let givens: Grid = [];
  let steps: Step[] = [];
  /** 1-based; 0 only when there are no steps. */
  let current = 0;
  let active = false;

  const el = document.createElement("div");
  el.className = "steps";
  el.innerHTML = `
    <div class="steps-board"></div>
    <div class="steps-side">
      <article class="step-card">
        <div class="step-head">
          <h2 class="step-title" data-testid="step-title"></h2>
          <span class="step-badge" data-testid="step-badge"></span>
        </div>
        <p class="step-text" aria-live="polite" data-testid="step-explanation"></p>
        <div class="step-cands" data-testid="step-candidates">
          <span class="step-cands-label">Candidates</span>
          <ul aria-label="Candidates for this cell before the step"></ul>
        </div>
      </article>
      <details class="step-log" open>
        <summary></summary>
        <ol data-testid="step-log"></ol>
      </details>
    </div>
    <nav class="step-nav" aria-label="Step controls">
      <button type="button" data-step="prev">Previous</button>
      <span class="step-count" data-testid="step-count"></span>
      <button type="button" class="primary" data-step="next">Next step</button>
    </nav>`;

  const $ = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel) as T;
  const title = $(".step-title");
  const badge = $(".step-badge");
  const text = $(".step-text");
  const cands = $(".step-cands");
  const candList = $(".step-cands ul");
  const log = $<HTMLOListElement>(".step-log ol");
  const logSummary = $(".step-log summary");
  const count = $(".step-count");
  const prev = $<HTMLButtonElement>('[data-step="prev"]');
  const next = $<HTMLButtonElement>('[data-step="next"]');

  const grid = createSudokuGrid({ mode: "steps", label: "Sudoku grid at this step" });
  $(".steps-board").appendChild(grid.el);

  function renderLog() {
    logSummary.textContent = `All steps (${steps.length})`;
    log.replaceChildren(
      ...steps.map((s, k) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.goto = String(k + 1);
        b.innerHTML = `<span class="n">${k + 1}.</span> <span class="t"></span>`;
        (b.querySelector(".t") as HTMLElement).textContent = `${s.title} · ${summary(s)}`;
        if (s.technique === "fallback") b.classList.add("fallback");
        li.appendChild(b);
        return li;
      }),
    );
  }

  function render() {
    const step = steps[current - 1];
    const board = givens.map((row) => [...row]);
    for (const s of steps.slice(0, current))
      for (const p of s.placements) board[p.row][p.col] = p.digit;
    const placed = step?.placements ?? [];
    const elims = step?.eliminations ?? [];
    const cells: CellState[][] = board.map((row, r) =>
      row.map((value, c) => ({
        value,
        given: givens[r][c] !== 0,
        fresh: has(placed, r, c),
        focus: !!step && has(step.highlight.cells, r, c),
        area: !!step && step.highlight.units.some((u) => inUnit(u, r, c)),
        elim: has(elims, r, c),
      })),
    );
    grid.render(cells);

    count.textContent = steps.length ? `Step ${current} of ${steps.length}` : "No steps";
    prev.disabled = current <= 1;
    next.disabled = !steps.length;
    next.textContent = current >= steps.length ? "Back to solution" : "Next step";

    if (!step) {
      title.textContent = "Nothing to solve";
      badge.hidden = true;
      text.textContent = "Every cell was already filled in.";
      cands.hidden = true;
    } else {
      title.textContent = step.title;
      badge.hidden = false;
      badge.textContent = step.technique === "fallback" ? "Trial and error" : "Logical deduction";
      badge.dataset.kind = step.technique === "fallback" ? "fallback" : "logic";
      text.textContent = step.explanation;
      const target = step.placements[0];
      cands.hidden = !target;
      if (target) {
        const before = candidatesAt(givens, steps, current - 1, target);
        candList.replaceChildren(
          ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => {
            const li = document.createElement("li");
            li.textContent = String(d);
            li.className = d === target.digit ? "answer" : before.includes(d) ? "open" : "out";
            li.setAttribute(
              "aria-label",
              `${d}: ${d === target.digit ? "the answer" : before.includes(d) ? "possible" : "ruled out"}`,
            );
            return li;
          }),
        );
      }
    }

    log.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      const on = Number(b.dataset.goto) === current;
      b.classList.toggle("current", on);
      if (on) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
    const item = log.querySelector<HTMLElement>("button.current");
    if (item) {
      // Scroll the log only, never the page, so the board stays put.
      const top = item.offsetTop - log.clientHeight / 2 + item.offsetHeight / 2;
      log.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }

  function go(n: number) {
    if (!steps.length) return;
    current = Math.max(1, Math.min(steps.length, n));
    render();
  }

  function back() {
    close();
    opts.onBack();
  }

  prev.addEventListener("click", () => go(current - 1));
  next.addEventListener("click", () => (current >= steps.length ? back() : go(current + 1)));
  log.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-goto]");
    if (b) go(Number(b.dataset.goto));
  });

  function onKey(e: KeyboardEvent) {
    if (!active || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "ArrowLeft") go(current - 1);
    else if (e.key === "ArrowRight") go(current + 1);
    else if (e.key === "Home") go(1);
    else if (e.key === "End") go(steps.length);
    else return;
    e.preventDefault();
  }

  function close() {
    active = false;
    document.removeEventListener("keydown", onKey);
    steps = [];
    current = 0;
    el.remove();
  }

  return {
    el,
    open(g) {
      givens = g.map((row) => [...row]);
      steps = generateSteps(givens);
      current = steps.length ? 1 : 0;
      renderLog();
      log.scrollTop = 0;
      if (!active) document.addEventListener("keydown", onKey);
      active = true;
      render();
    },
    close,
  };
}
