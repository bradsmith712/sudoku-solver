/**
 * The step-by-step screen (SPEC Design screen 8, docs/mockups-steps.png): the shared
 * board in "steps" mode above an explanation card (conclusion first, then the
 * reasons and the target's candidates), and a sticky footer with progress and
 * Previous/Next. The list of every step is a bottom sheet under 1024px and an inline
 * panel beside the card from 1024px. Step N shows the givens plus the digits placed
 * by steps 1..N, so the last step shows the full solution.
 */
import {
  candidatesAt,
  generateSteps,
  type Cell,
  type Step,
  type Technique,
  type Unit,
} from "../../solver/steps";
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

const rc = (c: Cell) => `R${c.row + 1}C${c.col + 1}`;

/** Digits removed by an elimination step, ascending. */
const removed = (step: Step) =>
  [...new Set(step.eliminations.flatMap((e) => e.digits))].sort((a, b) => a - b);

/** One line for screen readers: "row 5, column 3 = 3" or "removes 4 and 7 from 2 cells". */
function summary(step: Step): string {
  const p = step.placements[0];
  if (p) return `row ${p.row + 1}, column ${p.col + 1} = ${p.digit}`;
  const n = step.eliminations.length;
  return `removes ${removed(step).join(" and ")} from ${n} cell${n === 1 ? "" : "s"}`;
}

/** The step list's short line: "R1C2 = 7" or "R2C7, R2C8 · remove 1". */
function coords(step: Step): string {
  const p = step.placements[0];
  if (p) return `${rc(p)} = ${p.digit}`;
  return `${step.highlight.cells.map(rc).join(", ")} · remove ${removed(step).join(", ")}`;
}

const FAMILY: Record<Technique, [string, string]> = {
  "naked-single": ["single", "Single"],
  "hidden-single": ["single", "Single"],
  "naked-pair": ["pair", "Pair"],
  "hidden-pair": ["pair", "Pair"],
  pointing: ["boxline", "Box/Line"],
  claiming: ["boxline", "Box/Line"],
  fallback: ["trial", "Trial"],
};

const svg = (d: string, cls = "icon") =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const CHEV_LEFT = svg("m15 6-6 6 6 6", "chev");
const CHEV_RIGHT = svg("m9 6 6 6-6 6", "chev");
const CHECK = `<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11"/><path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
/** From 1024px the step list is an inline panel, not a sheet (steps.css). */
const wide = () => window.matchMedia?.("(min-width: 1024px)").matches ?? false;

export function createStepsView(opts: { onBack: () => void }): StepsView {
  let givens: Grid = [];
  let steps: Step[] = [];
  /** 1-based; 0 only when there are no steps. */
  let current = 0;
  let active = false;
  let sheetOpen = false;
  /** Elements made inert while the sheet is open, to restore on close. */
  let inerted: HTMLElement[] = [];

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
        <p class="step-where" data-testid="step-where"></p>
        <div class="step-why" aria-live="polite" data-testid="step-explanation">
          <p class="step-conclusion" data-testid="step-conclusion">${CHECK}<span></span></p>
          <ul class="step-reasons" data-testid="step-reasons"></ul>
        </div>
        <div class="step-cands" data-testid="step-candidates">
          <span class="step-cands-label">Candidates for this cell</span>
          <ul aria-label="Candidates for this cell before the step"></ul>
        </div>
      </article>
      <div class="sheet-layer">
        <div class="sheet-backdrop" data-testid="sheet-backdrop"></div>
        <section class="step-sheet" data-testid="step-sheet" aria-labelledby="step-sheet-title">
          <div class="sheet-handle" aria-hidden="true"></div>
          <div class="sheet-head">
            <h3 id="step-sheet-title"></h3>
            <button type="button" class="sheet-close" aria-label="Close step list">${svg("M6 6l12 12M18 6 6 18")}</button>
          </div>
          <ol data-testid="step-log"></ol>
        </section>
      </div>
    </div>
    <nav class="step-nav" aria-label="Step controls">
      <div class="step-progress">
        <span class="step-count" data-testid="step-count"></span>
        <button type="button" class="step-all" aria-haspopup="dialog">${svg("M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01")}All steps</button>
        <span class="step-pct" data-testid="step-pct"></span>
      </div>
      <div class="step-bar" role="progressbar" aria-label="Progress through the steps" aria-valuemin="0"><span></span></div>
      <div class="step-buttons">
        <button type="button" data-step="prev">${CHEV_LEFT}Previous</button>
        <button type="button" class="primary" data-step="next"><span>Next step</span>${CHEV_RIGHT}</button>
      </div>
    </nav>`;

  const $ = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel) as T;
  const title = $(".step-title");
  const badge = $(".step-badge");
  const where = $(".step-where");
  const conclusion = $(".step-conclusion span");
  const reasons = $(".step-reasons");
  const cands = $(".step-cands");
  const candList = $(".step-cands ul");
  const layer = $(".sheet-layer");
  const backdrop = $(".sheet-backdrop");
  const sheet = $(".step-sheet");
  const sheetTitle = $(".sheet-head h3");
  const closeBtn = $<HTMLButtonElement>(".sheet-close");
  const log = $<HTMLOListElement>(".step-sheet ol");
  const count = $(".step-count");
  const allBtn = $<HTMLButtonElement>(".step-all");
  const pct = $(".step-pct");
  const bar = $(".step-bar");
  const prev = $<HTMLButtonElement>('[data-step="prev"]');
  const next = $<HTMLButtonElement>('[data-step="next"]');
  const nextLabel = $('[data-step="next"] span');

  const grid = createSudokuGrid({ mode: "steps", label: "Sudoku grid at this step" });
  $(".steps-board").appendChild(grid.el);

  /** A dialog under 1024px, a plain labelled region beside the card from 1024px. */
  function applyLayout() {
    if (wide()) {
      if (sheetOpen) closeSheet(false);
      sheet.removeAttribute("role");
      sheet.removeAttribute("aria-modal");
    } else {
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
    }
  }

  function renderLog() {
    const label = `All steps (${steps.length})`;
    sheetTitle.textContent = label;
    allBtn.setAttribute("aria-label", label);
    log.replaceChildren(
      ...steps.map((s, k) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.goto = String(k + 1);
        const [family, tag] = FAMILY[s.technique];
        b.innerHTML = `<span class="n">${k + 1}</span><span class="t"><b></b><small></small></span><span class="tag" data-family="${family}">${tag}</span>${CHEV_RIGHT}`;
        (b.querySelector(".t b") as HTMLElement).textContent = s.title;
        (b.querySelector(".t small") as HTMLElement).textContent = coords(s);
        b.setAttribute("aria-label", `Step ${k + 1}: ${s.title}, ${summary(s)}`);
        li.appendChild(b);
        return li;
      }),
    );
  }

  /** Scroll the list only, never the page, so the current step is centred. */
  function centreCurrent(smooth: boolean) {
    const item = log.querySelector<HTMLElement>("button.current");
    if (!item) return;
    const top = item.offsetTop - log.clientHeight / 2 + item.offsetHeight / 2;
    log.scrollTo({
      top: Math.max(0, top),
      behavior: smooth && !reducedMotion() ? "smooth" : "auto",
    });
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

    const total = steps.length;
    const done = total ? Math.round((current / total) * 100) : 100;
    count.textContent = total ? `Step ${current} of ${total}` : "No steps";
    pct.textContent = `${done}% complete`;
    bar.setAttribute("aria-valuemax", String(total));
    bar.setAttribute("aria-valuenow", String(current));
    bar.setAttribute("aria-valuetext", count.textContent);
    bar.style.setProperty("--done", `${done}%`);
    allBtn.hidden = !total;
    prev.disabled = current <= 1;
    next.disabled = !total;
    nextLabel.textContent = current >= total ? "Back to solution" : "Next step";

    if (!step) {
      title.textContent = "Nothing to solve";
      badge.hidden = true;
      where.textContent = "";
      conclusion.textContent = "Every cell was already filled in.";
      reasons.replaceChildren();
      cands.hidden = true;
    } else {
      title.textContent = step.title;
      badge.hidden = false;
      badge.textContent = step.technique === "fallback" ? "Trial and error" : "Logical deduction";
      badge.dataset.kind = step.technique === "fallback" ? "fallback" : "logic";
      const target = step.placements[0];
      where.textContent = target
        ? `Row ${target.row + 1}, Column ${target.col + 1}`
        : summary(step).replace(/^r/, "R");
      conclusion.textContent = step.conclusion;
      reasons.replaceChildren(
        ...step.reasons.map((text) => {
          const li = document.createElement("li");
          li.textContent = text;
          return li;
        }),
      );
      cands.hidden = !target;
      if (target) {
        const before = candidatesAt(givens, steps, current - 1, target);
        candList.replaceChildren(
          ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => {
            const li = document.createElement("li");
            li.textContent = String(d);
            const kind = d === target.digit ? "answer" : before.includes(d) ? "open" : "out";
            li.className = kind;
            li.setAttribute(
              "aria-label",
              `${d}: ${kind === "answer" ? "the answer" : kind === "open" ? "possible" : "ruled out"}`,
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
    if (wide() || sheetOpen) centreCurrent(true);
  }

  function go(n: number) {
    if (!steps.length) return;
    current = Math.max(1, Math.min(steps.length, n));
    render();
  }

  /** Make everything outside the sheet's layer inert, walking up to <body>. */
  function setInert(on: boolean) {
    if (!on) {
      inerted.forEach((n) => (n.inert = false));
      inerted = [];
      return;
    }
    for (let n: HTMLElement = layer; n.parentElement && n !== document.body; n = n.parentElement) {
      for (const sib of n.parentElement.children) {
        if (sib === n || !(sib instanceof HTMLElement) || sib.inert) continue;
        sib.inert = true;
        inerted.push(sib);
      }
    }
  }

  function openSheet() {
    if (wide() || sheetOpen || !steps.length) return;
    sheetOpen = true;
    el.classList.add("sheet-open");
    setInert(true);
    centreCurrent(false);
    log.querySelector<HTMLElement>("button.current")?.focus({ preventScroll: true });
  }

  function closeSheet(restoreFocus = true) {
    if (!sheetOpen) return;
    sheetOpen = false;
    el.classList.remove("sheet-open");
    setInert(false);
    if (restoreFocus) allBtn.focus({ preventScroll: true });
  }

  function back() {
    close();
    opts.onBack();
  }

  prev.addEventListener("click", () => go(current - 1));
  next.addEventListener("click", () => (current >= steps.length ? back() : go(current + 1)));
  allBtn.addEventListener("click", openSheet);
  closeBtn.addEventListener("click", () => closeSheet());
  backdrop.addEventListener("click", () => closeSheet());
  log.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-goto]");
    if (!b) return;
    go(Number(b.dataset.goto));
    closeSheet();
  });

  /** In the open sheet, the arrow keys move between rows and Escape closes it. */
  function onSheetKey(e: KeyboardEvent) {
    const rows = [...log.querySelectorAll<HTMLButtonElement>("button")];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const to: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: rows.length - 1,
    };
    if (e.key === "Escape") closeSheet();
    else if (e.key in to) {
      rows[Math.max(0, Math.min(rows.length - 1, to[e.key]))]?.focus();
    } else return;
    e.preventDefault();
  }

  function onKey(e: KeyboardEvent) {
    if (!active || e.altKey || e.ctrlKey || e.metaKey) return;
    if (sheetOpen) return onSheetKey(e);
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "ArrowLeft") go(current - 1);
    else if (e.key === "ArrowRight") go(current + 1);
    else if (e.key === "Home") go(1);
    else if (e.key === "End") go(steps.length);
    else return;
    e.preventDefault();
  }

  const media = window.matchMedia?.("(min-width: 1024px)");

  function close() {
    closeSheet(false);
    active = false;
    document.removeEventListener("keydown", onKey);
    media?.removeEventListener("change", applyLayout);
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
      if (!active) {
        document.addEventListener("keydown", onKey);
        media?.addEventListener("change", applyLayout);
      }
      active = true;
      applyLayout();
      render();
    },
    close,
  };
}
