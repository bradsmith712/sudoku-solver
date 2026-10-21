/**
 * Node-only fixture I/O for vision tests: list image + ground-truth pairs, decode
 * and encode JPEGs. The JSON shape matches the synthetic generator's Truth record
 * (tests/fixtures/synthetic/<name>.json) and the real-photo set; only `image`,
 * `width`, `height` and `grid` are required.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import jpeg from "jpeg-js";
import type { Grid } from "../../types";

export type Truth = {
  image: string;
  width: number;
  height: number;
  grid: Grid;
  /** Board outer-border corners in image pixels: TL, TR, BR, BL. */
  corners?: [number, number][];
  tags?: string[];
};

export type Fixture = { name: string; imagePath: string; truth: Truth };

const IMAGE_EXTS = new Set([".jpg", ".jpeg"]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Every `<name>.json` under `dir` (recursively) whose JPEG image exists. Sorted, deduped by name. */
export function listFixtures(dir: string): Fixture[] {
  if (!existsSync(dir)) return [];
  const byName = new Map<string, Fixture>();
  for (const file of walk(dir).filter((f) => f.endsWith(".json"))) {
    let truth: Truth;
    try {
      truth = JSON.parse(readFileSync(file, "utf8")) as Truth;
    } catch {
      continue;
    }
    if (typeof truth.image !== "string" || !IMAGE_EXTS.has(extname(truth.image).toLowerCase())) {
      continue;
    }
    const imagePath = join(dirname(file), truth.image);
    if (!existsSync(imagePath)) continue;
    const name = truth.image.replace(/\.[^.]+$/, "");
    if (!byName.has(name)) byName.set(name, { name, imagePath, truth });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Decode a JPEG into an ImageData-shaped object (Node has no ImageData). */
export function readJpeg(path: string): ImageData {
  const { data, width, height } = jpeg.decode(readFileSync(path), {
    useTArray: true,
    formatAsRGBA: true,
    maxMemoryUsageInMB: 512,
  });
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    width,
    height,
    colorSpace: "srgb",
  } as ImageData;
}

export function writeJpeg(path: string, image: ImageData, quality = 90): void {
  mkdirSync(dirname(path), { recursive: true });
  const { data } = jpeg.encode(
    { data: image.data, width: image.width, height: image.height },
    quality,
  );
  writeFileSync(path, data);
}
