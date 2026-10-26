import { describe, expect, it } from "vitest";
import { INK_RATIO, inkFraction, isDigit, largestInkBlob } from "./blank";
import { CELL_SIZE, extractCells, type Cell } from "./cells";
import { BOARD_SIZE } from "./warp";

/** A crop whose flattened brightness at (x, y) is `f(x, y)` (1 = paper). */
function cellOf(f: (x: number, y: number) => number): Cell {
  const pixels = new Float32Array(CELL_SIZE * CELL_SIZE);
  for (let y = 0; y < CELL_SIZE; y++)
    for (let x = 0; x < CELL_SIZE; x++) pixels[y * CELL_SIZE + x] = f(x, y);
  return { row: 0, col: 0, rect: { x: 0, y: 0, width: CELL_SIZE, height: CELL_SIZE }, pixels };
}

/** Deterministic pseudo-random numbers in [0, 1). */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const inRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
  x >= x0 && x < x1 && y >= y0 && y < y1;

/** Rough "1" and "8" strokes in crop coordinates (32 px). */
const ONE = (x: number, y: number) => inRect(x, y, 15, 6, 18, 26);
const EIGHT = (x: number, y: number) =>
  (inRect(x, y, 10, 5, 22, 16) && !inRect(x, y, 13, 8, 19, 13)) ||
  (inRect(x, y, 10, 15, 22, 27) && !inRect(x, y, 13, 18, 19, 24));

describe("isDigit on crops", () => {
  it("calls a white cell blank", () => {
    const c = cellOf(() => 1);
    expect([inkFraction(c), largestInkBlob(c), isDigit(c)]).toEqual([0, 0, false]);
  });

  it("calls a noisy blank cell blank", () => {
    const r = rand(1);
    // Scattered single dark specks: plenty of ink pixels, but no blob.
    const c = cellOf(() => (r() < 0.06 ? 0.3 : 0.97 + 0.03 * r()));
    expect(inkFraction(c)).toBeGreaterThan(0.03);
    expect(isDigit(c)).toBe(false);
  });

  it("calls a thin 1 and an 8 digits", () => {
    expect(isDigit(cellOf((x, y) => (ONE(x, y) ? 0.2 : 1)))).toBe(true);
    expect(isDigit(cellOf((x, y) => (EIGHT(x, y) ? 0.2 : 1)))).toBe(true);
  });

  it("calls a digit a few pixels off centre a digit", () => {
    expect(isDigit(cellOf((x, y) => (ONE(x - 4, y + 2) ? 0.2 : 1)))).toBe(true);
  });

  it("calls faint show-through blank", () => {
    // Mirror image of an 8 at 12% and 15% darker than the paper.
    for (const shade of [0.88, 0.85]) {
      expect(shade).toBeGreaterThan(INK_RATIO);
      expect(isDigit(cellOf((x, y) => (EIGHT(CELL_SIZE - 1 - x, y) ? shade : 1)))).toBe(false);
    }
  });
});

describe("isDigit on boards (through lighting flattening)", () => {
  const PAPER = 235;
  const INK = 30;
  const SHOW = PAPER * 0.86; // show-through, 14% darker than the paper
  const cell = BOARD_SIZE / 9;
  // Pattern per cell: 1 = "1", 8 = "8", -1 = mirrored "8" show-through, 0 = blank.
  const LAYOUT = Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => [1, 0, 8, 0, -1, 0, 0, 8, -1][(r * 4 + c) % 9]),
  );

  /** Draw a board in grey, then apply `light(x, y)` as a brightness factor. */
  function board(light: (x: number, y: number) => number): ImageData {
    const data = new Uint8ClampedArray(BOARD_SIZE * BOARD_SIZE * 4);
    for (let y = 0; y < BOARD_SIZE; y++)
      for (let x = 0; x < BOARD_SIZE; x++) {
        const r = Math.min(8, Math.floor(y / cell));
        const c = Math.min(8, Math.floor(x / cell));
        // Crop coordinates of this pixel (cells.ts crops the middle 70% of the cell).
        const cx = Math.floor(((x - c * cell - 0.15 * cell) / (0.7 * cell)) * CELL_SIZE);
        const cy = Math.floor(((y - r * cell - 0.15 * cell) / (0.7 * cell)) * CELL_SIZE);
        const lx = x % cell;
        const ly = y % cell;
        const line =
          Math.min(lx, cell - lx) < (c % 3 === 0 && lx < 3 ? 3 : 1.5) ||
          Math.min(ly, cell - ly) < (r % 3 === 0 && ly < 3 ? 3 : 1.5) ||
          x >= BOARD_SIZE - 3 ||
          y >= BOARD_SIZE - 3;
        const p = LAYOUT[r][c];
        let v = PAPER;
        if (line) v = INK;
        else if (p === 1 && ONE(cx, cy)) v = INK;
        else if (p === 8 && EIGHT(cx, cy)) v = INK;
        else if (p === -1 && EIGHT(CELL_SIZE - 1 - cx, cy)) v = SHOW;
        v *= light(x, y);
        data.set([v, v, v, 255], (y * BOARD_SIZE + x) * 4);
      }
    return { data, width: BOARD_SIZE, height: BOARD_SIZE, colorSpace: "srgb" } as ImageData;
  }

  const expectLayout = (img: ImageData) => {
    for (const c of extractCells(img))
      expect(isDigit(c), `cell ${c.row},${c.col}`).toBe(LAYOUT[c.row][c.col] > 0);
  };

  it("reads digits, blanks and show-through in even light", () => {
    expectLayout(board(() => 1));
  });

  it("reads them in a dim photo", () => {
    expectLayout(board(() => 0.35));
  });

  it("reads them under a lighting gradient and a hard shadow edge", () => {
    expectLayout(board((x, y) => (0.6 + (0.4 * y) / BOARD_SIZE) * (x > 230 ? 0.45 : 1)));
  });
});
