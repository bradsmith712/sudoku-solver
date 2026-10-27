import { describe, expect, it } from "vitest";
import { solve } from "../solver/solver";
import { generateSteps } from "../solver/steps";
import { DEMO_PUZZLE } from "./hero";

describe("hero demo puzzle", () => {
  it("has one solution and logic alone fills every blank", () => {
    expect(solve(DEMO_PUZZLE).status).toBe("solved");
    const steps = generateSteps(DEMO_PUZZLE);
    expect(steps.some((s) => s.technique === "fallback")).toBe(false);
    const blanks = DEMO_PUZZLE.flat().filter((d) => d === 0).length;
    expect(steps.flatMap((s) => s.placements)).toHaveLength(blanks);
  });
});
