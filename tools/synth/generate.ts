/**
 * Synthetic sudoku photo generator (offline). See tools/synth/README.md.
 *
 *   npx vite-node tools/synth/generate.ts [--count 240] [--sample 20] [--seed 3]
 *                                         [--out tests/fixtures/synthetic]
 *
 * Writes <name>.jpg + <name>.json (see truth.ts) per image, then copies the first --sample
 * pairs into <out>/sample/ (the only part committed to git). Labels are deterministic for a
 * given seed; pixels also depend on the fonts installed on the machine.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { solve } from "../../src/solver/solver";
import { dig, randomSolution, rng } from "../lib/puzzles";
import {
  addNoise,
  applyLighting,
  gaussianBlur,
  homography,
  poseQuad,
  project,
  sampleAugment,
  warpOnto,
  type Pose,
} from "./augment";
import { Renderer } from "./browser";
import {
  FONT_CANDIDATES,
  boardCorners,
  boardSpec,
  pick,
  sampleCaption,
  sampleScene,
  uniform,
  type BoardSpec,
} from "./render";
import type { Point, Truth } from "./truth";

const ROOT = new URL("../../", import.meta.url).pathname;
const { values: args } = parseArgs({
  options: {
    count: { type: "string", default: "240" },
    sample: { type: "string", default: "20" },
    out: { type: "string", default: "tests/fixtures/synthetic" },
    seed: { type: "string", default: "3" },
  },
});
const count = Number(args.count);
const baseSeed = Number(args.seed);
const out = resolve(ROOT, args.out!);
const sampleDir = join(out, "sample");
const sampleCount = Math.min(Number(args.sample), count);

/** Output sizes (width, height): roughly what the app sees after resizing to ~1024px. */
const SIZES: [number, number][] = [
  [1024, 768],
  [768, 1024],
  [960, 720],
  [720, 960],
  [800, 800],
];
const round = (x: number) => Math.round(x * 100) / 100;
const square = (dim: number): Point[] => [
  [0, 0],
  [dim, 0],
  [dim, dim],
  [0, dim],
];

/**
 * Photograph the paper with the sampled pose: project its corners, scale so the board edge is
 * about `boardOut` px, and place it at a random spot where the whole board stays in frame
 * (the paper may be cut off). Returns paper and board quads in image pixels.
 */
function place(
  r: () => number,
  spec: BoardSpec,
  pose: Pose,
  boardOut: number,
  width: number,
  height: number,
) {
  const dim = spec.size + 2 * spec.margin;
  const norm = (pts: Point[]) => pts.map(([x, y]): Point => [x / dim - 0.5, y / dim - 0.5]);
  const paper = poseQuad(pose, norm(square(dim)));
  const board = poseQuad(pose, norm(boardCorners(spec)));
  const edge = (q: Point[]) =>
    q.reduce(
      (acc, [x, y], k) => acc + Math.hypot(x - q[(k + 1) % 4][0], y - q[(k + 1) % 4][1]),
      0,
    ) / 4;
  const pad = 0.03 * Math.min(width, height);
  for (let scale = boardOut / edge(board); ; scale *= 0.95) {
    const xs = board.map((p) => p[0] * scale);
    const ys = board.map((p) => p[1] * scale);
    const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
    const slackX = width - 2 * pad - (Math.max(...xs) - minX);
    const slackY = height - 2 * pad - (Math.max(...ys) - minY);
    if (slackX < 0 || slackY < 0) continue;
    const ox = pad - minX + uniform(r, 0, slackX);
    const oy = pad - minY + uniform(r, 0, slackY);
    const to = (q: Point[]) => q.map(([x, y]): Point => [x * scale + ox, y * scale + oy]);
    return { paperQuad: to(paper), boardQuad: to(board) };
  }
}

const renderer = await Renderer.launch();
try {
  const fonts = await renderer.availableFonts(FONT_CANDIDATES);
  if (fonts.length < 4)
    throw new Error(`only ${fonts.length} fonts available (${fonts.join(", ")}); install more`);
  console.log(`fonts: ${fonts.join(", ")}`);

  const ours = (f: string) => /^synth-\d+.*\.(jpg|json)$/.test(f);
  for (const dir of [out, sampleDir]) {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) if (ours(f)) rmSync(join(dir, f));
  }

  for (let i = 1; i <= count; i++) {
    // One PRNG per image, so image i is the same whatever --count is.
    const seed = baseSeed * 100003 + i;
    const r = rng(seed);
    const solution = randomSolution(r);
    const grid = dig(solution, Math.round(uniform(r, 24, 40)), r);
    if (solve(grid).status !== "solved") throw new Error(`image ${i}: puzzle not unique`);

    // Every 20th image (starting with the first) is clean, as a baseline.
    const aug = sampleAugment(r, i % 20 === 1);
    const [width, height] = pick(r, SIZES);
    const boardOut = Math.min(width, height) * aug.boardFrac;

    const font = fonts[(i - 1) % fonts.length];
    const spec = boardSpec(r, grid, font, Math.round(boardOut * uniform(r, 1, 1.25)));
    if (aug.clutter > 0 && r() < 0.6) spec.caption = sampleCaption(r, spec);
    const scene = sampleScene(r, width, height, aug.clutter);

    const { paperQuad, boardQuad } = place(r, spec, aug.pose, boardOut, width, height);
    const H = homography(square(spec.size + 2 * spec.margin), paperQuad);
    // Self-check: the homography must agree with the camera model on the board corners.
    const corners = boardCorners(spec).map((p) => project(H, p));
    corners.forEach(([x, y], k) => {
      if (Math.hypot(x - boardQuad[k][0], y - boardQuad[k][1]) > 0.01)
        throw new Error(`image ${i}: homography disagrees with camera model`);
    });

    const img = await renderer.scene(scene.spec);
    warpOnto(img, await renderer.board(spec), H);
    if (aug.lighting) applyLighting(img, aug.lighting);
    gaussianBlur(img, aug.blurSigma);
    addNoise(img, aug.noiseSigma, r);

    const name = `synth-${String(i).padStart(4, "0")}-${aug.tags.join("-")}`;
    const { tags, ...augment } = aug;
    const truth: Truth = {
      image: `${name}.jpg`,
      width,
      height,
      grid,
      solution,
      corners: corners.map(([x, y]): Point => [round(x), round(y)]),
      seed,
      tags,
      render: {
        ...spec.style,
        size: spec.size,
        margin: spec.margin,
        caption: spec.caption ?? null,
      },
      augment: { ...augment, surface: scene.surface },
    };
    writeFileSync(join(out, truth.image), await renderer.jpeg(img, aug.jpegQuality));
    writeFileSync(join(out, `${name}.json`), JSON.stringify(truth) + "\n");
    if (i <= sampleCount)
      for (const f of [truth.image, `${name}.json`]) copyFileSync(join(out, f), join(sampleDir, f));
  }
  console.log(`wrote ${count} images to ${out} (${sampleCount} copied to ${sampleDir})`);
} finally {
  await renderer.close();
}
