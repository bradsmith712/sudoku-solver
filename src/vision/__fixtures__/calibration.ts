/**
 * Calibration measures shared by tools/train/calibrate.ts (fitting the temperature)
 * and vision.eval.test.ts (reporting). Not shipped.
 */

/** One prediction: its confidence and whether it was right. */
export type Prediction = { confidence: number; correct: boolean };

/**
 * Expected calibration error: predictions binned by confidence into `bins` equal-width
 * bins; the size-weighted mean of |accuracy - mean confidence| per bin.
 */
export function expectedCalibrationError(preds: Prediction[], bins = 15): number {
  if (!preds.length) return 0;
  const count = new Array<number>(bins).fill(0);
  const conf = new Array<number>(bins).fill(0);
  const right = new Array<number>(bins).fill(0);
  for (const p of preds) {
    const b = Math.min(bins - 1, Math.floor(p.confidence * bins));
    count[b]++;
    conf[b] += p.confidence;
    if (p.correct) right[b]++;
  }
  let ece = 0;
  for (let b = 0; b < bins; b++) if (count[b]) ece += Math.abs(right[b] - conf[b]) / preds.length;
  return ece;
}

/** Mean negative log-likelihood of the true class for 9-way logits at `temperature`. */
export function meanNll(logits: Float32Array, labels: Uint8Array, temperature: number): number {
  let total = 0;
  for (let i = 0; i < labels.length; i++) {
    const row = logits.subarray(i * 9, i * 9 + 9);
    let max = -Infinity;
    for (const v of row) max = Math.max(max, v / temperature);
    let sum = 0;
    for (const v of row) sum += Math.exp(v / temperature - max);
    total += Math.log(sum) + max - row[labels[i] - 1] / temperature;
  }
  return total / labels.length;
}

/** The temperature minimising meanNll, by golden-section search on log T in [1/20, 20]. */
export function fitTemperature(logits: Float32Array, labels: Uint8Array): number {
  const f = (logT: number) => meanNll(logits, labels, Math.exp(logT));
  const g = (Math.sqrt(5) - 1) / 2;
  let [a, b] = [Math.log(1 / 20), Math.log(20)];
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let [fc, fd] = [f(c), f(d)];
  while (b - a > 1e-5) {
    if (fc < fd) {
      [b, d, fd] = [d, c, fc];
      c = b - g * (b - a);
      fc = f(c);
    } else {
      [a, c, fc] = [c, d, fd];
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return Math.exp((a + b) / 2);
}
