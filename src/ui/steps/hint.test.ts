import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSteps } from "../../solver/steps";
import type { Grid } from "../../types";
import { hintCell, hintText, nextHint } from "./hint";

const fixture = (name: string): { grid: Grid; solution: Grid } =>
  JSON.parse(
    readFileSync(new URL(`../../../tests/fixtures/solver/${name}.json`, import.meta.url), "utf8"),
  );

describe("nextHint", () => {
  it("is the first step for the current board, and follows the user's progress", () => {
    const { grid, solution } = fixture("hard-01");
    const steps = generateSteps(grid);
    const first = nextHint(grid);
    expect(first).toEqual({ status: "solved", step: steps[0] });

    // The user fills in the first placement: the hint moves on.
    const p = steps[0].placements[0];
    const after = grid.map((row) => [...row]);
    after[p.row][p.col] = solution[p.row][p.col];
    const second = nextHint(after);
    expect(second.status === "solved" && second.step).toEqual(generateSteps(after)[0]);
  });

  it("names the cell for placements and points at the pattern for eliminations", () => {
    const steps = generateSteps(fixture("hard-01").grid);
    const place = steps.find((s) => s.placements.length) as (typeof steps)[0];
    expect(hintText(place)).toContain(
      `at row ${place.placements[0].row + 1}, column ${place.placements[0].col + 1}: `,
    );
    expect(hintCell(place)).toEqual(place.placements[0]);
    const elim = steps.find((s) => !s.placements.length) as (typeof steps)[0];
    expect(hintCell(elim)).toEqual(elim.highlight.cells[0]);
    expect(hintText(elim)).toBe(`Hint · ${elim.title}: ${elim.explanation}`);
  });

  it("reports why there is no hint", () => {
    const { grid, solution } = fixture("easy-01");
    expect(nextHint(solution)).toEqual({ status: "solved", step: null });
    const bad = grid.map((row) => [...row]);
    bad[0][0] = bad[0][1] = 5; // a repeated digit in row 1
    expect(nextHint(bad).status).toBe("invalid");
    expect(nextHint(Array.from({ length: 9 }, () => new Array<number>(9).fill(0))).status).toBe(
      "multiple",
    );
  });
});
