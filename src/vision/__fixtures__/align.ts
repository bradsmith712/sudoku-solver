/** Alignment checks for detected boards, used by the fixture accuracy test. */
import { distance, type Point } from "../geometry";

/**
 * Largest distance between detected and true corners, as a fraction of the true
 * board's mean side. Allows a cyclic shift: whether the puzzle is upright is a
 * recognition question, not a detection one.
 */
export function cornerError(found: readonly Point[], truth: readonly Point[]): number {
  const side = truth.reduce((s, p, i) => s + distance(p, truth[(i + 1) % 4]), 0) / truth.length;
  let best = Infinity;
  for (let shift = 0; shift < 4; shift++) {
    const worst = Math.max(...found.map((p, i) => distance(p, truth[(i + shift) % 4])));
    best = Math.min(best, worst);
  }
  return best / side;
}

/**
 * Check a warped board against the expected grid geometry without ground-truth
 * corners: in each axis, the darkness profile should peak near
 * every line position k * size / 9 (searched within +-window px). Works for real
 * photos labelled with only a `grid`.
 * Returns the worst offset in pixels.
 */
export function gridLineOffset(warped: ImageData, window = 12): number {
  const { width: w, height: h, data } = warped;
  const cols = new Float64Array(w);
  const rows = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dark = 255 - (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      cols[x] += dark;
      rows[y] += dark;
    }
  }
  const worst = (raw: Float64Array) => {
    const n = raw.length;
    // Subtract a moving average so lighting gradients do not push peaks to the
    // edge of the search window.
    const half = 15;
    const profile = raw.map((v, i) => {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++, count++)
        sum += raw[j];
      return v - sum / count;
    });
    let max = 0;
    for (let k = 0; k <= 9; k++) {
      const expected = Math.min(n - 1, Math.round((k * n) / 9));
      let peak = expected;
      for (let x = Math.max(0, expected - window); x <= Math.min(n - 1, expected + window); x++) {
        if (profile[x] > profile[peak]) peak = x;
      }
      max = Math.max(max, Math.abs(peak - expected));
    }
    return max;
  };
  return Math.max(worst(cols), worst(rows));
}
