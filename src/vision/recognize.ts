/**
 * Digit recognition for a warped board: cells.ts crops, blank.ts decides blank vs.
 * digit, and the ONNX digit model (src/vision/model/model.onnx, trained by
 * tools/train/train.py) classifies the digit cells.
 *
 * onnxruntime-web and the model are loaded on the first board that has a digit and
 * the session is reused for every later call, so callers can run recognizeBoard
 * several times per photo (e.g. once per orientation) cheaply. Both are self-hosted
 * Vite assets; nothing is fetched from a CDN.
 *
 * Digit confidence is temperature-scaled: softmax(logits / T), with T from
 * model/calibration.json, fitted by tools/train/calibrate.ts on the held-out-font
 * validation set (never on photos). Scaling does not change which digit wins.
 */
import type { InferenceSession } from "onnxruntime-web";
import type { ScanResult } from "../types";
import { blankConfidence, isDigit } from "./blank";
import { CELL_SIZE, extractCells } from "./cells";
import calibration from "./model/calibration.json";

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

/** Softmax temperature fitted on the held-out-font validation set (calibration.json). */
export const TEMPERATURE: number = calibration.temperature;

/**
 * Raw model logits for `n` crops laid out back to back in `crops` (CELL_SIZE^2 each,
 * 1 = paper, as cells.ts produces them): 9 per crop, for digits 1-9.
 */
export async function digitLogits(crops: Float32Array, n: number): Promise<Float32Array> {
  const { ort, session } = await loadDigitModel();
  const input = new Float32Array(crops.length);
  for (let i = 0; i < crops.length; i++) input[i] = 1 - crops[i]; // model sees ink = 1
  const feeds = { input: new ort.Tensor("float32", input, [n, 1, CELL_SIZE, CELL_SIZE]) };
  return (await session.run(feeds)).logits.data as Float32Array;
}

/** Softmax of `logits / temperature`. */
export function softmax(logits: ArrayLike<number>, temperature = TEMPERATURE): number[] {
  const scaled = Array.from(logits, (v) => v / temperature);
  const max = Math.max(...scaled);
  const exp = scaled.map((v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / sum);
}

export type BoardRead = Required<Pick<ScanResult, "grid" | "confidence" | "second" | "margin">>;

/**
 * Read a warped board (see warp.ts): the digit (0 = blank) and a 0-1 confidence per
 * cell, plus each digit cell's runner-up digit and top-two margin. Digit confidence
 * is the model's temperature-scaled softmax probability for the chosen digit (pass
 * `temperature` 1 for the raw softmax); blank confidence comes from the ink rule's
 * margin (blankConfidence), not the model.
 * Pure apart from the shared session: no orientation handling, no state between calls.
 */
export async function recognizeBoard(
  warped: ImageData,
  temperature = TEMPERATURE,
): Promise<BoardRead> {
  const cells = extractCells(warped);
  const nine = (v: number) => Array.from({ length: 9 }, () => new Array<number>(9).fill(v));
  const grid = nine(0);
  const confidence = nine(0);
  const second = nine(0);
  const margin = nine(1);
  const digits = cells.filter((c) => {
    const digit = isDigit(c);
    if (!digit) confidence[c.row][c.col] = blankConfidence(c);
    return digit;
  });
  if (digits.length === 0) return { grid, confidence, second, margin };

  const px = CELL_SIZE * CELL_SIZE;
  const crops = new Float32Array(digits.length * px);
  digits.forEach((c, i) => crops.set(c.pixels, i * px));
  const logits = await digitLogits(crops, digits.length);
  digits.forEach((c, i) => {
    const p = softmax(logits.subarray(i * 9, i * 9 + 9), temperature);
    const order = p.map((_, d) => d).sort((a, b) => p[b] - p[a]);
    grid[c.row][c.col] = order[0] + 1;
    second[c.row][c.col] = order[1] + 1;
    confidence[c.row][c.col] = p[order[0]];
    margin[c.row][c.col] = p[order[0]] - p[order[1]];
  });
  return { grid, confidence, second, margin };
}
