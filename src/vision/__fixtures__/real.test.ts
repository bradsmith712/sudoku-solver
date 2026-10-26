import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatTally, listRealFixtures, tally, validateTruth, type RealTruth } from "./real";

const GRID = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
const positive = (puzzleId: string, split = "train", tags = ["clean"]) => ({
  puzzleId,
  split,
  tags,
  grid: GRID,
});
const negative = { puzzleId: "p-neg", split: "test", tags: ["cropped"], expect: "no_board_found" };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "real-fixtures-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function put(name: string, truth?: object, image = true): void {
  mkdirSync(dirname(join(dir, name)), { recursive: true });
  if (truth) writeFileSync(join(dir, `${name}.json`), JSON.stringify(truth));
  if (image) writeFileSync(join(dir, `${name}.jpg`), "");
}

describe("listRealFixtures", () => {
  it("returns [] for a missing directory", () => {
    expect(listRealFixtures(join(dir, "nope"))).toEqual([]);
  });

  it("loads positives and negatives from subfolders and skips pending/", () => {
    put("p-1", positive("p-1"));
    put("negative/p-neg", negative);
    put("pending/p-2", { puzzleId: "p-2" }); // invalid, but never read
    put("pending/orphan", undefined);
    const names = listRealFixtures(dir).map((f) => [f.name, f.truth.expect ?? "grid"]);
    expect(names).toEqual([
      ["negative/p-neg", "no_board_found"],
      ["p-1", "grid"],
    ]);
  });

  it("throws on unpaired files", () => {
    put("a", positive("a"), false);
    put("b", undefined);
    expect(() => listRealFixtures(dir)).toThrow("a.json: no image");
    expect(() => listRealFixtures(dir)).toThrow("b.jpg: no .json");
  });

  it("throws when one puzzleId is in both train and test", () => {
    put("p-1-a", positive("p-1", "train"));
    put("p-1-b", positive("p-1", "test"));
    expect(() => listRealFixtures(dir)).toThrow("p-1: photos are in both train and test");
  });

  it("throws on invalid metadata, naming the file", () => {
    put("bad", { split: "validation", tags: [] });
    expect(() => listRealFixtures(dir)).toThrow(/bad\.json: missing puzzleId; split must be/);
  });
});

describe("validateTruth", () => {
  it("accepts a positive and a negative", () => {
    expect(validateTruth(positive("x"))).toEqual([]);
    expect(validateTruth(negative)).toEqual([]);
  });

  it("rejects a negative with a grid and a positive without one", () => {
    expect(validateTruth({ ...negative, grid: GRID })).toContain(
      "negative case must not have a grid",
    );
    expect(validateTruth({ ...positive("x"), grid: undefined })).toContain(
      "grid must be 9x9 of 0-9",
    );
  });

  it("rejects an unknown expect value", () => {
    expect(validateTruth({ ...negative, expect: "blurry" })).toContain('unknown expect "blurry"');
  });
});

describe("tally", () => {
  const t = (split: "train" | "test", tags: string[]): RealTruth => ({
    puzzleId: "x",
    split,
    tags,
  });
  const scores = [
    { truth: t("test", ["clean", "flat"]), passed: 1, total: 1 },
    { truth: t("test", ["blur"]), passed: 0, total: 1 },
    { truth: t("train", ["clean"]), passed: 81, total: 81 },
  ];

  it("sums per split and per tag", () => {
    const { split, tag } = tally(scores);
    expect(Object.fromEntries(split)).toEqual({
      test: { passed: 1, total: 2, fixtures: 2 },
      train: { passed: 81, total: 81, fixtures: 1 },
    });
    expect([...tag.keys()]).toEqual(["blur", "clean", "flat"]);
    expect(tag.get("clean")).toEqual({ passed: 82, total: 82, fixtures: 2 });
  });

  it("formats a readable table", () => {
    const text = formatTally("detection", scores);
    expect(text).toContain("by split:");
    expect(text).toMatch(/test\s+1\/2\s+50%/);
    expect(text).toMatch(/blur\s+0\/1\s+0%/);
  });
});
