import { beforeAll, describe, expect, it } from "vitest";
import { defaultStyle, renderBoard, sampleGrid } from "./__fixtures__/render";
import {
  CELL_SIZE,
  cellsFrom,
  extractCells,
  findGridLines,
  flattenLighting,
  toGray,
  type Cell,
} from "./cells";
import { toImageData } from "./image";
import { loadOpenCv, type CV } from "./opencv";
import { BOARD_SIZE } from "./warp";

let cv: CV;
beforeAll(async () => {
  cv = await loadOpenCv();
});

const GRID = sampleGrid(3);
const STYLE = defaultStyle(BOARD_SIZE);

/** A clean top-down board as the warp step would produce it. */
function board(): ImageData {
  const mat = renderBoard(cv, GRID, STYLE);
  try {
    return toImageData(mat);
  } finally {
    mat.delete();
  }
}

/** Centre of rendered line i (same clamping as renderBoard). */
function lineCentre(i: number): number {
  const w = i % 3 === 0 ? STYLE.thick : STYLE.thin;
  const start = Math.min(Math.max(Math.round((i * BOARD_SIZE) / 9 - w / 2), 0), BOARD_SIZE - w);
  return start + (w - 1) / 2;
}

/** Resample `img` so output (x, y) shows input (x + dx(y), y + dy(x)): bows the lines. */
function bow(img: ImageData, dx: (y: number) => number, dy: (x: number) => number): ImageData {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, Math.max(0, Math.round(x + dx(y))));
      const sy = Math.min(h - 1, Math.max(0, Math.round(y + dy(x))));
      out.set(data.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
    }
  return { ...img, data: out };
}

/** Multiply brightness right of `edge` by `factor` (a hard shadow). */
function shade(img: ImageData, edge: number, factor: number): ImageData {
  const out = new Uint8ClampedArray(img.data);
  for (let y = 0; y < img.height; y++)
    for (let x = edge; x < img.width; x++)
      for (let c = 0; c < 3; c++) out[(y * img.width + x) * 4 + c] *= factor;
  return { ...img, data: out };
}

const flat = (img: ImageData) => flattenLighting(toGray(img), img.width, img.height);
const minOf = (a: Float32Array) => a.reduce((m, v) => Math.min(m, v), Infinity);
const bandCentre = (b: number) => ((b + 0.5) * BOARD_SIZE) / 9;

/** Lowest value on the crop's outer ring, `depth` pixels deep. */
function ringMin(cell: Cell, depth = 2): number {
  let min = Infinity;
  for (let y = 0; y < CELL_SIZE; y++)
    for (let x = 0; x < CELL_SIZE; x++) {
      const edge = Math.min(x, y, CELL_SIZE - 1 - x, CELL_SIZE - 1 - y);
      if (edge < depth) min = Math.min(min, cell.pixels[y * CELL_SIZE + x]);
    }
  return min;
}

describe("findGridLines", () => {
  it("finds every line of a flat board within 1.5 px", () => {
    const { cols, rows } = findGridLines(flat(board()));
    for (let k = 0; k <= 9; k++)
      for (let b = 0; b < 9; b++) {
        expect(Math.abs(cols[k][b] - lineCentre(k)), `col ${k} band ${b}`).toBeLessThanOrEqual(1.5);
        expect(Math.abs(rows[k][b] - lineCentre(k)), `row ${k} band ${b}`).toBeLessThanOrEqual(1.5);
      }
  });

  it("follows lines bowed by up to 12 px", () => {
    // Vertical lines bend left in the middle rows, horizontal ones bend up in the middle columns.
    const amp = 12;
    const d = (t: number) => amp * Math.sin((Math.PI * t) / BOARD_SIZE);
    const { cols, rows } = findGridLines(flat(bow(board(), d, d)));
    for (let k = 1; k <= 8; k++)
      for (let b = 0; b < 9; b++) {
        const want = lineCentre(k) - d(bandCentre(b));
        expect(Math.abs(cols[k][b] - want), `col ${k} band ${b}`).toBeLessThanOrEqual(3);
        expect(Math.abs(rows[k][b] - want), `row ${k} band ${b}`).toBeLessThanOrEqual(3);
      }
  });
});

describe("extractCells", () => {
  it("returns 81 crops, row-major, CELL_SIZE square", () => {
    const cells = extractCells(board());
    expect(cells).toHaveLength(81);
    expect(cells.map((c) => [c.row, c.col])).toEqual(
      Array.from({ length: 81 }, (_, i) => [Math.floor(i / 9), i % 9]),
    );
    for (const c of cells) expect(c.pixels).toHaveLength(CELL_SIZE * CELL_SIZE);
  });

  it("leaves no grid line in any blank crop, flat or bowed", () => {
    const d = (t: number) => 12 * Math.sin((Math.PI * t) / BOARD_SIZE);
    for (const img of [board(), bow(board(), d, d)]) {
      for (const c of extractCells(img).filter((c) => !GRID[c.row][c.col]))
        expect(ringMin(c), `cell ${c.row},${c.col}`).toBeGreaterThan(0.8);
    }
  });

  it("keeps digits dark and blank cells white", () => {
    for (const c of extractCells(board())) {
      const min = minOf(c.pixels);
      if (GRID[c.row][c.col]) expect(min, `digit ${c.row},${c.col}`).toBeLessThan(0.4);
      else expect(min, `blank ${c.row},${c.col}`).toBeGreaterThan(0.9);
    }
  });

  it("flattens a hard shadow so blank cells stay white on both sides of its edge", () => {
    // Edge at x = 230 runs through the middle of column 4.
    const shaded = shade(board(), 230, 0.4);
    const f = flat(shaded);
    for (const c of cellsFrom(f, findGridLines(f))) {
      const min = minOf(c.pixels);
      if (GRID[c.row][c.col]) expect(min, `digit ${c.row},${c.col}`).toBeLessThan(0.5);
      else expect(min, `blank ${c.row},${c.col}`).toBeGreaterThan(0.85);
    }
  });
});
