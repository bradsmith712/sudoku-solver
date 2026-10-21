import type { Mat } from "@techstark/opencv-js";
import type { CV } from "./opencv";

/** Odd adaptive-threshold window that grows with the image so thick lines stay solid. */
export function thresholdBlockSize(width: number, height: number): number {
  const size = Math.max(11, Math.round(Math.min(width, height) / 40));
  return size % 2 === 1 ? size : size + 1;
}

/**
 * RGBA image -> binary mask with ink (grid lines, digits) as 255 on a 0 background.
 * Grayscale, Gaussian blur to suppress noise, then a local (adaptive) threshold so
 * shadows and uneven lighting do not swallow the grid. The caller owns the result
 * and must delete it; the input is not modified.
 */
export function preprocess(cv: CV, rgba: Mat): Mat {
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const binary = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.adaptiveThreshold(
      blurred,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      thresholdBlockSize(rgba.cols, rgba.rows),
      2,
    );
    return binary;
  } catch (err) {
    binary.delete();
    throw err;
  } finally {
    gray.delete();
    blurred.delete();
  }
}
