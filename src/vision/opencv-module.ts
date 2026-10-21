// Loaded only through the dynamic import in opencv.ts. Importing @techstark/opencv-js
// dynamically from there would hang: its exports include the Emscripten module's own
// `then`, so the import() namespace is a thenable that never settles. This module's
// namespace exposes only a plain box.
import cv from "@techstark/opencv-js";

export const boxed = { cv };
