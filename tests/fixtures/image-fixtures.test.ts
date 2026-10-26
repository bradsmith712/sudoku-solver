import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { solve } from "../../src/solver/solver";
import {
  isNegative,
  listRealFixtures,
  splitConflicts,
} from "../../src/vision/__fixtures__/real";
import { listPairs, type Pair } from "../../tools/synth/pairs";

const HERE = new URL(".", import.meta.url).pathname;

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(buf: Buffer): [number, number] {
  expect(buf.readUInt16BE(0)).toBe(0xffd8);
  for (let o = 2; o < buf.length; ) {
    const marker = buf.readUInt16BE(o);
    const len = buf.readUInt16BE(o + 2);
    if (marker >= 0xffc0 && marker <= 0xffc3) return [buf.readUInt16BE(o + 7), buf.readUInt16BE(o + 5)];
    o += 2 + len;
  }
  throw new Error("no SOF marker");
}

const isGrid = (g: unknown) =>
  Array.isArray(g) &&
  g.length === 9 &&
  g.every((row) => Array.isArray(row) && row.length === 9 && row.every((v) => Number.isInteger(v) && v >= 0 && v <= 9));

function checkSynthetic(p: Pair) {
  const t = p.truth;
  expect(t.image).toBe(p.image.split("/").pop());
  expect(isGrid(t.grid)).toBe(true);
  expect(isGrid(t.solution)).toBe(true);
  const res = solve(t.grid);
  expect(res.status).toBe("solved");
  expect(res.solution).toEqual(t.solution);
  expect(jpegSize(readFileSync(p.image))).toEqual([t.width, t.height]);
  expect(t.corners).toHaveLength(4);
  for (const [x, y] of t.corners!) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(t.width);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(t.height);
  }
  expect(t.tags?.length).toBeGreaterThan(0);
  expect(p.name).toContain(t.tags!.join("-"));
}

describe("synthetic image fixtures", () => {
  const sample = listPairs(join(HERE, "synthetic/sample"));
  const full = listPairs(join(HERE, "synthetic"));

  it("has a committed sample", () => {
    expect(sample.length).toBeGreaterThanOrEqual(18);
  });

  it.each(sample.map((p) => [p.name, p] as const))("sample %s is a valid labeled image", (_, p) =>
    checkSynthetic(p),
  );

  // The full set is generated locally and git-ignored; skip when it has not been generated.
  it.skipIf(full.length === 0)("full set has at least 200 valid labeled images", () => {
    expect(full.length).toBeGreaterThanOrEqual(200);
    full.forEach(checkSynthetic);
  });
});

describe("real photo fixtures", () => {
  // Throws on unpaired files, bad metadata or a puzzleId in both splits (see real.ts).
  const real = listRealFixtures(join(HERE, "real"));
  const boards = real.filter((f) => !isNegative(f));

  it.skipIf(real.length === 0)("never puts one puzzleId in both train and test", () => {
    expect(splitConflicts(real)).toEqual([]);
  });

  it.each(boards.map((f) => [f.name, f] as const))(
    "%s grid has exactly one solution",
    (_, f) => {
      expect(solve(f.truth.grid!).status).toBe("solved");
    },
  );
});
