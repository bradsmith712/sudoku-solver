import { describe, expect, it } from "vitest";
import { expectedCalibrationError, fitTemperature, meanNll } from "./calibration";

describe("expectedCalibrationError", () => {
  it("is 0 when confidence matches accuracy and grows with overconfidence", () => {
    const fair = [0.75, 0.75, 0.75, 0.75].map((confidence, i) => ({ confidence, correct: i < 3 }));
    expect(expectedCalibrationError(fair)).toBeCloseTo(0);
    const over = fair.map((p) => ({ ...p, confidence: 0.99 }));
    expect(expectedCalibrationError(over)).toBeCloseTo(0.24);
  });
});

describe("fitTemperature", () => {
  it("recovers the temperature that generated the labels' likelihoods", () => {
    // Logits scaled up 3x from a calibrated set: the best temperature is about 3.
    const n = 3000;
    const logits = new Float32Array(n * 9);
    const labels = new Uint8Array(n);
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const base = Array.from({ length: 9 }, () => rand() * 3);
      const p = base.map(Math.exp);
      const sum = p.reduce((a, b) => a + b, 0);
      let u = rand() * sum;
      let y = 0;
      while ((u -= p[y]) > 0 && y < 8) y++;
      labels[i] = y + 1;
      base.forEach((v, d) => (logits[i * 9 + d] = 3 * v));
    }
    const t = fitTemperature(logits, labels);
    expect(t).toBeGreaterThan(2.5);
    expect(t).toBeLessThan(3.5);
    expect(meanNll(logits, labels, t)).toBeLessThan(meanNll(logits, labels, 1));
  });
});
