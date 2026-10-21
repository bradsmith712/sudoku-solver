import type { Mat } from "@techstark/opencv-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  blankScene,
  defaultStyle,
  placeBoard,
  renderBoard,
  sampleGrid,
} from "./__fixtures__/render";
import { applyHomography, type Point } from "./geometry";
import { loadOpenCv, type CV } from "./opencv";
import { BOARD_SIZE, warpBoard } from "./warp";

let cv: CV;
beforeAll(async () => {
  cv = await loadOpenCv();
});

const p = (x: number, y: number): Point => ({ x, y });

/** Mean absolute grey-level difference between two same-size RGBA buffers. */
function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length / 4);
}

describe("warpBoard", () => {
  const corners = [p(170, 50), p(590, 110), p(540, 460), p(80, 380)];

  function roundTrip(edit?: (scene: Mat) => void) {
    const board = renderBoard(cv, sampleGrid(7), defaultStyle(BOARD_SIZE));
    const scene = blankScene(cv, 640, 480, [120, 140, 160, 255]);
    try {
      placeBoard(cv, scene, board, corners);
      edit?.(scene);
      return { result: warpBoard(cv, scene, corners), original: Uint8Array.from(board.data) };
    } finally {
      board.delete();
      scene.delete();
    }
  }

  it("returns a 450x450 RGBA image that matches the flat board", () => {
    const { result, original } = roundTrip();
    expect(result.warped.width).toBe(450);
    expect(result.warped.height).toBe(450);
    expect(result.warped.data.length).toBe(450 * 450 * 4);
    // Resampling twice blurs edges a little; a misaligned warp scores far higher.
    expect(meanAbsDiff(result.warped.data, original)).toBeLessThan(12);
  });

  it("is sensitive to misalignment (sanity check for the metric above)", () => {
    const board = renderBoard(cv, sampleGrid(7), defaultStyle(BOARD_SIZE));
    const scene = blankScene(cv, 640, 480, [120, 140, 160, 255]);
    try {
      placeBoard(cv, scene, board, corners);
      const shifted = corners.map((q) => p(q.x + 12, q.y + 8));
      const bad = warpBoard(cv, scene, shifted);
      expect(meanAbsDiff(bad.warped.data, board.data)).toBeGreaterThan(25);
    } finally {
      board.delete();
      scene.delete();
    }
  });

  it("returns a homography that maps the source corners onto the board corners", () => {
    const { result } = roundTrip();
    expect(result.homography).toHaveLength(9);
    const targets = [p(0, 0), p(450, 0), p(450, 450), p(0, 450)];
    corners.forEach((c, i) => {
      const q = applyHomography(result.homography, c);
      expect(q.x).toBeCloseTo(targets[i].x, 3);
      expect(q.y).toBeCloseTo(targets[i].y, 3);
    });
  });

  it("does not modify the source image", () => {
    const scene = blankScene(cv, 64, 48, [10, 20, 30, 255]);
    try {
      cv.circle(scene, new cv.Point(30, 20), 9, [200, 0, 0, 255], -1);
      const before = Uint8Array.from(scene.data);
      warpBoard(cv, scene, [p(5, 5), p(60, 3), p(58, 45), p(2, 40)]);
      expect(Uint8Array.from(scene.data)).toEqual(before);
    } finally {
      scene.delete();
    }
  });
});
