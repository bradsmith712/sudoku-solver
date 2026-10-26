// Public surface of src/vision. Nothing here imports OpenCV.js or onnxruntime
// statically; each is loaded on the first call that needs it.
export { blankConfidence, isDigit } from "./blank";
export { detectBoard, warpBoardAt, type DetectedBoard } from "./board";
export { CELL_SIZE, extractCells, type Cell } from "./cells";
export { ScanError, type ScanErrorCode } from "./errors";
export type { Point } from "./geometry";
export { loadOpenCv } from "./opencv";
export { digitModelLoads, loadDigitModel, recognizeBoard } from "./recognize";
export { BOARD_SIZE, type WarpedBoard } from "./warp";
