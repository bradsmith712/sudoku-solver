import type { Mat } from "@techstark/opencv-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  blankScene,
  defaultStyle,
  placeBoard,
  renderBoard,
  sampleGrid,
} from "./__fixtures__/render";
import { findBoardQuad } from "./detect";
import { distance, type Point } from "./geometry";
import { loadOpenCv, type CV } from "./opencv";
import { preprocess } from "./preprocess";

let cv: CV;
beforeAll(async () => {
  cv = await loadOpenCv();
});

const p = (x: number, y: number): Point => ({ x, y });

/** Draw boards into a 640x480 scene, run preprocess + findBoardQuad. */
function detect(boards: Point[][], draw?: (scene: Mat) => void) {
  const scene = blankScene(cv, 640, 480, [200, 190, 180, 255]);
  const board = renderBoard(cv, sampleGrid(1), defaultStyle(360));
  let bin: Mat | undefined;
  try {
    for (const corners of boards) placeBoard(cv, scene, board, corners);
    draw?.(scene);
    bin = preprocess(cv, scene);
    return findBoardQuad(cv, bin);
  } finally {
    scene.delete();
    board.delete();
    bin?.delete();
  }
}

function expectCorners(found: Point[] | null, truth: Point[], tol: number) {
  expect(found).not.toBeNull();
  found!.forEach((q, i) => expect(distance(q, truth[i])).toBeLessThanOrEqual(tol));
}

describe("findBoardQuad", () => {
  it("finds an axis-aligned board and orders its corners TL, TR, BR, BL", () => {
    const truth = [p(140, 60), p(500, 60), p(500, 420), p(140, 420)];
    expectCorners(detect([truth]), truth, 3);
  });

  it("finds a rotated, perspective-skewed board", () => {
    const truth = [p(190, 40), p(560, 90), p(520, 450), p(90, 380)];
    expectCorners(detect([truth]), truth, 3);
  });

  it("picks the larger of two boards", () => {
    const big = [p(250, 80), p(620, 80), p(620, 450), p(250, 450)];
    const small = [p(20, 20), p(180, 20), p(180, 180), p(20, 180)];
    expectCorners(detect([small, big]), big, 3);
  });

  it("ignores clutter, including a line that runs into the board", () => {
    const truth = [p(160, 70), p(470, 90), p(460, 400), p(150, 390)];
    const found = detect([truth], (scene) => {
      cv.circle(scene, new cv.Point(560, 380), 70, [30, 30, 30, 255], 4);
      cv.line(scene, new cv.Point(0, 470), new cv.Point(639, 300), [30, 30, 30, 255], 3);
    });
    expectCorners(found, truth, 3);
  });

  it("returns null when there is no board", () => {
    expect(
      detect([], (scene) => cv.circle(scene, new cv.Point(320, 240), 200, [0, 0, 0, 255], 6)),
    ).toBeNull();
    expect(detect([])).toBeNull();
  });

  it("returns null when the only quadrilateral is too small", () => {
    expect(detect([[p(10, 10), p(80, 10), p(80, 80), p(10, 80)]])).toBeNull();
  });
});
