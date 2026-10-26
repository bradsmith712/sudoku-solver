/**
 * Shrink a photo so its longer side is at most `maxSide`, as the app does before
 * scanning (src/ui/photo.ts uses a canvas there; here OpenCV's area filter, the
 * closest match for downscaling). Used by the eval so its numbers match the app.
 */
import { toImageData } from "../image";
import { loadOpenCv } from "../opencv";

export async function resizeToMax(image: ImageData, maxSide: number): Promise<ImageData> {
  const scale = maxSide / Math.max(image.width, image.height);
  if (scale >= 1) return image;
  const cv = await loadOpenCv();
  const src = cv.matFromImageData(image);
  const dst = new cv.Mat();
  try {
    const size = new cv.Size(Math.round(image.width * scale), Math.round(image.height * scale));
    cv.resize(src, dst, size, 0, 0, cv.INTER_AREA);
    return toImageData(dst);
  } finally {
    src.delete();
    dst.delete();
  }
}
