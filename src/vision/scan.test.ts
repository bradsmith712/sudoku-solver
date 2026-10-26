import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Grid } from "../types";
import { listFixtures, readJpeg } from "./__fixtures__/fixtures";
import { isNegative, listRealFixtures } from "./__fixtures__/real";
import { ScanError } from "./errors";
import { digitModelLoads } from "./recognize";
import { rotateImage, type QuarterTurns } from "./rotate";
import { hasDuplicates, scan, scanDetailed } from "./scan";
import { BOARD_SIZE } from "./warp";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SAMPLE = listFixtures(join(ROOT, "tests/fixtures/synthetic/sample"));
const REAL = listRealFixtures(join(ROOT, "tests/fixtures/real")).filter(
  (f) => !isNegative(f) && f.truth.split === "train",
);
const TURNS: QuarterTurns[] = [0, 1, 2, 3];

/** Cells of `got` equal to `want`. */
const agree = (got: Grid, want: Grid) =>
  got.flat().reduce((n, v, i) => n + (v === want[Math.floor(i / 9)][i % 9] ? 1 : 0), 0);

const apply = (m: number[], x: number, y: number) => {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
};

describe("hasDuplicates", () => {
  const empty = () => Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  it("finds repeats in rows, columns and boxes only", () => {
    expect(hasDuplicates(empty())).toBe(false);
    for (const [a, b] of [
      [
        [0, 0],
        [0, 8],
      ],
      [
        [0, 4],
        [8, 4],
      ],
      [
        [3, 3],
        [5, 5],
      ],
    ]) {
      const g = empty();
      g[a[0]][a[1]] = 6;
      g[b[0]][b[1]] = 6;
      expect(hasDuplicates(g)).toBe(true);
    }
    const g = empty();
    g[0][0] = 6;
    g[4][5] = 6;
    expect(hasDuplicates(g)).toBe(false);
  });
});

describe("scan", () => {
  // Three committed samples with different fonts and distortions, each photographed
  // the right way up, sideways both ways and upside down.
  const picks = SAMPLE.filter((f) =>
    ["synth-0001-clean", "synth-0011-rot-persp", "synth-0016-rot-blur-light"].includes(f.name),
  );

  it("has the sample fixtures", () => expect(picks).toHaveLength(3));

  for (const f of picks) {
    it(`reads ${f.name} upright at every photo rotation`, async () => {
      const photo = readJpeg(f.imagePath);
      for (const t of TURNS) {
        const { result, candidates } = await scanDetailed(rotateImage(photo, t));
        expect(agree(result.grid, f.truth.grid), `photo turned ${t * 90} deg`).toBe(81);
        expect(candidates).toHaveLength(4);
      }
    }, 60_000);
  }

  it("returns a homography from the photo to the upright board", async () => {
    const f = picks[1];
    const photo = rotateImage(readJpeg(f.imagePath), 1);
    const { homography, warped } = await scan(photo);
    expect([warped.width, warped.height]).toEqual([BOARD_SIZE, BOARD_SIZE]);
    // The labelled corners (TL, TR, BR, BL of the upright board) moved with the photo.
    const h = f.truth.height;
    const corners = f.truth.corners!.map(([x, y]) => [h - 1 - y, x]);
    const want = [
      [0, 0],
      [BOARD_SIZE, 0],
      [BOARD_SIZE, BOARD_SIZE],
      [0, BOARD_SIZE],
    ];
    corners.forEach(([x, y], i) => {
      const [bx, by] = apply(homography!, x, y);
      expect(Math.hypot(bx - want[i][0], by - want[i][1])).toBeLessThan(6);
    });
  }, 60_000);

  it("throws no_board_found on a blank image", async () => {
    const blank = {
      data: new Uint8ClampedArray(320 * 240 * 4).fill(230),
      width: 320,
      height: 240,
      colorSpace: "srgb",
    } as ImageData;
    await expect(scan(blank)).rejects.toBeInstanceOf(ScanError);
  });

  it("creates only one ONNX session across every scan and turn", () => {
    expect(digitModelLoads()).toBe(1);
  });
});

// The owner's photos are local only; split=train only (test photos are never used to tune).
describe.skipIf(REAL.length === 0)("scan on real photos (split=train)", () => {
  for (const f of REAL) {
    it(`finds the upright orientation of ${f.name} at every photo rotation`, async () => {
      const photo = readJpeg(f.imagePath);
      for (const t of TURNS) {
        const { result } = await scanDetailed(rotateImage(photo, t));
        expect(agree(result.grid, f.truth.grid!), `photo turned ${t * 90} deg`).toBe(81);
      }
    }, 120_000);
  }
});
