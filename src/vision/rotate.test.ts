import { describe, expect, it } from "vitest";
import { rotateGrid, rotateHomography, rotateImage, type QuarterTurns } from "./rotate";

/** A w x h image whose pixel (x, y) has R = x, G = y. */
function coords(w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x, y, 0, 255], (y * w + x) * 4);
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
}

const px = (img: ImageData, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1]];
};

/** Apply a row-major 3x3 homography to a point. */
const apply = (m: number[], x: number, y: number) => {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
};

describe("rotateImage", () => {
  it("turns clockwise, swapping width and height on odd turns", () => {
    const img = coords(4, 3);
    const r1 = rotateImage(img, 1);
    expect([r1.width, r1.height]).toEqual([3, 4]);
    expect(px(r1, 2, 0)).toEqual([0, 0]); // top-left goes to top-right
    expect(px(r1, 0, 0)).toEqual([0, 2]); // bottom-left goes to top-left
    const r2 = rotateImage(img, 2);
    expect(px(r2, 0, 0)).toEqual([3, 2]);
    const r3 = rotateImage(img, 3);
    expect(px(r3, 0, 0)).toEqual([3, 0]); // top-right goes to top-left
  });

  it("returns to the original after four quarter turns, also from an unaligned view", () => {
    const img = coords(5, 7);
    const buf = new Uint8ClampedArray(img.data.length + 1);
    buf.set(img.data, 1);
    const unaligned = { ...img, data: buf.subarray(1) } as ImageData;
    let r = unaligned;
    for (let i = 0; i < 4; i++) r = rotateImage(r, 1);
    expect(Array.from(r.data)).toEqual(Array.from(img.data));
  });
});

describe("rotateGrid", () => {
  it("agrees with rotateImage", () => {
    const grid = Array.from({ length: 9 }, (_, r) =>
      Array.from({ length: 9 }, (_, c) => r * 9 + c),
    );
    for (const t of [1, 2, 3] as QuarterTurns[]) {
      const img = rotateImage(coords(9, 9), t);
      const g = rotateGrid(grid, t);
      for (let y = 0; y < 9; y++)
        for (let x = 0; x < 9; x++) {
          const [sx, sy] = px(img, x, y);
          expect(g[y][x]).toBe(grid[sy][sx]);
        }
    }
  });
});

describe("rotateHomography", () => {
  it("maps source points to where the turned board puts them", () => {
    const size = 450;
    const h = [1.2, 0.1, -30, -0.05, 0.9, 12, 0.0001, 0.0002, 1];
    const [bx, by] = apply(h, 100, 200); // on the unturned board
    const expected: Record<number, [number, number]> = {
      0: [bx, by],
      1: [size - by, bx],
      2: [size - bx, size - by],
      3: [by, size - bx],
    };
    for (const t of [0, 1, 2, 3] as QuarterTurns[]) {
      const [x, y] = apply(rotateHomography(h, t, size), 100, 200);
      expect(x).toBeCloseTo(expected[t][0], 6);
      expect(y).toBeCloseTo(expected[t][1], 6);
    }
  });
});
