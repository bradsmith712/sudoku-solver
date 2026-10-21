/**
 * Ground-truth record written next to every synthetic image (`<name>.json`).
 * Real photos in tests/fixtures/real/ use the same shape; only `grid` is required there.
 */
import type { Grid } from "../../src/types";

export type Point = [number, number];

export type Truth = {
  /** Image file name in the same directory. */
  image: string;
  width: number;
  height: number;
  /** Printed givens. 0 = blank. */
  grid: Grid;
  /** Unique solution of `grid`. */
  solution?: Grid;
  /** Board outer-border corners in image pixels: TL, TR, BR, BL (relative to the puzzle). */
  corners?: Point[];
  seed?: number;
  /** Short labels for what was applied, e.g. ["rot", "blur"]; ["clean"] when nothing was. */
  tags?: string[];
  /** Generator parameters, for debugging failures. Free-form. */
  render?: Record<string, unknown>;
  augment?: Record<string, unknown>;
};
