/**
 * Regenerate the hand-made OpenCV-drawn board fixtures in ./boards:
 *   npx vite-node src/vision/__fixtures__/make-fixtures.ts
 * Deterministic. Puzzles come from tests/fixtures/solver. Browser-rendered
 * fixtures come from make-browser-fixtures.ts.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { distance, type Point } from "../geometry";
import { toImageData } from "../image";
import type { Grid } from "../../types";
import { writeJpeg, type Truth } from "./fixtures";
import { loadNodeOpenCv } from "./node-opencv";
import {
  applyBlur,
  applyClutter,
  applyLighting,
  applyNoise,
  blankScene,
  defaultStyle,
  placeBoard,
  renderBoard,
  type BoardStyle,
  type Rgba,
} from "./render";

const here = new URL(".", import.meta.url).pathname;
const OUT = join(here, "boards");
const PUZZLES = join(here, "../../../tests/fixtures/solver");

type Case = {
  name: string;
  puzzle: string;
  width: number;
  height: number;
  background: Rgba;
  /** Square of side `side` centred at (cx, cy), rotated, then optionally keystoned. */
  side: number;
  cx: number;
  cy: number;
  rotateDeg?: number;
  /** Explicit corners override the square. */
  corners?: Point[];
  style?: Partial<BoardStyle>;
  lighting?: [number, number];
  noise?: number;
  blur?: number;
  clutter?: number;
  tags: string[];
};

const CASES: Case[] = [
  {
    name: "opencv-frontal-01",
    puzzle: "easy-01",
    width: 640,
    height: 480,
    background: [214, 208, 196, 255],
    side: 400,
    cx: 320,
    cy: 240,
    tags: ["clean"],
  },
  {
    name: "opencv-rotated-15deg",
    puzzle: "medium-01",
    width: 640,
    height: 480,
    background: [180, 170, 160, 255],
    side: 330,
    cx: 320,
    cy: 240,
    rotateDeg: 15,
    tags: ["rot"],
  },
  {
    name: "opencv-rotated-minus-30deg",
    puzzle: "hard-01",
    width: 640,
    height: 480,
    background: [90, 110, 130, 255],
    side: 300,
    cx: 330,
    cy: 235,
    rotateDeg: -30,
    tags: ["rot"],
  },
  {
    name: "opencv-perspective-01",
    puzzle: "easy-02",
    width: 640,
    height: 480,
    background: [200, 200, 200, 255],
    side: 0,
    cx: 0,
    cy: 0,
    corners: [
      { x: 200, y: 50 },
      { x: 470, y: 60 },
      { x: 600, y: 440 },
      { x: 60, y: 420 },
    ],
    tags: ["persp"],
  },
  {
    name: "opencv-lighting-noise-blur",
    puzzle: "medium-02",
    width: 640,
    height: 480,
    background: [160, 150, 140, 255],
    side: 0,
    cx: 0,
    cy: 0,
    corners: [
      { x: 150, y: 70 },
      { x: 520, y: 40 },
      { x: 560, y: 430 },
      { x: 120, y: 450 },
    ],
    lighting: [0.5, 1.1],
    noise: 8,
    blur: 5,
    tags: ["persp", "light", "noise", "blur"],
  },
  {
    name: "opencv-clutter-01",
    puzzle: "hard-02",
    width: 800,
    height: 600,
    background: [225, 222, 215, 255],
    side: 360,
    cx: 420,
    cy: 300,
    rotateDeg: 6,
    clutter: 60,
    tags: ["clutter", "rot"],
  },
  {
    name: "opencv-small-board",
    puzzle: "easy-03",
    width: 800,
    height: 600,
    background: [205, 200, 190, 255],
    side: 270,
    cx: 300,
    cy: 330,
    rotateDeg: -8,
    tags: ["small", "rot"],
  },
  {
    name: "opencv-large-1024",
    puzzle: "medium-03",
    width: 1024,
    height: 768,
    background: [190, 185, 170, 255],
    side: 0,
    cx: 0,
    cy: 0,
    corners: [
      { x: 260, y: 90 },
      { x: 830, y: 120 },
      { x: 800, y: 700 },
      { x: 210, y: 660 },
    ],
    noise: 5,
    tags: ["persp", "large", "noise"],
  },
  {
    name: "opencv-thin-lines",
    puzzle: "hard-03",
    width: 640,
    height: 480,
    background: [235, 232, 225, 255],
    side: 380,
    cx: 320,
    cy: 240,
    rotateDeg: 4,
    style: { thick: 3, thin: 1 },
    blur: 3,
    tags: ["thin", "rot", "blur"],
  },
];

function squareCorners(c: Case): Point[] {
  const r = ((c.rotateDeg ?? 0) * Math.PI) / 180;
  const h = c.side / 2;
  return [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ].map(([x, y]) => ({
    x: c.cx + x * Math.cos(r) - y * Math.sin(r),
    y: c.cy + x * Math.sin(r) + y * Math.cos(r),
  }));
}

const cv = await loadNodeOpenCv();
mkdirSync(OUT, { recursive: true });
for (const [i, c] of CASES.entries()) {
  const grid = (
    JSON.parse(readFileSync(join(PUZZLES, `${c.puzzle}.json`), "utf8")) as { grid: Grid }
  ).grid;
  const corners = c.corners ?? squareCorners(c);
  const renderSize = 630; // render large, then let the warp downsample
  // Case styles give line widths in output pixels; scale them to the render size.
  const side = corners.reduce((sum, p, k) => sum + distance(p, corners[(k + 1) % 4]), 0) / 4;
  const k = renderSize / side;
  const style = { ...defaultStyle(renderSize) };
  if (c.style?.thick) style.thick = Math.round(c.style.thick * k);
  if (c.style?.thin) style.thin = Math.round(c.style.thin * k);
  const board = renderBoard(cv, grid, style);
  const scene = blankScene(cv, c.width, c.height, c.background);
  try {
    if (c.clutter) applyClutter(cv, scene, 100 + i, c.clutter);
    placeBoard(cv, scene, board, corners);
    if (c.lighting) applyLighting(scene, ...c.lighting);
    if (c.noise) applyNoise(scene, c.noise, 200 + i);
    if (c.blur) applyBlur(cv, scene, c.blur);
    const image = `${c.name}.jpg`;
    writeJpeg(join(OUT, image), toImageData(scene), 88);
    const truth: Truth = {
      image,
      width: c.width,
      height: c.height,
      grid,
      corners: corners.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]),
      tags: ["opencv", ...c.tags],
    };
    writeFileSync(join(OUT, `${c.name}.json`), JSON.stringify(truth) + "\n");
    console.log("wrote", image);
  } finally {
    board.delete();
    scene.delete();
  }
}
