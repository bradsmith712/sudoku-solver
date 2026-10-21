/**
 * Board style sampling for the synthetic image generator. Pure and deterministic:
 * every choice comes from the seeded PRNG passed in. Never imported by src.
 */
import type { Grid } from "../../src/types";

/** Families tried in order; the generator keeps those the local browser can render. */
export const FONT_CANDIDATES = [
  "Helvetica",
  "Arial",
  "Times New Roman",
  "Georgia",
  "Courier New",
  "Verdana",
  "Avenir Next",
  "Futura",
  "Menlo",
  "Palatino",
  "Optima",
  "Gill Sans",
  "Trebuchet MS",
  "American Typewriter",
  "Didot",
  "Rockwell",
  "Baskerville",
  // Common on Linux.
  "DejaVu Sans",
  "DejaVu Serif",
  "Liberation Sans",
  "Liberation Serif",
  "Liberation Mono",
  "Noto Sans",
  "Noto Serif",
];

export type BoardStyle = {
  font: string;
  fontWeight: "normal" | "bold";
  /** Digit font size as a fraction of the cell size. */
  digitScale: number;
  /** Line widths in px at the rendered board size. */
  thin: number;
  thick: number;
  border: number;
  ink: string;
  lineInk: string;
  thinInk: string;
  paper: string;
  /** Newspaper style: alternate 3x3 boxes tinted. */
  shadeBoxes: boolean;
  shade: string;
};

export type BoardSpec = {
  grid: Grid;
  /** Board edge length in px (outer edge of the border). */
  size: number;
  /** Paper margin around the board in px. */
  margin: number;
  style: BoardStyle;
  /** 81 per-cell digit offsets as fractions of the cell size. */
  jitter: [number, number][];
};

type Rand = () => number;
export const uniform = (r: Rand, lo: number, hi: number) => lo + (hi - lo) * r();
export const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

const gray = (v: number) => `rgb(${v}, ${v}, ${v})`;

/** Sample a print style. `font` is chosen by the caller so fonts are spread evenly. */
export function sampleStyle(r: Rand, font: string, size: number): BoardStyle {
  // Line weights scale with the board so a 450px and a 900px board look like the same print.
  const k = size / 500;
  const thin = round(uniform(r, 0.8, 3) * k, 1);
  const thick = round(Math.max(thin + 1, uniform(r, 2, 7) * k), 1);
  const ink = pick(r, ["#000", "#111", "#222", "#1a1a3a", "#2b2b2b", "#0d1b2a"]);
  const paperTone = Math.round(uniform(r, 225, 255));
  const warm = r() < 0.4;
  const paper = warm ? `rgb(${paperTone}, ${paperTone - 6}, ${paperTone - 18})` : gray(paperTone);
  return {
    font,
    fontWeight: r() < 0.35 ? "bold" : "normal",
    digitScale: round(uniform(r, 0.5, 0.8)),
    thin,
    thick,
    border: round(thick + uniform(r, 0, 3) * k, 1),
    ink,
    lineInk: ink,
    thinInk: r() < 0.3 ? gray(Math.round(uniform(r, 80, 150))) : ink,
    paper,
    shadeBoxes: r() < 0.15,
    shade: gray(Math.round(paperTone * uniform(r, 0.86, 0.94))),
  };
}

export function boardSpec(r: Rand, grid: Grid, font: string, size: number): BoardSpec {
  const style = sampleStyle(r, font, size);
  const margin = Math.round(size * uniform(r, 0.04, 0.25));
  const j = uniform(r, 0, 0.05);
  const jitter = Array.from({ length: 81 }, (): [number, number] => [
    round(uniform(r, -j, j), 3),
    round(uniform(r, -j, j), 3),
  ]);
  return { grid, size, margin, style, jitter };
}

/** Board corners (outer border edge) in paper pixel coordinates: TL, TR, BR, BL. */
export function boardCorners(spec: BoardSpec): [number, number][] {
  const a = spec.margin;
  const b = spec.margin + spec.size;
  return [
    [a, a],
    [b, a],
    [b, b],
    [a, b],
  ];
}
