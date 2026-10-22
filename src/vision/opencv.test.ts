import { describe, expect, it } from "vitest";
import { loadOpenCv } from "./opencv";

describe("loadOpenCv", () => {
  it("initializes OpenCV.js and can allocate a Mat", async () => {
    const cv = await loadOpenCv();
    const mat = new cv.Mat(4, 4, cv.CV_8UC1);
    try {
      expect(mat.rows).toBe(4);
      expect(mat.cols).toBe(4);
    } finally {
      mat.delete();
    }
  });

  it("returns the same instance on later calls", async () => {
    const [a, b] = await Promise.all([loadOpenCv(), loadOpenCv()]);
    expect(a).toBe(b);
    expect(await loadOpenCv()).toBe(a);
  });
});
