import { describe, expect, it } from "vitest";
import type { Grid } from "../types";
import { checkRetake, RETAKE_CONFLICT_CELLS, RETAKE_MEAN_CONFIDENCE } from "./retake";

const empty = (): Grid => Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
const sure = (v = 0.99) => Array.from({ length: 9 }, () => new Array<number>(9).fill(v));

describe("checkRetake", () => {
  it("accepts a clean scan", () => {
    const g = empty();
    g[0][0] = 5;
    g[4][4] = 7;
    expect(checkRetake(g, sure())).toMatchObject({ retake: false, conflictCells: 0 });
  });

  it("accepts a few conflicts (repairable misreads)", () => {
    const g = empty();
    g[0][0] = 4;
    g[0][5] = 4;
    g[3][3] = 2;
    g[3][8] = 2;
    expect(checkRetake(g, sure()).retake).toBe(false);
  });

  it(`asks for a retake at ${RETAKE_CONFLICT_CELLS} or more conflicting cells`, () => {
    const g = empty();
    // Four rows, each with one repeated pair: 8 conflicting cells.
    for (let r = 0; r < 4; r++) {
      g[r * 2][0] = r + 1;
      g[r * 2][8] = r + 1;
    }
    expect(checkRetake(g, sure())).toMatchObject({
      retake: true,
      reason: "conflicts",
      conflictCells: 8,
    });
    g[6][0] = 0; // one pair fewer
    expect(checkRetake(g, sure()).retake).toBe(false);
  });

  it(`asks for a retake when mean digit confidence is under ${RETAKE_MEAN_CONFIDENCE}`, () => {
    const g = empty();
    g[0][0] = 3;
    g[5][5] = 8;
    const conf = sure(1);
    conf[0][0] = 0.6;
    conf[5][5] = 0.7;
    expect(checkRetake(g, conf)).toMatchObject({ retake: true, reason: "confidence" });
  });

  it("ignores blank-cell confidence and treats an empty read as confident", () => {
    expect(checkRetake(empty(), sure(0.1))).toMatchObject({ retake: false, meanConfidence: 1 });
  });
});
