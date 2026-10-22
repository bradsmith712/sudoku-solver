import type { Mat } from "@techstark/opencv-js";
import { describe, expect, it } from "vitest";
import { loadOpenCv } from "./opencv";
import { preprocess, thresholdBlockSize } from "./preprocess";

describe("thresholdBlockSize", () => {
  it("is odd, at least 11, and grows with the image", () => {
    for (const [w, h] of [
      [100, 100],
      [450, 450],
      [1024, 768],
      [4000, 3000],
    ]) {
      const s = thresholdBlockSize(w, h);
      expect(s % 2).toBe(1);
      expect(s).toBeGreaterThanOrEqual(11);
    }
    expect(thresholdBlockSize(4000, 3000)).toBeGreaterThan(thresholdBlockSize(450, 450));
  });
});

describe("preprocess", () => {
  it("marks dark lines as ink and an unevenly lit background as empty", async () => {
    const cv = await loadOpenCv();
    const w = 200;
    const h = 120;
    const src = new cv.Mat(h, w, cv.CV_8UC4);
    let bin: Mat | undefined;
    try {
      // Horizontal lighting gradient from dark grey to white: a global threshold
      // would mark the left side as ink.
      for (let x = 0; x < w; x++) {
        const v = Math.round(90 + (165 * x) / (w - 1));
        cv.rectangle(src, new cv.Point(x, 0), new cv.Point(x, h - 1), [v, v, v, 255], -1);
      }
      cv.rectangle(src, new cv.Point(20, 20), new cv.Point(180, 100), [0, 0, 0, 255], 3);
      const before = Uint8Array.from(src.data);

      bin = preprocess(cv, src);
      expect(bin.rows).toBe(h);
      expect(bin.cols).toBe(w);
      expect(bin.channels()).toBe(1);
      expect(new Set(bin.data)).toEqual(new Set([0, 255]));
      // On the rectangle outline.
      expect(bin.ucharAt(20, 100)).toBe(255);
      expect(bin.ucharAt(60, 180)).toBe(255);
      // Background on both the dark and the bright side, inside and outside.
      expect(bin.ucharAt(60, 8)).toBe(0);
      expect(bin.ucharAt(60, 50)).toBe(0);
      expect(bin.ucharAt(60, 150)).toBe(0);
      expect(bin.ucharAt(110, 195)).toBe(0);
      expect(Uint8Array.from(src.data)).toEqual(before);
    } finally {
      src.delete();
      bin?.delete();
    }
  });
});
