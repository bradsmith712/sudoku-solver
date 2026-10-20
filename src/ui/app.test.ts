import { describe, expect, it } from "vitest";
import type { Grid } from "../types";
import { findConflicts } from "./app";

const empty = (): Grid => Array.from({ length: 9 }, () => new Array<number>(9).fill(0));

describe("findConflicts", () => {
  it("returns nothing for an empty grid", () => {
    expect(findConflicts(empty()).size).toBe(0);
  });

  it("flags a repeated digit in a row", () => {
    const g = empty();
    g[0][0] = 5;
    g[0][8] = 5;
    expect([...findConflicts(g)].sort()).toEqual(["0,0", "0,8"]);
  });

  it("flags a repeated digit in a column", () => {
    const g = empty();
    g[1][4] = 7;
    g[8][4] = 7;
    expect([...findConflicts(g)].sort()).toEqual(["1,4", "8,4"]);
  });

  it("flags a repeated digit in a box", () => {
    const g = empty();
    g[3][3] = 2;
    g[5][5] = 2;
    expect([...findConflicts(g)].sort()).toEqual(["3,3", "5,5"]);
  });

  it("ignores equal digits in different units", () => {
    const g = empty();
    g[0][0] = 4;
    g[4][5] = 4;
    expect(findConflicts(g).size).toBe(0);
  });
});
