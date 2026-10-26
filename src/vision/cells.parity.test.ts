/**
 * tools/train/train.py re-implements the cell preprocessing in numpy so training crops
 * match what the app feeds the model. This checks the two agree on one cell that the
 * script rendered (tests/fixtures/train-parity.json, regenerate with
 * `train.py --parity-fixture tests/fixtures/train-parity.json`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cellsFrom, flattenLighting, toGray, type GridLines } from "./cells";

const fixture = JSON.parse(
  readFileSync(new URL("../../tests/fixtures/train-parity.json", import.meta.url), "utf8"),
) as {
  size: number;
  gray: number[];
  left: number;
  right: number;
  top: number;
  bottom: number;
  crop: number[];
};

describe("training preprocessing parity", () => {
  it("train.py crops a cell exactly like cells.ts", () => {
    const { size, gray } = fixture;
    const data = new Uint8ClampedArray(size * size * 4);
    gray.forEach((v, i) => data.set([v, v, v, 255], i * 4));
    const img = { data, width: size, height: size, colorSpace: "srgb" } as ImageData;
    // Only cell (0, 0) is used: its lines are cols[0], cols[1], rows[0], rows[1].
    const fill = (a: number, b: number) =>
      Array.from({ length: 10 }, (_, k) => new Array<number>(9).fill(k === 0 ? a : b));
    const lines: GridLines = {
      cols: fill(fixture.left, fixture.right),
      rows: fill(fixture.top, fixture.bottom),
    };
    const [cell] = cellsFrom(flattenLighting(toGray(img), size, size), lines);
    let worst = 0;
    cell.pixels.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - fixture.crop[i]))));
    expect(worst).toBeLessThan(0.02);
  });
});
