/**
 * Load OpenCV.js in a plain Node script (fixture generators). Uses require so the
 * module object is not passed through ESM interop, where its `then` would hang.
 */
import { createRequire } from "node:module";
import type { CV } from "../opencv";

export async function loadNodeOpenCv(): Promise<CV> {
  const cv = createRequire(import.meta.url)("@techstark/opencv-js") as CV;
  await new Promise<void>((resolve) => {
    if (typeof cv.Mat === "function") resolve();
    else (cv as unknown as { onRuntimeInitialized: () => void }).onRuntimeInitialized = resolve;
  });
  delete (cv as { then?: unknown }).then;
  return cv;
}
