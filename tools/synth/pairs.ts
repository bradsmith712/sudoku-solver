/**
 * Pair up fixture images with their ground-truth JSON (same base name) in a directory.
 * Used by the list-pairs CLI, the fixture tests and, later, the vision evaluation.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import type { Truth } from "./truth";

export const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

export type Pair = { name: string; image: string; truthPath: string; truth: Truth };

/**
 * All image/JSON pairs in `dir` (not recursive), sorted by name. A missing directory yields [].
 * Throws if an image has no JSON or a JSON has no image, so broken fixtures fail loudly.
 */
export function listPairs(dir: string): Pair[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).sort();
  const base = (f: string) => f.slice(0, -extname(f).length);
  const images = new Map(
    files.filter((f) => IMAGE_EXTS.includes(extname(f).toLowerCase())).map((f) => [base(f), f]),
  );
  const truths = files.filter((f) => extname(f) === ".json").map(base);
  const orphans = [
    ...[...images.keys()]
      .filter((n) => !truths.includes(n))
      .map((n) => `${images.get(n)} (no .json)`),
    ...truths.filter((n) => !images.has(n)).map((n) => `${n}.json (no image)`),
  ];
  if (orphans.length) throw new Error(`unpaired fixtures in ${dir}: ${orphans.join(", ")}`);
  return truths.map((name) => {
    const truthPath = join(dir, `${name}.json`);
    const truth = JSON.parse(readFileSync(truthPath, "utf8")) as Truth;
    return { name, image: join(dir, images.get(name)!), truthPath, truth };
  });
}
