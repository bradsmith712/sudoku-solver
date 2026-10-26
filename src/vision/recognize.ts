/**
 * Digit recognition for a warped board: cells.ts crops, blank.ts decides blank vs.
 * digit, and the ONNX digit model (src/vision/model/model.onnx, trained by
 * tools/train/train.py) classifies the digit cells.
 *
 * onnxruntime-web and the model are loaded on the first board that has a digit and
 * the session is reused for every later call, so callers can run recognizeBoard
 * several times per photo (e.g. once per orientation) cheaply. Both are self-hosted
 * Vite assets; nothing is fetched from a CDN.
 */
import type { InferenceSession } from "onnxruntime-web";
import type { ScanResult } from "../types";
import { blankConfidence, isDigit } from "./blank";
import { CELL_SIZE, extractCells } from "./cells";

type Ort = typeof import("onnxruntime-web");
type DigitModel = { ort: Ort; session: InferenceSession };

let loading: Promise<DigitModel> | undefined;
let loads = 0;

async function createSession(): Promise<DigitModel> {
  loads++;
  if (import.meta.env.SSR) {
    // Node (Vitest, eval:vision): the package's node build, model read from disk.
    const [ort, { readFile }] = await Promise.all([
      import("onnxruntime-web"),
      import("node:fs/promises"),
    ]);
    const model = await readFile(new URL("./model/model.onnx", import.meta.url));
    return { ort, session: await ort.InferenceSession.create(model) };
  }
  const [ort, wasm, mjs, model] = await Promise.all([
    import("onnxruntime-web/wasm"),
    import("onnxruntime-web/ort-wasm-simd-threaded.wasm?url").then((m) => m.default),
    import("onnxruntime-web/ort-wasm-simd-threaded.mjs?url").then((m) => m.default),
    import("./model/model.onnx?url").then((m) => m.default),
  ]);
  ort.env.wasm.wasmPaths = { wasm, mjs };
  // Multi-threading needs cross-origin isolation, which static hosting cannot set.
  ort.env.wasm.numThreads = 1;
  return { ort: ort as unknown as Ort, session: await ort.InferenceSession.create(model) };
}

/** Load onnxruntime and the digit model once; later calls return the same session. */
export function loadDigitModel(): Promise<DigitModel> {
  loading ??= createSession().catch((err: unknown) => {
    loading = undefined; // allow a retry after a failed load
    throw err;
  });
  return loading;
}

/** How many times the model has been loaded in this module instance (for tests). */
export function digitModelLoads(): number {
  return loads;
}

/**
 * Read a warped board (see warp.ts): the digit (0 = blank) and a 0-1 confidence per
 * cell. Digit confidence is the model's softmax probability for the chosen digit;
 * blank confidence comes from the ink rule's margin (blankConfidence), not the model.
 * Pure apart from the shared session: no orientation handling, no state between calls.
 */
export async function recognizeBoard(
  warped: ImageData,
): Promise<Pick<ScanResult, "grid" | "confidence">> {
  const cells = extractCells(warped);
  const grid = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  const confidence = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  const digits = cells.filter((c) => {
    const digit = isDigit(c);
    if (!digit) confidence[c.row][c.col] = blankConfidence(c);
    return digit;
  });
  if (digits.length === 0) return { grid, confidence };

  const { ort, session } = await loadDigitModel();
  const px = CELL_SIZE * CELL_SIZE;
  const input = new Float32Array(digits.length * px);
  digits.forEach((c, i) => c.pixels.forEach((v, j) => (input[i * px + j] = 1 - v)));
  const feeds = {
    input: new ort.Tensor("float32", input, [digits.length, 1, CELL_SIZE, CELL_SIZE]),
  };
  const logits = (await session.run(feeds)).logits.data as Float32Array;
  digits.forEach((c, i) => {
    const row = logits.subarray(i * 9, i * 9 + 9);
    const max = Math.max(...row);
    const exp = Array.from(row, (v) => Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    const best = exp.indexOf(Math.max(...exp));
    grid[c.row][c.col] = best + 1;
    confidence[c.row][c.col] = exp[best] / sum;
  });
  return { grid, confidence };
}
