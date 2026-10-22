/**
 * Test-only drawing helpers: render a flat sudoku board with OpenCV and place it
 * into a larger scene under a perspective transform, so tests know the exact
 * board corners. Used by unit tests and make-fixtures.ts; never by app code.
 */
import type { Mat } from "@techstark/opencv-js";
import type { Point } from "../geometry";
import type { CV } from "../opencv";
import type { Grid } from "../../types";

export type Rgba = [number, number, number, number];

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BoardStyle = {
  /** Board side in pixels; the outer border's outside edge is the image edge. */
  size: number;
  thick: number;
  thin: number;
  font: number;
  ink: Rgba;
  paper: Rgba;
};

export const defaultStyle = (size: number): BoardStyle => ({
  size,
  thick: Math.max(3, Math.round(size / 90)),
  thin: Math.max(1, Math.round(size / 300)),
  font: 0, // cv.FONT_HERSHEY_SIMPLEX
  ink: [20, 20, 20, 255],
  paper: [250, 250, 245, 255],
});

/** Render a top-down board. Caller deletes the returned RGBA Mat. */
export function renderBoard(cv: CV, grid: Grid, style: BoardStyle): Mat {
  const { size: s, thick, thin, ink, paper } = style;
  const board = new cv.Mat(s, s, cv.CV_8UC4, paper);
  const cell = s / 9;
  for (let i = 0; i <= 9; i++) {
    const w = i % 3 === 0 ? thick : thin;
    // Keep the outer border fully inside the image so its outside edge is at 0 and s.
    const start = Math.min(Math.max(Math.round(i * cell - w / 2), 0), s - w);
    cv.rectangle(board, new cv.Point(start, 0), new cv.Point(start + w - 1, s - 1), ink, -1);
    cv.rectangle(board, new cv.Point(0, start), new cv.Point(s - 1, start + w - 1), ink, -1);
  }
  const scale = cell / 45;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const d = grid[r][c];
      if (!d) continue;
      const text = String(d);
      // getTextSize is not exported by opencv.js; Hershey simplex digits are about
      // 20 x 21 units at scale 1.
      const ts = { width: 20 * scale, height: 21 * scale };
      const x = Math.round(c * cell + (cell - ts.width) / 2);
      const y = Math.round(r * cell + (cell + ts.height) / 2);
      cv.putText(
        board,
        text,
        new cv.Point(x, y),
        style.font,
        scale,
        ink,
        Math.max(1, Math.round(scale * 2)),
        cv.LINE_AA,
      );
    }
  }
  return board;
}

/**
 * Warp `board` onto `scene` (in place) so its corners land on `corners`
 * (TL, TR, BR, BL).
 */
export function placeBoard(cv: CV, scene: Mat, board: Mat, corners: readonly Point[]): void {
  const s = board.cols;
  const src = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, s, 0, s, s, 0, s]);
  const dst = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    corners.flatMap((p) => [p.x, p.y]),
  );
  const m = cv.getPerspectiveTransform(src, dst);
  const warped = new cv.Mat();
  const mask = new cv.Mat();
  const ones = new cv.Mat(s, s, cv.CV_8UC1, new cv.Scalar(255));
  const size = new cv.Size(scene.cols, scene.rows);
  try {
    cv.warpPerspective(
      board,
      warped,
      m,
      size,
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(),
    );
    cv.warpPerspective(ones, mask, m, size, cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar());
    warped.copyTo(scene, mask);
  } finally {
    for (const x of [src, dst, m, warped, mask, ones]) x.delete();
  }
}

/** A puzzle-looking grid: about 30 givens, deterministic per seed. */
export function sampleGrid(seed: number): Grid {
  const r = rng(seed);
  return Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => (r() < 0.37 ? 1 + Math.floor(r() * 9) : 0)),
  );
}

/** Plain RGBA scene. Caller deletes. */
export function blankScene(cv: CV, width: number, height: number, color: Rgba): Mat {
  return new cv.Mat(height, width, cv.CV_8UC4, color);
}

/** Multiply brightness by a left-to-right ramp (uneven lighting). */
export function applyLighting(scene: Mat, from: number, to: number): void {
  const d = scene.data;
  const w = scene.cols;
  for (let y = 0; y < scene.rows; y++) {
    for (let x = 0; x < w; x++) {
      const k = from + ((to - from) * x) / (w - 1);
      const i = (y * w + x) * 4;
      d[i] = Math.min(255, d[i] * k);
      d[i + 1] = Math.min(255, d[i + 1] * k);
      d[i + 2] = Math.min(255, d[i + 2] * k);
    }
  }
}

/** Add Gaussian-ish noise with the given standard deviation (deterministic). */
export function applyNoise(scene: Mat, sigma: number, seed: number): void {
  const r = rng(seed);
  const d = scene.data;
  for (let i = 0; i < d.length; i += 4) {
    // Sum of uniforms approximates a normal distribution.
    const n = (r() + r() + r() + r() - 2) * sigma * 1.73;
    for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, d[i + k] + n));
  }
}

export function applyBlur(cv: CV, scene: Mat, k: number): void {
  cv.GaussianBlur(scene, scene, new cv.Size(k, k), 0);
}

/** Random circles, lines and text that are not quadrilaterals. */
export function applyClutter(cv: CV, scene: Mat, seed: number, count: number): void {
  const r = rng(seed);
  const w = scene.cols;
  const h = scene.rows;
  for (let i = 0; i < count; i++) {
    const color: Rgba = [r() * 120, r() * 120, r() * 120, 255];
    const p = new cv.Point(Math.round(r() * w), Math.round(r() * h));
    const kind = i % 3;
    if (kind === 0) cv.circle(scene, p, Math.round(5 + r() * 40), color, 1 + Math.round(r() * 3));
    else if (kind === 1)
      cv.line(
        scene,
        p,
        new cv.Point(Math.round(r() * w), Math.round(r() * h)),
        color,
        1 + Math.round(r() * 2),
      );
    else cv.putText(scene, "news 42", p, 0, 0.5 + r(), color, 1 + Math.round(r() * 2));
  }
}
