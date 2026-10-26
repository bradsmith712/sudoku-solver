/**
 * The one shared 9x9 board (CLAUDE.md: never fork the grid per screen). Cells are
 * plain divs, never inputs, so tapping one cannot open the system keyboard; digits
 * come from the number pad (pad.ts) or a physical keyboard on desktop.
 *
 * Modes:
 *  - "editable": manual entry. Selectable, keyboard input, conflicts shown.
 *  - "highlight": review after a scan. Editable, plus low-confidence and
 *    repaired ("changed") cells are marked.
 *  - "readonly": the solution view. No selection or input.
 */
export type GridMode = "editable" | "highlight" | "readonly";

export type CellState = {
  /** 0 = blank, 1-9 = digit. */
  value: number;
  /** Part of the puzzle (entered or scanned), as opposed to filled in by the solver. */
  given: boolean;
  low?: boolean;
  conflict?: boolean;
  /** Set by repair, not by the user; shown only in "highlight" mode. */
  changed?: boolean;
};

export type SudokuGrid = {
  el: HTMLDivElement;
  setMode(mode: GridMode): void;
  render(cells: CellState[][]): void;
  selected(): { row: number; col: number };
  select(row: number, col: number): void;
  /** Draw `image` (the warped board) under the cells; given digits then show through from it. */
  setBackground(image: ImageData | null): void;
};

export type GridOptions = {
  mode: GridMode;
  label?: string;
  /** A digit (0 = erase) typed while a cell is selected. */
  onInput?: (row: number, col: number, digit: number) => void;
  /** A cell was tapped or moved to. */
  onSelect?: (row: number, col: number) => void;
  /** Enter pressed on the board. */
  onEnter?: () => void;
};

const ERASE_KEYS = ["0", "Backspace", "Delete", " "];
const MOVES: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

export function createSudokuGrid(opts: GridOptions): SudokuGrid {
  let mode = opts.mode;
  let sel: [number, number] = [0, 0];
  let last: CellState[][] | null = null;

  const el = document.createElement("div");
  el.className = "board";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", opts.label ?? "Sudoku grid");

  const canvas = document.createElement("canvas");
  canvas.className = "board-photo";
  canvas.hidden = true;
  canvas.setAttribute("aria-hidden", "true");
  el.appendChild(canvas);

  const cells: HTMLDivElement[][] = [];
  for (let r = 0; r < 9; r++) {
    cells.push([]);
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.setAttribute("role", "img");
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      el.appendChild(cell);
      cells[r].push(cell);
    }
  }

  const interactive = () => mode !== "readonly";

  function paint() {
    el.dataset.mode = mode;
    if (interactive()) el.tabIndex = 0;
    else el.removeAttribute("tabindex");
    if (!last) return;
    const marks = mode === "highlight";
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const s = last[r][c];
        const node = cells[r][c];
        node.textContent = s.value ? String(s.value) : "";
        node.classList.toggle("given", s.value !== 0 && s.given);
        node.classList.toggle("solved", s.value !== 0 && !s.given);
        node.classList.toggle("conflict", !!s.conflict);
        node.classList.toggle("low", marks && !!s.low);
        node.classList.toggle("changed", marks && !!s.changed);
        const isSel = interactive() && sel[0] === r && sel[1] === c;
        node.classList.toggle("selected", isSel);
        if (isSel) node.setAttribute("aria-current", "true");
        else node.removeAttribute("aria-current");
        const notes = [
          s.value ? (s.given ? `${s.value}` : `${s.value}, solved`) : "blank",
          marks && s.low ? "low confidence" : "",
          s.conflict ? "conflict" : "",
          marks && s.changed ? "changed by repair" : "",
        ].filter(Boolean);
        node.setAttribute("aria-label", `Row ${r + 1}, column ${c + 1}: ${notes.join(", ")}`);
      }
    }
  }

  function select(row: number, col: number) {
    sel = [Math.max(0, Math.min(8, row)), Math.max(0, Math.min(8, col))];
    paint();
    opts.onSelect?.(sel[0], sel[1]);
  }

  el.addEventListener("pointerdown", (e) => {
    if (!interactive()) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>(".cell");
    if (t) select(Number(t.dataset.row), Number(t.dataset.col));
  });

  el.addEventListener("keydown", (e) => {
    if (!interactive()) return;
    const [r, c] = sel;
    if (/^[1-9]$/.test(e.key)) opts.onInput?.(r, c, Number(e.key));
    else if (ERASE_KEYS.includes(e.key)) opts.onInput?.(r, c, 0);
    else if (e.key in MOVES) select(r + MOVES[e.key][0], c + MOVES[e.key][1]);
    else if (e.key === "Enter") opts.onEnter?.();
    else return;
    e.preventDefault();
  });

  return {
    el,
    setMode(m) {
      mode = m;
      paint();
    },
    render(state) {
      last = state;
      paint();
    },
    selected: () => ({ row: sel[0], col: sel[1] }),
    select,
    setBackground(image) {
      el.classList.toggle("on-photo", !!image);
      canvas.hidden = !image;
      if (!image) return;
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext("2d")?.putImageData(image, 0, 0);
    },
  };
}
