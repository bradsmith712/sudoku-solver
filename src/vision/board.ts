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
  let binary;
  try {
    binary = preprocess(cv, rgba);
    const corners = findBoardQuad(cv, binary);
    if (!corners) throw new ScanError("no_board_found", "No sudoku board found in the image");
    return { ...warpBoard(cv, rgba, corners), corners };
  } finally {
    rgba.delete();
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
