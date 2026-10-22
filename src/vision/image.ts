import type { Mat } from "@techstark/opencv-js";

/** Copy an RGBA Mat into a new ImageData. */
export function toImageData(mat: Mat): ImageData {
  if (mat.type() !== 24 /* CV_8UC4 */)
    throw new Error(`toImageData needs CV_8UC4, got type ${mat.type()}`);
  const data = new Uint8ClampedArray(mat.data);
  if (typeof ImageData !== "undefined") return new ImageData(data, mat.cols, mat.rows);
  // Node has no ImageData (Vitest runs vision tests there); same shape, plain object.
  return { data, width: mat.cols, height: mat.rows, colorSpace: "srgb" } as ImageData;
}
