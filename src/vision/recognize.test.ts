import { beforeAll, describe, expect, it } from "vitest";
import { defaultStyle, renderBoard, sampleGrid } from "./__fixtures__/render";
import { BLANK_FLOOR, BLANK_SURE, MIN_BLOB, blankConfidence } from "./blank";
import { CELL_SIZE, type Cell } from "./cells";
import { toImageData } from "./image";
import { loadOpenCv, type CV } from "./opencv";
import { TEMPERATURE, digitModelLoads, recognizeBoard, softmax } from "./recognize";
import { BOARD_SIZE } from "./warp";

let cv: CV;
beforeAll(async () => {
  cv = await loadOpenCv();
});

function board(seed: number): { grid: number[][]; img: ImageData } {
  const grid = sampleGrid(seed);
  const mat = renderBoard(cv, grid, defaultStyle(BOARD_SIZE));
  try {
    return { grid, img: toImageData(mat) };
  } finally {
    mat.delete();
  }
}

/** A blank-looking crop whose only ink is one solid square blob of `size` pixels. */
function cellWithBlob(size: number): Cell {
  const pixels = new Float32Array(CELL_SIZE * CELL_SIZE).fill(1);
  const side = Math.ceil(Math.sqrt(size));
  for (let i = 0; i < size; i++)
    pixels[(12 + Math.floor(i / side)) * CELL_SIZE + 12 + (i % side)] = 0.2;
  return { row: 0, col: 0, rect: { x: 0, y: 0, width: 1, height: 1 }, pixels };
}

describe("recognizeBoard", () => {
  it("marks the right cells blank and returns confidences in [0, 1]", async () => {
    // Digit identity is checked on realistic fonts by recognize.fixtures.test.ts. This
    // board uses OpenCV's Hershey font, whose flat-topped 3 is unlike any print font
    // the model is trained on (it reads as 5), so only the mechanics are checked here.
    const { grid, img } = board(5);
    const res = await recognizeBoard(img);
    expect(res.grid.map((row) => row.map((v) => v !== 0))).toEqual(
      grid.map((row) => row.map((v) => v !== 0)),
    );
    for (const row of res.grid)
      for (const v of row) expect(Number.isInteger(v) && v >= 0 && v <= 9).toBe(true);
    for (const row of res.confidence)
      for (const c of row) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    // Blank cells of a clean board are certain.
    grid.forEach((row, r) => row.forEach((v, c) => !v && expect(res.confidence[r][c]).toBe(1)));
  });

  it("loads the model once across calls and returns the same result for the same board", async () => {
    const { img } = board(6);
    const first = await recognizeBoard(img);
    const second = await recognizeBoard(img);
    await recognizeBoard(board(7).img);
    expect(second).toEqual(first);
    expect(digitModelLoads()).toBe(1);
  });
});

describe("calibration", () => {
  it("uses a fitted temperature that softens the softmax without changing the winner", () => {
    expect(TEMPERATURE).toBeGreaterThan(0);
    const logits = [4, 1, 0.5, 0, 0, 0, 0, 0, -1];
    const raw = softmax(logits, 1);
    const cal = softmax(logits, 2);
    expect(raw.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(cal.indexOf(Math.max(...cal))).toBe(raw.indexOf(Math.max(...raw)));
    expect(cal[0]).toBeLessThan(raw[0]);
  });

  it("returns the runner-up digit and top-two margin on digit cells only", async () => {
    const { img } = board(8);
    const res = await recognizeBoard(img);
    const raw = await recognizeBoard(img, 1);
    expect(raw.grid).toEqual(res.grid);
    res.grid.forEach((row, r) =>
      row.forEach((v, c) => {
        const m = res.margin[r][c];
        if (!v) {
          expect(res.second[r][c]).toBe(0);
          expect(m).toBe(1);
          return;
        }
        expect(res.second[r][c]).not.toBe(v);
        expect(res.second[r][c]).toBeGreaterThanOrEqual(1);
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(res.confidence[r][c]);
      }),
    );
  });
});

describe("blankConfidence", () => {
  it("is 1 up to BLANK_SURE and falls linearly to BLANK_FLOOR at MIN_BLOB", () => {
    expect(blankConfidence(cellWithBlob(0))).toBe(1);
    expect(blankConfidence(cellWithBlob(Math.floor(BLANK_SURE)))).toBe(1);
    let prev = 1;
    for (let size = Math.floor(BLANK_SURE) + 1; size < MIN_BLOB; size++) {
      const c = blankConfidence(cellWithBlob(size));
      expect(c).toBeLessThan(prev);
      prev = c;
    }
    expect(prev).toBeGreaterThan(BLANK_FLOOR);
    expect(blankConfidence(cellWithBlob(MIN_BLOB))).toBeCloseTo(BLANK_FLOOR);
  });
});
