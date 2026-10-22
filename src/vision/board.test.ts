import { beforeAll, describe, expect, it } from "vitest";
import {
  applyClutter,
  blankScene,
  defaultStyle,
  placeBoard,
  renderBoard,
  sampleGrid,
} from "./__fixtures__/render";
import { detectBoard, warpBoardAt } from "./board";
import { ScanError } from "./errors";
import { applyHomography, distance, type Point } from "./geometry";
import { toImageData } from "./image";
import { loadOpenCv, type CV } from "./opencv";

let cv: CV;
beforeAll(async () => {
  cv = await loadOpenCv();
});

const p = (x: number, y: number): Point => ({ x, y });

function scene(draw: (m: InstanceType<CV["Mat"]>) => void, w = 640, h = 480): ImageData {
  const m = blankScene(cv, w, h, [210, 205, 195, 255]);
  try {
    draw(m);
    return toImageData(m);
  } finally {
    m.delete();
  }
}

function withBoard(corners: Point[]): ImageData {
  return scene((m) => {
    const board = renderBoard(cv, sampleGrid(3), defaultStyle(400));
    try {
      placeBoard(cv, m, board, corners);
    } finally {
      board.delete();
    }
  });
}

async function expectNoBoard(image: ImageData) {
  const err = await detectBoard(image).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ScanError);
  expect((err as ScanError).code).toBe("no_board_found");
}

describe("detectBoard", () => {
  it("returns a 450x450 board, its corners and a homography", async () => {
    const truth = [p(150, 40), p(540, 70), p(560, 440), p(110, 420)];
    const r = await detectBoard(withBoard(truth));
    expect(r.warped.width).toBe(450);
    expect(r.warped.height).toBe(450);
    expect(r.homography).toHaveLength(9);
    r.corners.forEach((c, i) => expect(distance(c, truth[i])).toBeLessThanOrEqual(3));
  });

  it("throws ScanError('no_board_found') for an empty image", async () => {
    await expectNoBoard(scene(() => {}));
  });

  it("throws ScanError('no_board_found') for clutter without a board", async () => {
    await expectNoBoard(scene((m) => applyClutter(cv, m, 11, 40)));
  });

  it("throws ScanError('no_board_found') when the only grid is tiny", async () => {
    await expectNoBoard(withBoard([p(10, 10), p(90, 10), p(90, 90), p(10, 90)]));
  });

  it("throws ScanError('no_board_found') for an image too small to search", async () => {
    await expectNoBoard(scene(() => {}, 40, 30));
  });

  it("ScanError is a real Error with a readable name", () => {
    const e = new ScanError("no_board_found");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ScanError");
    expect(e.message).toBe("no_board_found");
  });
});

describe("warpBoardAt", () => {
  it("warps from the given corners, not detected ones", async () => {
    const image = withBoard([p(150, 40), p(540, 70), p(560, 440), p(110, 420)]);
    const inset = [p(200, 100), p(500, 120), p(510, 400), p(170, 380)];
    const r = await warpBoardAt(image, inset);
    expect(r.warped.width).toBe(450);
    const targets = [p(0, 0), p(450, 0), p(450, 450), p(0, 450)];
    inset.forEach((c, i) => {
      const q = applyHomography(r.homography, c);
      expect(distance(q, targets[i])).toBeLessThan(1e-6);
    });
  });
});
