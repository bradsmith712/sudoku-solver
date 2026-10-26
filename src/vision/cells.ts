/**
 * Split a warped board (see warp.ts) into 81 cell crops with the grid lines removed.
 * Pure TypeScript on ImageData: no OpenCV, so nothing to delete.
 *
 * The board is first flattened for lighting (each pixel divided by the local paper
 * brightness), so shadows and dim photos come out as white paper with dark ink.
 * Grid lines are then found locally: a page that bows bends its lines by up to a
 * quarter cell, so each line is located per cell band rather than assumed straight
 * at 50 px spacing.
 */

/** Side of a normalized cell crop, in pixels. */
export const CELL_SIZE = 32;
/** Half-width of the grey-level close that estimates paper brightness; wider than strokes. */
const PAPER_RADIUS = 7;
/** A line is searched this far (px) from where a flat board puts it. */
const LINE_SEARCH = 15;
/** Most a line may move (px) between neighbouring bands: a 12 px bow moves about 4. */
const LINE_STEP = 5;
/** Ink given up per pixel a line moves between bands, so straight wins ties. */
const LINE_MOVE_COST = 0.5;
/** Fraction of the cell trimmed from each side so no line remnant reaches the crop. */
const CELL_INSET = 0.15;

/** Lighting-flattened board: per pixel, brightness over local paper brightness, in [0, 1]. */
export type Flat = { data: Float32Array; width: number; height: number };

/**
 * Grid line positions, per band. `cols[k][r]` is the x of vertical line k (0-9) across
 * row band r (0-8); `rows[k][c]` is the y of horizontal line k across column band c.
 */
export type GridLines = { cols: number[][]; rows: number[][] };

export type Cell = {
  row: number;
  col: number;
  /** Crop rectangle in warped-board pixels (inside the cell's lines). */
  rect: { x: number; y: number; width: number; height: number };
  /** CELL_SIZE x CELL_SIZE, row-major, flattened brightness: 1 = paper, near 0 = ink. */
  pixels: Float32Array;
};

/** Luma of an RGBA image. */
export function toGray(img: ImageData): Float32Array {
  const { data, width, height } = img;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return out;
}

/** Sliding max or min over a (2r+1) window along rows or columns, clamped at edges. */
function filter1d(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
  op: "max" | "min",
): Float32Array {
  const out = new Float32Array(src.length);
  const [n, lines] = horizontal ? [w, h] : [h, w];
  const at = (line: number, i: number) => (horizontal ? line * w + i : i * w + line);
  for (let line = 0; line < lines; line++) {
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - r);
      const hi = Math.min(n - 1, i + r);
      let acc = op === "max" ? -Infinity : Infinity;
      for (let j = lo; j <= hi; j++) {
        const v = src[at(line, j)];
        acc = op === "max" ? Math.max(acc, v) : Math.min(acc, v);
      }
      out[at(line, i)] = acc;
    }
  }
  return out;
}

/**
 * Divide out the lighting. Paper brightness is estimated with a grey-level closing
 * (max then min filter) wide enough to erase strokes and grid lines; each pixel
 * becomes its fraction of that, capped at 1. A closing keeps a hard shadow edge in
 * place, so it is not smoothed afterwards: blurring the estimate would make a strip
 * along the dark side of the edge look like ink.
 */
export function flattenLighting(gray: Float32Array, width: number, height: number): Flat {
  const r = PAPER_RADIUS;
  let bg = filter1d(gray, width, height, r, true, "max");
  bg = filter1d(bg, width, height, r, false, "max");
  bg = filter1d(bg, width, height, r, true, "min");
  bg = filter1d(bg, width, height, r, false, "min");
  const data = new Float32Array(gray.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.min(1, gray[i] / Math.max(bg[i], 1));
  return { data, width, height };
}

/**
 * Locate the 10 vertical and 10 horizontal grid lines, per band. Each line is traced
 * through the 9 bands with dynamic programming: at every band it may sit anywhere
 * within LINE_SEARCH of k/9 of the side, moving at most LINE_STEP between neighbouring
 * bands, and the path with the most ink (less a small cost per pixel moved) wins. A
 * grid line has ink in every band and a digit stroke next to it in only one or two,
 * so the trace stays on the line however far the page bows. Positions are the middle
 * of a thick line, not its edge.
 */
export function findGridLines(flat: Flat): GridLines {
  const { data, width: w, height: h } = flat;
  const locate = (vertical: boolean): number[][] => {
    const span = vertical ? w : h; // axis the line position runs along
    const along = vertical ? h : w; // axis the line extends along
    // ink[b][p]: darkness summed along band b at position p.
    const ink = Array.from({ length: 9 }, (_, b) => {
      const from = Math.round((b * along) / 9);
      const to = Math.round(((b + 1) * along) / 9);
      const sums = new Float64Array(span);
      for (let p = 0; p < span; p++)
        for (let t = from; t < to; t++) sums[p] += 1 - data[vertical ? t * w + p : p * w + t];
      return sums;
    });
    const lines: number[][] = [];
    for (let k = 0; k <= 9; k++) {
      const expected = (k * (span - 1)) / 9;
      const lo = Math.max(0, Math.round(expected - LINE_SEARCH));
      const hi = Math.min(span - 1, Math.round(expected + LINE_SEARCH));
      const n = hi - lo + 1;
      // score[b][i]: best total ink of a path ending at position lo + i in band b.
      const score = Array.from({ length: 9 }, () => new Float64Array(n));
      const from = Array.from({ length: 9 }, () => new Int32Array(n));
      for (let i = 0; i < n; i++) score[0][i] = ink[0][lo + i];
      for (let b = 1; b < 9; b++)
        for (let i = 0; i < n; i++) {
          let best = -Infinity;
          for (let j = Math.max(0, i - LINE_STEP); j <= Math.min(n - 1, i + LINE_STEP); j++) {
            const v = score[b - 1][j] - LINE_MOVE_COST * Math.abs(i - j);
            if (v > best) {
              best = v;
              from[b][i] = j;
            }
          }
          score[b][i] = best + ink[b][lo + i];
        }
      let end = 0;
      for (let i = 1; i < n; i++) if (score[8][i] > score[8][end]) end = i;
      const path = new Array<number>(9);
      for (let b = 8, i = end; b >= 0; i = from[b][i], b--) path[b] = i;
      lines.push(path.map((i, b) => centreOfRun(ink[b], lo + i, lo, hi)));
    }
    return lines;
  };
  return { cols: locate(true), rows: locate(false) };
}

/** Middle of the run of near-equal maximum ink around `p` (a thick line's centre). */
function centreOfRun(ink: Float64Array, p: number, lo: number, hi: number): number {
  const level = ink[p] * 0.9;
  let a = p;
  let b = p;
  while (a > lo && ink[a - 1] >= level) a--;
  while (b < hi && ink[b + 1] >= level) b++;
  return (a + b) / 2;
}

/** Bilinear sample of the flattened board, clamped at the edges. */
function sample(flat: Flat, x: number, y: number): number {
  const { data, width: w, height: h } = flat;
  const cx = Math.min(Math.max(x, 0), w - 1);
  const cy = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const top = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
  const bottom = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * The 81 cells of a warped board, row-major. Each crop spans the cell between its
 * local grid lines, trimmed by CELL_INSET on every side, resampled to CELL_SIZE.
 */
export function extractCells(warped: ImageData): Cell[] {
  const flat = flattenLighting(toGray(warped), warped.width, warped.height);
  return cellsFrom(flat, findGridLines(flat));
}

/** Crops for already-located lines (exposed for tests and debug output). */
export function cellsFrom(flat: Flat, lines: GridLines): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const left = lines.cols[col][row];
      const right = lines.cols[col + 1][row];
      const top = lines.rows[row][col];
      const bottom = lines.rows[row + 1][col];
      const insetX = (right - left) * CELL_INSET;
      const insetY = (bottom - top) * CELL_INSET;
      const rect = {
        x: left + insetX,
        y: top + insetY,
        width: right - left - 2 * insetX,
        height: bottom - top - 2 * insetY,
      };
      const pixels = new Float32Array(CELL_SIZE * CELL_SIZE);
      for (let y = 0; y < CELL_SIZE; y++) {
        for (let x = 0; x < CELL_SIZE; x++) {
          pixels[y * CELL_SIZE + x] = sample(
            flat,
            rect.x + ((x + 0.5) * rect.width) / CELL_SIZE - 0.5,
            rect.y + ((y + 0.5) * rect.height) / CELL_SIZE - 0.5,
          );
        }
      }
      cells.push({ row, col, rect, pixels });
    }
  }
  return cells;
}
