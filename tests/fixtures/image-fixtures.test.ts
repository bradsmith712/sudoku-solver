import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { solve } from "../../src/solver/solver";
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
  const full = listPairs(join(HERE, "synthetic"));

  // The full set is generated locally and git-ignored; skip when it has not been generated.
  it.skipIf(full.length === 0)("full set has at least 200 valid labeled images", () => {
    expect(full.length).toBeGreaterThanOrEqual(200);
    full.forEach(checkSynthetic);
  });
});

describe("real photo fixtures", () => {
  const real = listPairs(join(HERE, "real"));
  it.skipIf(real.length === 0)("every photo has a valid ground-truth grid", () => {
    for (const p of real) expect(isGrid(p.truth.grid), p.name).toBe(true);
  });
});
