import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { afterAll, describe, expect, it } from "vitest";
import { jpegOrientation, readJpeg, withOrientation } from "./fixtures";

// 48x32 source: 3x2 blocks of 16 px, with a distinct colour in each corner block.
const W = 48;
const H = 32;
const COLORS = { TL: [255, 0, 0], TR: [0, 255, 0], BL: [0, 0, 255], BR: [255, 255, 255] };
type Corner = keyof typeof COLORS;

function sourceJpeg(): Buffer {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const bx = Math.floor(x / 16);
      const by = Math.floor(y / 16);
      const corner =
        by === 0
          ? bx === 0
            ? "TL"
            : bx === 2
              ? "TR"
              : null
          : bx === 0
            ? "BL"
            : bx === 2
              ? "BR"
              : null;
      const rgb = corner ? COLORS[corner] : [128, 128, 128];
      data.set([...rgb, 255], (y * W + x) * 4);
    }
  return Buffer.from(jpeg.encode({ data, width: W, height: H }, 95).data);
}

/** Which source corner each displayed corner shows (TL, TR, BL), per the EXIF spec. */
const EXPECTED: Record<number, [Corner, Corner, Corner]> = {
  1: ["TL", "TR", "BL"],
  2: ["TR", "TL", "BR"],
  3: ["BR", "BL", "TR"],
  4: ["BL", "BR", "TL"],
  5: ["TL", "BL", "TR"],
  6: ["BL", "TL", "BR"],
  7: ["BR", "TR", "BL"],
  8: ["TR", "BR", "TL"],
};

const dir = mkdtempSync(join(tmpdir(), "exif-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function cornerAt(img: ImageData, x: number, y: number): Corner {
  const i = (y * img.width + x) * 4;
  const px = [img.data[i], img.data[i + 1], img.data[i + 2]];
  const dist = (c: number[]) => c.reduce((s, v, k) => s + (v - px[k]) ** 2, 0);
  return (Object.keys(COLORS) as Corner[]).reduce((a, b) =>
    dist(COLORS[a]) <= dist(COLORS[b]) ? a : b,
  );
}

describe("readJpeg EXIF orientation", () => {
  const src = sourceJpeg();

  it("reads no orientation from a JPEG without EXIF", () => {
    expect(jpegOrientation(src)).toBe(1);
  });

  it.each(Object.entries(EXPECTED).map(([o, c]) => [Number(o), c] as const))(
    "orientation %i is displayed upright",
    (o, [tl, tr, bl]) => {
      const path = join(dir, `o${o}.jpg`);
      writeFileSync(path, withOrientation(src, o));
      expect(jpegOrientation(withOrientation(src, o))).toBe(o);
      const img = readJpeg(path);
      expect([img.width, img.height]).toEqual(o >= 5 ? [H, W] : [W, H]);
      expect(cornerAt(img, 4, 4)).toBe(tl);
      expect(cornerAt(img, img.width - 5, 4)).toBe(tr);
      expect(cornerAt(img, 4, img.height - 5)).toBe(bl);
    },
  );
});
