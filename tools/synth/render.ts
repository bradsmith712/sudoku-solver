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
  caption?: Caption | null;
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

/** Newspaper-style text printed on the paper around the puzzle. */
export type Caption = { header: string; footer: string; size: number; font: string };

const WORDS =
  "the of and to in is for on with by at from puzzle daily times weekly answers page edition crossword across down solution difficulty moderate tough gentle fill every row column box digits".split(
    " ",
  );

/** Header/footer text for the paper margin, or null if the margin is too small. */
export function sampleCaption(r: Rand, spec: BoardSpec): Caption | null {
  const size = Math.round(spec.margin * uniform(r, 0.3, 0.5));
  if (size < 9) return null;
  const n = 1 + Math.floor(r() * 400);
  return {
    header: pick(r, [
      `SUDOKU No. ${n}`,
      `Sudoku ${n}`,
      `DAILY SUDOKU`,
      `Sudoku — ${pick(r, ["Easy", "Medium", "Hard"])}`,
    ]),
    footer: pick(r, ["Fill every row, column and box with 1-9", `Solution on page ${n % 40}`, ""]),
    size,
    font: pick(r, ["Georgia", "Helvetica", "Times New Roman", "serif", "sans-serif"]),
  };
}

type TextItem = { kind: "text"; size: number; font: string; lines: string[] };
type ShapeItem = { kind: "rect" | "ellipse"; w: number; h: number; fill: boolean };
type StrokeItem = { kind: "stroke"; points: [number, number][] };
export type SceneItem = (TextItem | ShapeItem | StrokeItem) & {
  x: number;
  y: number;
  angle: number;
  color: string;
  lineWidth: number;
};

export type SceneSpec = {
  width: number;
  height: number;
  /** Surface gradient endpoints. */
  surface: [string, string];
  /** Long faint curves across the surface (wood grain, fabric folds). */
  streaks: { y: number; wave: number; width: number; color: string }[];
  items: SceneItem[];
};

const SURFACES: { name: string; colors: [string, string]; streak: string | null }[] = [
  { name: "wood", colors: ["#9a6a3c", "#7c5230"], streak: "rgba(60, 35, 15, 0.25)" },
  { name: "light-wood", colors: ["#d2b48c", "#c09a6b"], streak: "rgba(120, 80, 40, 0.2)" },
  { name: "gray-desk", colors: ["#8d8f94", "#6f7176"], streak: null },
  { name: "white-desk", colors: ["#e6e6e3", "#cfcfcb"], streak: null },
  { name: "dark", colors: ["#2d2e33", "#45464d"], streak: null },
  { name: "cutting-mat", colors: ["#2f6b4f", "#245740"], streak: null },
  { name: "fabric", colors: ["#3c5a85", "#2f496d"], streak: "rgba(0, 0, 0, 0.12)" },
];

/** Background surface with `clutter` random objects (text, shapes, pen strokes). */
export function sampleScene(r: Rand, width: number, height: number, clutter: number) {
  const surface = pick(r, SURFACES);
  const streaks = surface.streak
    ? Array.from({ length: 8 + Math.floor(r() * 20) }, () => ({
        y: Math.round(uniform(r, 0, height)),
        wave: Math.round(uniform(r, -40, 40)),
        width: round(uniform(r, 1, 6), 1),
        color: surface.streak!,
      }))
    : [];
  const colors = ["#111", "#333", "#777", "#c22", "#225", "#ddd", "#fff", "#e8d36a", "#3a7"];
  const items: SceneItem[] = Array.from({ length: clutter }, () => {
    const base = {
      x: Math.round(uniform(r, -50, width)),
      y: Math.round(uniform(r, -50, height)),
      angle: round(uniform(r, -Math.PI, Math.PI)),
      color: pick(r, colors),
      lineWidth: round(uniform(r, 1, 8), 1),
    };
    const kind = pick(r, ["text", "text", "rect", "ellipse", "stroke"] as const);
    if (kind === "text") {
      const lines = Array.from({ length: 1 + Math.floor(r() * 8) }, () =>
        Array.from({ length: 3 + Math.floor(r() * 6) }, () =>
          r() < 0.15 ? String(Math.floor(r() * 1000)) : pick(r, WORDS),
        ).join(" "),
      );
      const size = Math.round(uniform(r, 10, 40));
      return { ...base, kind, size, font: pick(r, ["serif", "sans-serif", "monospace"]), lines };
    }
    if (kind === "stroke") {
      const points: [number, number][] = [[0, 0]];
      for (let k = 0; k < 2 + Math.floor(r() * 6); k++) {
        const [px, py] = points[points.length - 1];
        points.push([
          Math.round(px + uniform(r, -120, 120)),
          Math.round(py + uniform(r, -120, 120)),
        ]);
      }
      return { ...base, kind, points };
    }
    return {
      ...base,
      kind,
      w: Math.round(uniform(r, 30, 400)),
      h: Math.round(uniform(r, 20, 300)),
      fill: r() < 0.5,
    };
  });
  const spec: SceneSpec = { width, height, surface: surface.colors, streaks, items };
  return { spec, surface: surface.name };
}
