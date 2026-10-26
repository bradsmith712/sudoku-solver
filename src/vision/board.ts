import { findBoardQuad } from "./detect";
import { ScanError } from "./errors";
import type { Point } from "./geometry";
import { loadOpenCv } from "./opencv";
import { preprocess } from "./preprocess";
import { warpBoard, type WarpedBoard } from "./warp";

export type DetectedBoard = WarpedBoard & {
  /** Board outer corners in source-image pixels: TL, TR, BR, BL. */
  corners: Point[];
};

/** Smallest image side worth searching; anything smaller cannot hold a readable board. */
const MIN_IMAGE_SIDE = 64;
/**
 * Detection runs on a copy at most this long on its longer side. Full-resolution phone
 * photos (2000-6000 px) make paper grain several pixels wide, which the adaptive
 * threshold turns into speckle that swallows the board outline; area downscaling
 * averages it away. The warp still samples the full-resolution image.
 */
export const DETECT_MAX_SIDE = 1024;

/**
 * Find the sudoku board in a photo and return it perspective-corrected to
 * 450x450. Throws ScanError("no_board_found") if no board-like quadrilateral is
 * found. Loads OpenCV.js on first use.
 */
export async function detectBoard(image: ImageData): Promise<DetectedBoard> {
  if (Math.min(image.width, image.height) < MIN_IMAGE_SIDE) {
    throw new ScanError("no_board_found", "Image is too small to contain a board");
  }
  const cv = await loadOpenCv();
  const rgba = cv.matFromImageData(image);
  const scale = Math.min(1, DETECT_MAX_SIDE / Math.max(image.width, image.height));
  let small;
  let binary;
  try {
    if (scale < 1) {
      small = new cv.Mat();
      const size = new cv.Size(Math.round(image.width * scale), Math.round(image.height * scale));
      cv.resize(rgba, small, size, 0, 0, cv.INTER_AREA);
    }
    binary = preprocess(cv, small ?? rgba);
    const found = findBoardQuad(cv, binary);
    if (!found) throw new ScanError("no_board_found", "No sudoku board found in the image");
    const corners = found.map((p) => ({ x: p.x / scale, y: p.y / scale }));
    return { ...warpBoard(cv, rgba, corners), corners };
  } finally {
    rgba.delete();
    small?.delete();
    binary?.delete();
  }
}

/** Re-warp from explicit corners (TL, TR, BR, BL), e.g. after the user adjusts them. */
export async function warpBoardAt(
  image: ImageData,
  corners: readonly Point[],
): Promise<WarpedBoard> {
  const cv = await loadOpenCv();
  const rgba = cv.matFromImageData(image);
  try {
    return warpBoard(cv, rgba, corners);
  } finally {
    rgba.delete();
  }
}
