/**
 * Fit the digit model's softmax temperature on the held-out-font validation set and
 * write src/vision/model/calibration.json. Offline only.
 *
 *   tools/train/.venv/bin/python tools/train/train.py --dump-val tools/train/data/val-crops.bin
 *   npx vite-node tools/train/calibrate.ts [tools/train/data/val-crops.bin]
 *
 * The validation crops come from fonts never used for training (train.py HELD_OUT),
 * rendered with the same seed train.py uses for epoch selection. No photo, synthetic
 * board or split=test data is used. The shipped model runs through the same
 * onnxruntime-web code path as the app (recognize.ts digitLogits).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  expectedCalibrationError,
  fitTemperature,
  meanNll,
  type Prediction,
} from "../../src/vision/__fixtures__/calibration";
import { CELL_SIZE } from "../../src/vision/cells";
import { digitLogits, softmax } from "../../src/vision/recognize";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const input = process.argv[2] ?? `${ROOT}tools/train/data/val-crops.bin`;
const output = `${ROOT}src/vision/model/calibration.json`;

/** train.py write_val_dump layout: uint32 N, N uint8 digits, pad to 4, N*32*32 float32. */
function readDump(path: string): { crops: Float32Array; labels: Uint8Array } {
  const buf = readFileSync(path);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
  const n = new DataView(bytes.buffer).getUint32(0, true);
  const labels = bytes.slice(4, 4 + n);
  const start = 4 + n + ((4 - ((4 + n) % 4)) % 4);
  const crops = new Float32Array(bytes.buffer, start, n * CELL_SIZE * CELL_SIZE);
  return { crops, labels };
}

function predictions(logits: Float32Array, labels: Uint8Array, t: number): Prediction[] {
  return Array.from(labels, (y, i) => {
    const p = softmax(logits.subarray(i * 9, i * 9 + 9), t);
    const best = p.indexOf(Math.max(...p));
    return { confidence: p[best], correct: best + 1 === y };
  });
}

const { crops, labels } = readDump(input);
const logits = await digitLogits(crops, labels.length);
const before = predictions(logits, labels, 1);
const temperature = fitTemperature(logits, labels);
const after = predictions(logits, labels, temperature);
const accuracy = before.filter((p) => p.correct).length / before.length;

const result = {
  temperature: Number(temperature.toFixed(4)),
  fittedOn: "held-out-font validation set (tools/train/train.py --dump-val)",
  n: labels.length,
  accuracy: Number(accuracy.toFixed(4)),
  eceBefore: Number(expectedCalibrationError(before).toFixed(4)),
  eceAfter: Number(expectedCalibrationError(after).toFixed(4)),
  nllBefore: Number(meanNll(logits, labels, 1).toFixed(4)),
  nllAfter: Number(meanNll(logits, labels, temperature).toFixed(4)),
};
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(result);
