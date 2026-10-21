// Public surface of src/vision. Nothing here imports OpenCV.js statically; it is
// loaded on the first call that needs it.
export { detectBoard, warpBoardAt, type DetectedBoard } from "./board";
export { ScanError, type ScanErrorCode } from "./errors";
export type { Point } from "./geometry";
export { loadOpenCv } from "./opencv";
export { BOARD_SIZE, type WarpedBoard } from "./warp";
