/**
 * Lazy OpenCV.js loader. The ~10 MB module is only fetched and compiled the first
 * time vision code needs it, so the manual-entry path never pays for it.
 */
export type CV = typeof import("@techstark/opencv-js");

let loading: Promise<CV> | undefined;

async function init(): Promise<CV> {
  // The Emscripten module object has its own `then`, so a promise resolved with it
  // adopts it and never settles. Keep it boxed until that `then` is removed below.
  const { cv } = (await import("./opencv-module")).boxed;
  await new Promise<void>((resolve) => {
    if (typeof cv.Mat === "function") {
      resolve();
    } else {
      // Typed as a function in the bindings, but it is a settable callback slot.
      (cv as unknown as { onRuntimeInitialized: () => void }).onRuntimeInitialized = resolve;
    }
  });
  delete (cv as { then?: unknown }).then;
  return cv;
}

/** Load OpenCV.js once; later calls return the same instance. */
export function loadOpenCv(): Promise<CV> {
  loading ??= init().catch((err: unknown) => {
    loading = undefined; // allow a retry after a failed load
    throw err;
  });
  return loading;
}
