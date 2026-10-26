import { findConflicts } from "../solver/conflicts";
import { solve } from "../solver/solver";
import type { Grid } from "../types";
import { createSudokuGrid, type CellState } from "./grid";
import { createNumberPad } from "./pad";

const emptyGrid = (): Grid => Array.from({ length: 9 }, () => new Array<number>(9).fill(0));

const MESSAGES = {
  invalid: "This grid has a repeated digit in a row, column or box. Fix the highlighted cells.",
  unsolvable: "No solution exists for this puzzle. Check that every digit was entered correctly.",
  multiple:
    "This puzzle has more than one solution, so it can't be solved uniquely. Check for missing digits.",
  solved: "Solved!",
} as const;

export function mountApp(root: HTMLElement): void {
  let givens = emptyGrid();
  let solution: Grid | null = null;

  root.innerHTML = `
    <header class="topbar"><span class="brand">Sudoku Solver</span></header>
    <main class="app">
      <div class="intro">
        <h1>Enter your puzzle</h1>
        <p>Tap a cell, then a number. On a keyboard, type digits and use the arrow keys.</p>
      </div>
      <div class="workspace">
        <div class="board-col"></div>
        <div class="side">
          <p class="message" role="status" aria-live="polite" data-testid="message"></p>
          <div class="actions">
            <button type="button" data-action="clear">Clear</button>
            <button type="button" class="primary" data-action="solve">Solve</button>
          </div>
        </div>
      </div>
    </main>`;

  const message = root.querySelector<HTMLParagraphElement>(".message") as HTMLParagraphElement;
  const side = root.querySelector<HTMLDivElement>(".side") as HTMLDivElement;

  const grid = createSudokuGrid({
    mode: "editable",
    onInput: (r, c, d) => setDigit(r, c, d),
    onEnter: doSolve,
  });
  root.querySelector(".board-col")?.appendChild(grid.el);
  side.prepend(
    createNumberPad((d) => {
      const { row, col } = grid.selected();
      setDigit(row, col, d);
    }),
  );

  function setMessage(text: string, kind: "" | "error" | "success" | "warning" = "") {
    message.textContent = text;
    message.dataset.kind = kind;
  }

  function render() {
    const conflicts = new Set(findConflicts(givens).map(({ row, col }) => `${row},${col}`));
    const cells: CellState[][] = givens.map((row, r) =>
      row.map((given, c) => ({
        value: given || (solution ? solution[r][c] : 0),
        given: given !== 0,
        conflict: conflicts.has(`${r},${c}`),
      })),
    );
    grid.render(cells);
  }

  function setDigit(r: number, c: number, d: number) {
    givens[r][c] = d;
    if (solution) {
      solution = null;
      setMessage("");
    }
    render();
  }

  function doSolve() {
    const res = solve(givens);
    if (res.status === "solved" && res.solution) {
      solution = res.solution;
      setMessage(MESSAGES.solved, "success");
    } else {
      solution = null;
      setMessage(MESSAGES[res.status], res.status === "multiple" ? "warning" : "error");
    }
    render();
  }

  function doClear() {
    givens = emptyGrid();
    solution = null;
    grid.select(0, 0);
    setMessage("");
    render();
  }

  root.querySelector('[data-action="solve"]')?.addEventListener("click", doSolve);
  root.querySelector('[data-action="clear"]')?.addEventListener("click", doClear);

  render();
}
