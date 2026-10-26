/**
 * Write the committed Playwright scan fixtures to tests/fixtures/e2e/ from the
 * committed synthetic sample. Regenerate with:
 *
 *   npx vite-node tools/make-e2e-fixtures.ts
 *
 * - synth-upright: a sample photo as is.
 * - synth-rot90 / synth-rot180: sample photos turned clockwise 90 / 180 degrees in
 *   their pixels (no EXIF), so the board warps out sideways / upside down.
 * - synth-exif6: a 960x720 sample photo enlarged 2x and stored turned 90 degrees
 *   anticlockwise (a 1440x1920 portrait) with EXIF orientation 6, as a phone saves
 *   it: it displays upright as 1920x1440, so the app must apply EXIF and resize to
 *   1024x768.
 * - synth-repair: synth-0103 from the full synthetic set (generate it first, see
 *   tests/fixtures/synthetic/sample/README.md), whose board scans with one confident
 *   misread (a 3 read as 4) that repair fixes; it exercises the "changed" UI.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { readJpeg, withOrientation, type Truth } from "../src/vision/__fixtures__/fixtures";
import { rotateImage, type QuarterTurns } from "../src/vision/rotate";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SAMPLE = join(ROOT, "tests/fixtures/synthetic/sample");
const FULL = join(ROOT, "tests/fixtures/synthetic");
const OUT = join(ROOT, "tests/fixtures/e2e");

/** Nearest-neighbour 2x enlargement. */
function double(image: ImageData): ImageData {
  const { width: w, height: h, data } = image;
  const out = new Uint8ClampedArray(w * h * 16);
  for (let y = 0; y < h * 2; y++)
    for (let x = 0; x < w * 2; x++) {
      const s = ((y >> 1) * w + (x >> 1)) * 4;
      out.set(data.subarray(s, s + 4), (y * w * 2 + x) * 4);
    }
  return { data: out, width: w * 2, height: h * 2, colorSpace: "srgb" } as ImageData;
}

const encode = (image: ImageData) =>
  Buffer.from(jpeg.encode({ data: image.data, width: image.width, height: image.height }, 92).data);

type Spec = {
  name: string;
  source: string;
  turns: QuarterTurns;
  exif6?: boolean;
  dir?: string;
  note: string;
};
const SPECS: Spec[] = [
  { name: "synth-upright", source: "synth-0001-clean", turns: 0, note: "upright" },
  { name: "synth-rot90", source: "synth-0011-rot-persp", turns: 1, note: "turned 90 deg CW" },
  { name: "synth-rot180", source: "synth-0016-rot-blur-light", turns: 2, note: "turned 180 deg" },
  {
    name: "synth-exif6",
    source: "synth-0004-light",
    turns: 3,
    exif6: true,
    note: "2x, stored 90 deg CCW with EXIF orientation 6 (displays upright)",
  },
  {
    name: "synth-repair",
    source: "synth-0103-rot-persp-blur-noise-light-clutter",
    dir: FULL,
    turns: 0,
    note: "one confident misread (3 read as 4) that repair fixes",
  },
];

mkdirSync(OUT, { recursive: true });
for (const spec of SPECS) {
  const dir = spec.dir ?? SAMPLE;
  const truth = JSON.parse(readFileSync(join(dir, `${spec.source}.json`), "utf8")) as Truth;
  let image = readJpeg(join(dir, truth.image));
  if (spec.exif6) image = double(image);
  const stored = rotateImage(image, spec.turns);
  const bytes = spec.exif6 ? withOrientation(encode(stored), 6) : encode(stored);
  writeFileSync(join(OUT, `${spec.name}.jpg`), bytes);
  // Displayed size: what a browser shows after applying EXIF.
  const shown = spec.exif6 ? image : stored;
  const record = {
    image: `${spec.name}.jpg`,
    width: shown.width,
    height: shown.height,
    grid: truth.grid,
    source: `${dir.slice(ROOT.length)}/${truth.image}`,
    note: spec.note,
  };
  writeFileSync(join(OUT, `${spec.name}.json`), JSON.stringify(record, null, 1) + "\n");
  console.log(`wrote ${spec.name}.jpg (${bytes.length} bytes): ${spec.note}`);
}
