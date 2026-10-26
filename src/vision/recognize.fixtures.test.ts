/**
 * Regression gate for digit recognition on the committed synthetic sample (runs in CI):
 * boards warped from their labelled corners, read with recognizeBoard, held to the
 * SPEC.md synthetic targets. The full sets and real photos are in `npm run eval:vision`.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFixtures, readJpeg } from "./__fixtures__/fixtures";
import { warpBoardAt } from "./board";
import { recognizeBoard } from "./recognize";

const SAMPLE = fileURLToPath(new URL("../../tests/fixtures/synthetic/sample", import.meta.url));
const MIN_CELLS = 0.98;
const MIN_BOARDS = 0.9;

const fixtures = listFixtures(join(SAMPLE));
describe.skipIf(fixtures.length === 0)("digit recognition: synthetic sample", () => {
  it(`reads at least ${MIN_CELLS * 100}% of cells and ${MIN_BOARDS * 100}% of boards`, async () => {
    let cells = 0;
    let boards = 0;
    const wrong: string[] = [];
    for (const f of fixtures) {
      const corners = f.truth.corners!.map(([x, y]) => ({ x, y }));
      const { warped } = await warpBoardAt(readJpeg(f.imagePath), corners);
      const { grid } = await recognizeBoard(warped);
      let ok = 0;
      f.truth.grid.forEach((row, r) =>
        row.forEach((v, c) => {
          if (grid[r][c] === v) ok++;
          else wrong.push(`${f.name} r${r}c${c} ${v}->${grid[r][c]}`);
        }),
      );
      cells += ok;
      if (ok === 81) boards++;
    }
    console.log(
      `[recognize] sample: ${cells}/${fixtures.length * 81} cells, ${boards}/${fixtures.length} boards` +
        wrong.map((w) => `\n  ${w}`).join(""),
    );
    expect(cells / (fixtures.length * 81)).toBeGreaterThanOrEqual(MIN_CELLS);
    expect(boards / fixtures.length).toBeGreaterThanOrEqual(MIN_BOARDS);
  }, 300_000);
});
