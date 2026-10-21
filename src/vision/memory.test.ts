/**
 * Leak check: every OpenCV Mat/MatVector created during a scan must be deleted.
 *
 * Embind calls FinalizationGroup.register(handle, $$) for every new handle (from
 * `new cv.Mat()` or returned by OpenCV) and unregister($$) from delete(). That API
 * never shipped in browsers or Node, so embind normally skips it; installing a
 * counting stand-in before OpenCV loads gives an exact live-handle count.
 */
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { listFixtures, readJpeg } from "./__fixtures__/fixtures";
import { detectBoard, warpBoardAt } from "./board";
import { ScanError } from "./errors";
import { loadOpenCv, type CV } from "./opencv";

const live = new Set<unknown>();
class CountingFinalizationGroup {
  register(_handle: object, token: unknown) {
    live.add(token);
  }
  unregister(token: unknown) {
    live.delete(token);
  }
}
// Must be in place before OpenCV creates its first handle; board.ts and opencv.ts
// only load OpenCV lazily, so the static imports above do not.
(globalThis as { FinalizationGroup?: unknown }).FinalizationGroup = CountingFinalizationGroup;

const BOARDS = fileURLToPath(new URL("./__fixtures__/boards", import.meta.url));
const SCANS = 100;

/** Emscripten heap internals that the OpenCV.js typings leave out. */
type Heap = { _malloc(size: number): number; _free(ptr: number): void; HEAPU8: Uint8Array };

let cv: CV;
let heap: Heap;
beforeAll(async () => {
  cv = await loadOpenCv();
  heap = cv as unknown as Heap;
});

/** Address of a large malloc: it comes from the top of the heap, so it moves if memory leaks. */
function heapTop(): number {
  const ptr = heap._malloc(16 << 20);
  heap._free(ptr);
  return ptr;
}

describe("OpenCV memory", () => {
  it("counts live handles (sanity check for the leak test)", () => {
    const before = live.size;
    const m = new cv.Mat(4, 4, cv.CV_8UC1);
    const v = new cv.MatVector();
    expect(live.size).toBe(before + 2);
    m.delete();
    v.delete();
    expect(live.size).toBe(before);
  });

  it("deletes every Mat when warping from degenerate corners", async () => {
    const image: ImageData = {
      data: new Uint8ClampedArray(100 * 100 * 4).fill(200),
      width: 100,
      height: 100,
      colorSpace: "srgb",
    };
    const before = live.size;
    const same = { x: 10, y: 10 };
    // Whether OpenCV throws or returns garbage for collinear corners, nothing may leak.
    await warpBoardAt(image, [same, same, same, same]).catch(() => undefined);
    await warpBoardAt(image, [same, { x: 20, y: 20 }, { x: 30, y: 30 }, { x: 40, y: 40 }]).catch(
      () => undefined,
    );
    expect(live.size).toBe(before);
  });

  it(`deletes every Mat across ${SCANS} scans, including failures`, async () => {
    const images = listFixtures(BOARDS).map((f) => readJpeg(f.imagePath));
    expect(images.length).toBeGreaterThan(0);
    const blank: ImageData = {
      data: new Uint8ClampedArray(320 * 240 * 4).fill(230),
      width: 320,
      height: 240,
      colorSpace: "srgb",
    };
    images.push(blank); // exercises the no_board_found path

    const scan = async (image: ImageData) => {
      try {
        const board = await detectBoard(image);
        await warpBoardAt(image, board.corners);
      } catch (err) {
        if (!(err instanceof ScanError)) throw err;
      }
    };

    // Warm up so OpenCV's one-off internal heap allocations are not counted as growth.
    const before = live.size;
    for (const image of images) await scan(image);
    expect(live.size, "live handles after one pass over every image").toBe(before);
    const heapSize = heap.HEAPU8.length;
    const top = heapTop();

    for (let i = 0; i < SCANS; i++) {
      await scan(images[i % images.length]);
      expect(live.size, `live handles after scan ${i + 1}`).toBe(before);
    }
    expect(heap.HEAPU8.length).toBe(heapSize);
    expect(heapTop()).toBe(top);
  }, 120_000);
});
