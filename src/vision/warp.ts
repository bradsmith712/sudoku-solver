import type { Point } from "./geometry";
import { toImageData } from "./image";
import type { CV } from "./opencv";
import type { Mat } from "@techstark/opencv-js";

/** Side of the top-down board image, in pixels (50 px per cell). */
export const BOARD_SIZE = 450;

export type WarpedBoard = {
  /** Top-down BOARD_SIZE x BOARD_SIZE RGBA board. */
  warped: ImageData;
  /** Row-major 3x3 matrix mapping source-image pixels to warped-board pixels. */
  homography: number[];
};

/**
 * Perspective-correct the board with outer corners `corners` (TL, TR, BR, BL in
 * `rgba` pixel coordinates) into a square top-down image whose edges are the
 * board's outer border.
 */
export function warpBoard(
  cv: CV,
  rgba: Mat,
  corners: readonly Point[],
  size = BOARD_SIZE,
): WarpedBoard {
  if (corners.length !== 4) throw new Error(`warpBoard needs 4 corners, got ${corners.length}`);
  // Allocate inside try so a throw part-way (e.g. degenerate user corners) leaks nothing.
  const mats: Mat[] = [];
  try {
    const src = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      corners.flatMap((p) => [p.x, p.y]),
    );
    mats.push(src);
    const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, size, 0, size, size, 0, size]);
    mats.push(dst);
    const m = cv.getPerspectiveTransform(src, dst);
    mats.push(m);
    const out = new cv.Mat();
    mats.push(out);
    cv.warpPerspective(
      rgba,
      out,
      m,
      new cv.Size(size, size),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
      new cv.Scalar(),
    );
    return { warped: toImageData(out), homography: Array.from(m.data64F) };
  } finally {
    for (const mat of mats) mat.delete();
  }
}
