/** 9x9 grid. 0 = blank, 1-9 = digit. */
export type Grid = number[][];

export type ScanResult = {
  grid: Grid;
  /** 9x9, 0-1 per cell. */
  confidence: number[][];
  /** Top-down 450x450 board image. */
  warped: ImageData;
  /** Optional, for projecting the solution back onto the photo. */
  homography?: number[];
  /** Optional, 9x9: the model's second-best digit per digit cell; 0 on blank cells. */
  second?: Grid;
  /** Optional, 9x9: calibrated probability of the best digit minus the second best; 1 on blank cells. */
  margin?: number[][];
};
