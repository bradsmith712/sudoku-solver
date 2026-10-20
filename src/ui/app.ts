import { solve } from "../solver/solver";
import type { Grid } from "../types";

const emptyGrid = (): Grid => Array.from({ length: 9 }, () => new Array<number>(9).fill(0));

/** Cells (as "r,c") that share a row, column or box with an equal digit. */
export function findConflicts(grid: Grid): Set<string> {
  const bad = new Set<string>();
  const units: [number, number][][] = [];
  for (let k = 0; k < 9; k++) {
    units.push(Array.from({ length: 9 }, (_, i): [number, number] => [k, i]));
    units.push(Array.from({ length: 9 }, (_, i): [number, number] => [i, k]));
    const [br, bc] = [Math.floor(k / 3) * 3, (k % 3) * 3];
    units.push(
      Array.from({ length: 9 }, (_, i): [number, number] => [br + Math.floor(i / 3), bc + (i % 3)]),
    );
  }
  for (const unit of units) {
    const seen = new Map<number, [number, number]>();
    for (const [r, c] of unit) {
      const v = grid[r][c];
      if (!v) continue;
      const prev = seen.get(v);
      if (prev) {
        bad.add(`${prev[0]},${prev[1]}`);
        bad.add(`${r},${c}`);
      } else seen.set(v, [r, c]);
    }
  }
  return bad;
}

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
  let selected: [number, number] = [0, 0];

  root.innerHTML = `
    <main class="app">
      <h1>Sudoku Solver</h1>
      <div class="board" role="group" aria-label="Sudoku grid" tabindex="0"></div>
      <p class="message" role="status" aria-live="polite" data-testid="message"></p>
      <div class="pad" role="group" aria-label="Number pad"></div>
      <div class="actions">
        <button type="button" class="primary" data-action="solve">Solve</button>
        <button type="button" data-action="clear">Clear</button>
      </div>
    </main>`;

  const board = root.querySelector<HTMLDivElement>(".board") as HTMLDivElement;
  const message = root.querySelector<HTMLParagraphElement>(".message") as HTMLParagraphElement;
  const pad = root.querySelector<HTMLDivElement>(".pad") as HTMLDivElement;

  const cells: HTMLDivElement[][] = [];
  for (let r = 0; r < 9; r++) {
    cells.push([]);
    for (let c = 0; c < 9; c++) {
      const el = document.createElement("div");
      el.className = "cell";
      el.setAttribute("role", "img");
      el.dataset.row = String(r);
      el.dataset.col = String(c);
      el.setAttribute("aria-label", `Row ${r + 1}, column ${c + 1}`);
      board.appendChild(el);
      cells[r].push(el);
    }
  }

  for (let d = 1; d <= 9; d++) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = String(d);
    b.dataset.digit = String(d);
    b.setAttribute("aria-label", `Enter ${d}`);
    pad.appendChild(b);
  }
  const erase = document.createElement("button");
  erase.type = "button";
  erase.textContent = "⌫";
  erase.dataset.digit = "0";
  erase.setAttribute("aria-label", "Erase");
  pad.appendChild(erase);

  function setMessage(text: string, kind: "" | "error" | "success" | "warning" = "") {
    message.textContent = text;
    message.dataset.kind = kind;
  }

  function render() {
    const conflicts = findConflicts(givens);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const el = cells[r][c];
        const given = givens[r][c];
        const solved = !given && solution ? solution[r][c] : 0;
        el.textContent = given ? String(given) : solved ? String(solved) : "";
        el.classList.toggle("given", given !== 0);
        el.classList.toggle("solved", solved !== 0);
        el.classList.toggle("conflict", conflicts.has(`${r},${c}`));
        const isSel = selected[0] === r && selected[1] === c;
        el.classList.toggle("selected", isSel);
        if (isSel) el.setAttribute("aria-current", "true");
        else el.removeAttribute("aria-current");
      }
    }
  }

  function setDigit(d: number) {
    const [r, c] = selected;
    givens[r][c] = d;
    if (solution) {
      solution = null;
      setMessage("");
    }
    render();
  }

  function select(r: number, c: number) {
    selected = [Math.max(0, Math.min(8, r)), Math.max(0, Math.min(8, c))];
    render();
  }

  function doSolve() {
    const res = solve(givens);
    if (res.status === "solved" && res.solution) {
      solution = res.solution;
      setMessage(MESSAGES.solved, "success");
    } else {
      solution = null;
      setMessage(
        MESSAGES[res.status as "invalid" | "unsolvable" | "multiple"],
        res.status === "multiple" ? "warning" : "error",
      );
    }
    render();
  }

  function doClear() {
    givens = emptyGrid();
    solution = null;
    selected = [0, 0];
    setMessage("");
    render();
  }

  board.addEventListener("pointerdown", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".cell");
    if (t) select(Number(t.dataset.row), Number(t.dataset.col));
  });

  board.addEventListener("keydown", (e) => {
    const [r, c] = selected;
    if (/^[1-9]$/.test(e.key)) setDigit(Number(e.key));
    else if (e.key === "0" || e.key === "Backspace" || e.key === "Delete" || e.key === " ")
      setDigit(0);
    else if (e.key === "ArrowUp") select(r - 1, c);
    else if (e.key === "ArrowDown") select(r + 1, c);
    else if (e.key === "ArrowLeft") select(r, c - 1);
    else if (e.key === "ArrowRight") select(r, c + 1);
    else if (e.key === "Enter") doSolve();
    else return;
    e.preventDefault();
  });

  pad.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("button[data-digit]");
    if (t) setDigit(Number(t.dataset.digit));
  });

  root.querySelector('[data-action="solve"]')?.addEventListener("click", doSolve);
  root.querySelector('[data-action="clear"]')?.addEventListener("click", doClear);

  render();
}
