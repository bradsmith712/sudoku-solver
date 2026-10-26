/**
 * The app: one page, one shared board (grid.ts) moved between screens.
 *
 *  entry    manual entry (editable); Scan / Upload start the photo flow
 *  scanning decode + scan + repair (scanner.ts), vision code loaded lazily
 *  review   the scanned grid (highlight mode): low-confidence, conflicting and
 *           repaired cells marked; tap to edit; undo repairs; Solve
 *  solved   the solution drawn over the warped board (readonly)
 *  error    no board found, a scan too wrong to review (retake.ts), or the scanner
 *           failed to load; each with a retry
 */
import { findConflicts } from "../solver/conflicts";
import type { Change } from "../solver/repair";
import { solve, type SolveStatus } from "../solver/solver";
import type { Grid } from "../types";
import { createSudokuGrid, type CellState } from "./grid";
import { createNumberPad } from "./pad";
import { createPhotoInput } from "./photo";
import { preloadScanner, scanPhoto, type ScanOutcome } from "./scanner";

/** SPEC.md feature 7: cells under this confidence are highlighted for review. */
export const REVIEW_THRESHOLD = 0.9;

type Screen = "entry" | "scanning" | "review" | "solved" | "error";

const emptyGrid = (): Grid => Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
const key = (r: number, c: number) => `${r},${c}`;

const MESSAGES = {
  invalid: "This grid has a repeated digit in a row, column or box. Fix the highlighted cells.",
  unsolvable: "No solution exists for this puzzle. Check that every digit was entered correctly.",
  multiple:
    "This puzzle has more than one solution, so it can't be solved uniquely. Check for missing digits.",
  solved: "Solved!",
} as const;

const REVIEW_HINTS: Record<Exclude<SolveStatus, "solved">, string> = {
  invalid:
    "Some digits repeat in a row, column or box (red). Fix them, or try another photo, then solve.",
  unsolvable:
    "These digits have no solution, so at least one was misread. Check the highlighted cells against your puzzle.",
  multiple:
    "These digits allow more than one solution, so a digit may be missing. Compare the grid with your puzzle.",
};

type ErrorKind = "no-board" | "unreadable" | "failed";

const ERROR_TEXT: Record<ErrorKind, string> = {
  "no-board":
    "We couldn't find a sudoku grid in that photo. Make sure the whole grid is in view, flat and well lit, then try again.",
  unreadable:
    "We couldn't read this one: too many digits break the sudoku rules, which usually means the grid was found in the wrong place. Try again with the whole grid in view, flat and well lit.",
  failed:
    "Something went wrong while reading the photo. Check your connection and retry, or enter the puzzle by hand.",
};

const SCREEN_TEXT: Record<Screen, [string, string]> = {
  entry: [
    "Enter your puzzle",
    "Tap a cell, then a number. On a keyboard, type digits and use the arrow keys.",
  ],
  scanning: ["Reading your puzzle…", "Finding the grid and reading each digit."],
  review: [
    "Review the recognized puzzle",
    "Check the highlighted cells, fix any mistakes, then solve.",
  ],
  solved: ["Puzzle solved!", "Blue digits are the solution, drawn over your photo."],
  error: ["We couldn't read that photo", ""],
};

export function mountApp(root: HTMLElement): void {
  let screen: Screen = "entry";
  let givens = emptyGrid();
  let solution: Grid | null = null;
  /** Set while reviewing or showing a scan. */
  let scanned: ScanOutcome | null = null;
  let low = new Set<string>();
  let changed = new Map<string, Change>();
  let lastFile: File | null = null;

  root.innerHTML = `
    <header class="topbar"><span class="brand">Sudoku Solver</span></header>
    <main class="app">
      <div class="intro">
        <h1 data-testid="title"></h1>
        <p data-testid="subtitle"></p>
      </div>
      <div class="sources" data-show="entry">
        <button type="button" class="primary" data-action="camera">Scan a puzzle</button>
        <button type="button" data-action="upload">Upload image</button>
      </div>
      <div class="status-card" data-show="scanning" role="status" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <span>Scanning…</span>
      </div>
      <div class="error-card" data-show="error" role="alert">
        <p data-testid="error-text"></p>
        <div class="error-actions">
          <button type="button" class="primary" data-action="camera">Try another photo</button>
          <button type="button" data-action="upload">Upload image</button>
          <button type="button" data-action="retry" hidden>Retry</button>
          <button type="button" data-action="review-anyway" hidden>Review anyway</button>
          <button type="button" data-action="manual">Enter manually</button>
        </div>
      </div>
      <div class="workspace" data-show="entry review solved">
        <div class="board-col">
          <canvas class="original" data-show-original hidden aria-label="Scanned board photo"></canvas>
        </div>
        <div class="side">
          <ul class="legend" data-show="review" aria-label="Highlight colours">
            <li><span class="swatch low"></span>Check: low confidence</li>
            <li><span class="swatch conflict"></span>Repeated digit</li>
            <li><span class="swatch changed"></span>Changed automatically</li>
          </ul>
          <div class="repairs" data-show="review" data-testid="repairs" hidden>
            <p></p>
            <div class="repair-actions">
              <button type="button" data-action="undo-cell" hidden></button>
              <button type="button" data-action="undo-all">Undo all changes</button>
            </div>
          </div>
          <label class="toggle" data-show="review">
            <input type="checkbox" data-action="original" /> Show scanned photo
          </label>
          <p class="message" role="status" aria-live="polite" data-testid="message"></p>
          <div class="pad-slot" data-show="entry review"></div>
          <div class="actions" data-show="entry">
            <button type="button" data-action="clear">Clear</button>
            <button type="button" class="primary" data-action="solve">Solve</button>
          </div>
          <div class="actions" data-show="review">
            <button type="button" data-action="rescan">New photo</button>
            <button type="button" class="primary" data-action="solve">Solve puzzle</button>
          </div>
          <div class="actions" data-show="solved">
            <button type="button" data-action="edit">Edit puzzle</button>
            <button type="button" class="primary" data-action="another">Solve another</button>
          </div>
        </div>
      </div>
    </main>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel) as T;
  const message = $<HTMLParagraphElement>(".message");
  const original = $<HTMLCanvasElement>("canvas.original");
  const originalToggle = $<HTMLInputElement>('[data-action="original"]');
  const repairs = $<HTMLDivElement>(".repairs");
  const undoCell = $<HTMLButtonElement>('[data-action="undo-cell"]');

  const grid = createSudokuGrid({
    mode: "editable",
    onInput: (r, c, d) => setDigit(r, c, d),
    onSelect: () => renderRepairs(),
    onEnter: doSolve,
  });
  $(".board-col").prepend(grid.el);
  $(".pad-slot").appendChild(
    createNumberPad((d) => {
      const { row, col } = grid.selected();
      setDigit(row, col, d);
    }),
  );

  const cameraInput = createPhotoInput(true, startScan);
  const uploadInput = createPhotoInput(false, startScan);
  root.append(cameraInput, uploadInput);

  function setMessage(text: string, kind: "" | "error" | "success" | "warning" = "") {
    message.textContent = text;
    message.dataset.kind = kind;
  }

  function show(next: Screen) {
    screen = next;
    root.dataset.screen = next;
    const [title, subtitle] = SCREEN_TEXT[next];
    $("[data-testid=title]").textContent = title;
    $("[data-testid=subtitle]").textContent = subtitle;
    root.querySelectorAll<HTMLElement>("[data-show]").forEach((el) => {
      el.hidden = !(el.dataset.show ?? "").split(" ").includes(next);
    });
    grid.setMode(next === "review" ? "highlight" : next === "solved" ? "readonly" : "editable");
    grid.setBackground(next === "solved" && scanned ? scanned.result.warped : null);
    if (next !== "review") {
      originalToggle.checked = false;
      original.hidden = true;
    }
    render();
  }

  function render() {
    const conflicts = new Set(findConflicts(givens).map(({ row, col }) => key(row, col)));
    const cells: CellState[][] = givens.map((row, r) =>
      row.map((given, c) => ({
        value: given || (solution ? solution[r][c] : 0),
        given: given !== 0,
        conflict: conflicts.has(key(r, c)),
        low: low.has(key(r, c)),
        changed: changed.has(key(r, c)),
      })),
    );
    grid.render(cells);
    renderRepairs();
  }

  function renderRepairs() {
    if (screen !== "review") return;
    repairs.hidden = changed.size === 0;
    if (!changed.size) return;
    const list = [...changed.values()]
      .map((ch) => `row ${ch.row + 1}, column ${ch.col + 1}: ${ch.from} → ${ch.to}`)
      .join("; ");
    $<HTMLParagraphElement>(".repairs p").textContent =
      `The scan broke the sudoku rules, so we changed ${changed.size === 1 ? "1 cell" : `${changed.size} cells`} ` +
      `to the next most likely digit (${list}).`;
    const { row, col } = grid.selected();
    const ch = changed.get(key(row, col));
    undoCell.hidden = !ch;
    if (ch) undoCell.textContent = `Undo this cell (was ${ch.from})`;
  }

  function setDigit(r: number, c: number, d: number) {
    if (screen !== "entry" && screen !== "review") return;
    givens[r][c] = d;
    // The user has now looked at this cell: it is theirs, not the scan's.
    low.delete(key(r, c));
    changed.delete(key(r, c));
    if (solution) {
      solution = null;
      setMessage("");
    }
    render();
  }

  function doSolve() {
    if (screen !== "entry" && screen !== "review") return;
    const res = solve(givens);
    if (res.status === "solved" && res.solution) {
      solution = res.solution;
      setMessage(MESSAGES.solved, "success");
      if (screen === "review") show("solved");
      else render();
    } else {
      solution = null;
      setMessage(MESSAGES[res.status], res.status === "multiple" ? "warning" : "error");
      render();
    }
  }

  function resetBoard() {
    givens = emptyGrid();
    solution = null;
    scanned = null;
    low = new Set();
    changed = new Map();
    grid.select(0, 0);
    setMessage("");
  }

  function pick(camera: boolean) {
    preloadScanner();
    (camera ? cameraInput : uploadInput).click();
  }

  async function startScan(file: File) {
    lastFile = file;
    resetBoard();
    show("scanning");
    try {
      const out = await scanPhoto(file);
      scanned = out;
      givens = out.grid.map((row) => [...row]);
      low = new Set();
      out.result.confidence.forEach((row, r) =>
        row.forEach((conf, c) => conf < REVIEW_THRESHOLD && low.add(key(r, c))),
      );
      changed = new Map(out.changed.map((ch) => [key(ch.row, ch.col), ch]));
      drawOriginal(out.result.warped);
      if (out.status === "solved") setMessage("");
      else setMessage(REVIEW_HINTS[out.status], out.status === "multiple" ? "warning" : "error");
      if (out.retake.retake) {
        // Too many cells wrong to review one by one; the scan stays loaded for "Review anyway".
        showError("unreadable");
        return;
      }
      show("review");
      try {
        performance.mark("review-shown");
      } catch {
        // diagnostic only
      }
    } catch (err) {
      const noBoard = (err as { code?: string }).code === "no_board_found";
      showError(noBoard ? "no-board" : "failed");
      if (!noBoard) console.error(err);
    }
  }

  function showError(kind: ErrorKind) {
    $("[data-testid=error-text]").textContent = ERROR_TEXT[kind];
    $<HTMLButtonElement>('.error-card [data-action="retry"]').hidden = kind !== "failed";
    $<HTMLButtonElement>('.error-card [data-action="review-anyway"]').hidden =
      kind !== "unreadable";
    root.dataset.error = kind;
    show("error");
  }

  function drawOriginal(image: ImageData) {
    original.width = image.width;
    original.height = image.height;
    original.getContext("2d")?.putImageData(image, 0, 0);
  }

  function undo(ch: Change) {
    givens[ch.row][ch.col] = ch.from;
    changed.delete(key(ch.row, ch.col));
    render();
  }

  const actions: Record<string, () => void> = {
    camera: () => pick(true),
    upload: () => pick(false),
    manual: () => {
      resetBoard();
      show("entry");
    },
    retry: () => {
      if (lastFile) void startScan(lastFile);
    },
    "review-anyway": () => show("review"),
    rescan: () => pick(true),
    clear: () => {
      resetBoard();
      render();
    },
    solve: doSolve,
    edit: () => {
      solution = null;
      setMessage("");
      show("review");
    },
    another: () => {
      resetBoard();
      show("entry");
    },
    "undo-cell": () => {
      const { row, col } = grid.selected();
      const ch = changed.get(key(row, col));
      if (ch) undo(ch);
    },
    "undo-all": () => [...changed.values()].forEach(undo),
    original: () => {
      original.hidden = !originalToggle.checked;
    },
  };

  root.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const action = t?.dataset.action;
    if (action && action !== "original" && actions[action]) actions[action]();
  });
  originalToggle.addEventListener("change", actions.original);

  show("entry");
}
