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

/**
 * EXIF orientation (tag 0x0112 in IFD0, 1-8) of a JPEG, or 1 when absent. Phone
 * photos are stored sensor-side up with this tag saying how to display them.
 */
export function jpegOrientation(buf: Uint8Array): number {
  const u16 = (o: number, le = false) =>
    le ? buf[o] | (buf[o + 1] << 8) : (buf[o] << 8) | buf[o + 1];
  const u32 = (o: number, le: boolean) =>
    le
      ? (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0
      : ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
  for (let o = 2; o + 4 <= buf.length && buf[o] === 0xff;) {
    const marker = buf[o + 1];
    const len = u16(o + 2);
    if (marker === 0xda) break; // start of scan: no more metadata
    const exif = o + 4;
    if (marker === 0xe1 && String.fromCharCode(...buf.subarray(exif, exif + 4)) === "Exif") {
      const tiff = exif + 6;
      const le = buf[tiff] === 0x49; // "II" little-endian, "MM" big-endian
      const ifd = tiff + u32(tiff + 4, le);
      const end = o + 2 + len;
      for (let i = 0, n = u16(ifd, le); i < n && ifd + 2 + 12 * (i + 1) <= end; i++) {
        const entry = ifd + 2 + 12 * i;
        if (u16(entry, le) === 0x0112) {
          const v = u16(entry + 8, le);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    o += 2 + len;
  }
  return 1;
}

/** `image` turned upright per an EXIF orientation, as browsers display it. */
export function orientImage(image: ImageData, orientation: number): ImageData {
  if (orientation === 1) return image;
  const { width: w, height: h, data } = image;
  const swap = orientation >= 5;
  const W = swap ? h : w;
  const H = swap ? w : h;
  // Output (x, y) -> source pixel, per the EXIF definitions of 2-8.
  const source: Record<number, (x: number, y: number) => [number, number]> = {
    2: (x, y) => [w - 1 - x, y],
    3: (x, y) => [w - 1 - x, h - 1 - y],
    4: (x, y) => [x, h - 1 - y],
    5: (x, y) => [y, x],
    6: (x, y) => [y, h - 1 - x],
    7: (x, y) => [w - 1 - y, h - 1 - x],
    8: (x, y) => [w - 1 - y, x],
  };
  const at = source[orientation];
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [sx, sy] = at(x, y);
      const s = (sy * w + sx) * 4;
      const d = (y * W + x) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3];
    }
  }
  return { data: out, width: W, height: H, colorSpace: "srgb" } as ImageData;
}

/**
 * Decode a JPEG into an ImageData-shaped object (Node has no ImageData), turned
 * upright per its EXIF orientation so tests see photos the way a browser shows them.
 */
export function readJpeg(path: string): ImageData {
  const buf = readFileSync(path);
  const { data, width, height } = jpeg.decode(buf, {
    useTArray: true,
    formatAsRGBA: true,
    maxMemoryUsageInMB: 512,
  });
  const image = {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    width,
    height,
    colorSpace: "srgb",
  } as ImageData;
  return orientImage(image, jpegOrientation(buf));
}

export function writeJpeg(path: string, image: ImageData, quality = 90): void {
  mkdirSync(dirname(path), { recursive: true });
  const { data } = jpeg.encode(
    { data: image.data, width: image.width, height: image.height },
    quality,
  );
  writeFileSync(path, data);
}
