/** Quarter turns for board orientation. Pure JS: no OpenCV, no DOM. */

/** Clockwise quarter turns: 0, 1, 2 or 3 (0, 90, 180, 270 degrees). */
export type QuarterTurns = 0 | 1 | 2 | 3;

/** `image` rotated clockwise by `turns` quarter turns, as a new ImageData-shaped object. */
export function rotateImage(image: ImageData, turns: QuarterTurns): ImageData {
  if (turns === 0) return image;
  const { width: w, height: h, data } = image;
  const W = turns === 2 ? w : h;
  const H = turns === 2 ? h : w;
  // One 32-bit word per RGBA pixel; copy first if the view is not 4-byte aligned.
  const bytes = data.byteOffset % 4 ? data.slice() : data;
  const src = new Uint32Array(bytes.buffer, bytes.byteOffset, w * h);
  const out = new Uint8ClampedArray(W * H * 4);
  const dst = new Uint32Array(out.buffer);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Where source (x, y) lands after the turn.
      let X: number;
      let Y: number;
      if (turns === 1) [X, Y] = [h - 1 - y, x];
      else if (turns === 2) [X, Y] = [w - 1 - x, h - 1 - y];
      else [X, Y] = [y, w - 1 - x];
      dst[Y * W + X] = src[y * w + x];
    }
  }
  if (typeof ImageData !== "undefined") return new ImageData(out, W, H);
  return { data: out, width: W, height: H, colorSpace: "srgb" } as ImageData;
}

/**
 * The row-major 3x3 homography `h` (source -> board) followed by turning the
 * `size` x `size` board clockwise by `turns`, so it maps source pixels onto the
 * rotated board. Continuous coordinates: a clockwise turn sends (x, y) to (size - y, x).
 */
export function rotateHomography(
  h: readonly number[],
  turns: QuarterTurns,
  size: number,
): number[] {
  let m = [...h];
  for (let t = 0; t < turns; t++) {
    // [0 -1 size; 1 0 0; 0 0 1] * m
    m = [
      -m[3] + size * m[6],
      -m[4] + size * m[7],
      -m[5] + size * m[8],
      m[0],
      m[1],
      m[2],
      m[6],
      m[7],
      m[8],
    ];
  }
  return m;
}

/** A 9x9 grid turned clockwise by `turns` quarter turns. */
export function rotateGrid<T>(grid: readonly (readonly T[])[], turns: QuarterTurns): T[][] {
  let g = grid.map((row) => [...row]);
  for (let t = 0; t < turns; t++) g = g[0].map((_, c) => g.map((row) => row[c]).reverse());
  return g;
}
