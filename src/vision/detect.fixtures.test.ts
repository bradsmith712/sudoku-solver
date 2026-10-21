/**
 * Detection accuracy over labelled image sets. Each set that exists is checked:
 *  - hand-made: src/vision/__fixtures__/boards (committed, always present)
 *  - synthetic: tests/fixtures/synthetic, or $VISION_SYNTHETIC_DIR (Phase 3 generator)
 *  - real:      tests/fixtures/real (owner photos)
 * A board counts as aligned when its detected corners are within 2% of the board side
 * of the labelled corners (if the label has corners) and the warped grid lines sit
 * within 6 px of where a 450x450 board puts them. Failures write overlay, binary and
 * warped images to test-results/vision-debug/<set>/; VISION_DEBUG=all writes them for
 * every image.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { cornerError, gridLineOffset } from "./__fixtures__/align";
import { listFixtures, readJpeg, writeJpeg, type Fixture } from "./__fixtures__/fixtures";
import { detectBoard, type DetectedBoard } from "./board";
import type { Point } from "./geometry";
import { toImageData } from "./image";
import { loadOpenCv, type CV } from "./opencv";
import { preprocess } from "./preprocess";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SETS = [
  { name: "hand-made", dir: join(ROOT, "src/vision/__fixtures__/boards") },
  {
    name: "synthetic",
    dir: process.env.VISION_SYNTHETIC_DIR ?? join(ROOT, "tests/fixtures/synthetic"),
  },
  { name: "real", dir: join(ROOT, "tests/fixtures/real") },
];
const DEBUG_DIR = join(ROOT, "test-results/vision-debug");
const MIN_ALIGNED_RATE = 0.95;
const MAX_CORNER_ERROR = 0.02;
const MAX_LINE_OFFSET = 6;

type Outcome = {
  name: string;
  ok: boolean;
  reason?: string;
  cornerError?: number;
  lineOffset?: number;
};

let cv: CV;
beforeAll(async () => {
  cv = await loadOpenCv();
});

function evaluate(f: Fixture, board: DetectedBoard): Outcome {
  const lineOffset = gridLineOffset(board.warped);
  const truth = f.truth.corners?.map(([x, y]) => ({ x, y }));
  const err = truth ? cornerError(board.corners, truth) : undefined;
  const reasons = [];
  if (err !== undefined && err > MAX_CORNER_ERROR)
    reasons.push(`corner error ${(err * 100).toFixed(1)}%`);
  if (lineOffset > MAX_LINE_OFFSET) reasons.push(`grid lines off by ${lineOffset}px`);
  return {
    name: f.name,
    ok: reasons.length === 0,
    reason: reasons.join(", ") || undefined,
    cornerError: err,
    lineOffset,
  };
}

function writeDebug(dir: string, f: Fixture, image: ImageData, board?: DetectedBoard): void {
  const src = cv.matFromImageData(image);
  let binary;
  try {
    binary = preprocess(cv, src);
    const quad = (pts: Point[], color: number[]) =>
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % 4];
        cv.line(src, new cv.Point(p.x, p.y), new cv.Point(q.x, q.y), color, 2);
      });
    const truth = f.truth.corners?.map(([x, y]) => ({ x, y }));
    if (truth) quad(truth, [0, 200, 0, 255]);
    if (board) quad(board.corners, [230, 0, 0, 255]);
    writeJpeg(join(dir, `${f.name}-overlay.jpg`), toImageData(src));
    const rgba = new cv.Mat();
    try {
      cv.cvtColor(binary, rgba, cv.COLOR_GRAY2RGBA);
      writeJpeg(join(dir, `${f.name}-binary.jpg`), toImageData(rgba));
    } finally {
      rgba.delete();
    }
    if (board) writeJpeg(join(dir, `${f.name}-warped.jpg`), board.warped);
  } finally {
    src.delete();
    binary?.delete();
  }
}

for (const set of SETS) {
  const fixtures = listFixtures(set.dir);
  describe.skipIf(fixtures.length === 0)(`board detection: ${set.name} set`, () => {
    it(`detects and aligns at least ${MIN_ALIGNED_RATE * 100}% of ${fixtures.length} boards`, async () => {
      const debugDir = join(DEBUG_DIR, set.name);
      rmSync(debugDir, { recursive: true, force: true });
      const outcomes: Outcome[] = [];
      for (const f of fixtures) {
        const image = readJpeg(f.imagePath);
        let board: DetectedBoard | undefined;
        let outcome: Outcome;
        try {
          board = await detectBoard(image);
          outcome = evaluate(f, board);
        } catch (err) {
          outcome = {
            name: f.name,
            ok: false,
            reason: err instanceof Error ? err.message : String(err),
          };
        }
        outcomes.push(outcome);
        if (!outcome.ok || process.env.VISION_DEBUG === "all")
          writeDebug(debugDir, f, image, board);
      }

      const failures = outcomes.filter((o) => !o.ok);
      const rate = (outcomes.length - failures.length) / outcomes.length;
      if (failures.length || process.env.VISION_DEBUG === "all") {
        mkdirSync(debugDir, { recursive: true });
        writeFileSync(
          join(debugDir, "report.json"),
          JSON.stringify({ rate, outcomes }, null, 2) + "\n",
        );
      }
      console.log(
        `[vision] ${set.name}: ${outcomes.length - failures.length}/${outcomes.length} aligned` +
          failures.map((o) => `\n  FAIL ${o.name}: ${o.reason}`).join(""),
      );
      expect(rate, `failures: ${failures.map((o) => o.name).join(", ")}`).toBeGreaterThanOrEqual(
        MIN_ALIGNED_RATE,
      );
    }, 300_000);
  });
}
