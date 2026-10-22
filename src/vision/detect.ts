import type { Mat, MatVector } from "@techstark/opencv-js";
import {
  applyHomography,
  containsPoint,
  isConvex,
  orderCorners,
  polygonArea,
  squareToQuad,
  type Point,
} from "./geometry";
import type { CV } from "./opencv";

/** A board must cover at least this fraction of the image. */
export const MIN_BOARD_AREA_FRACTION = 0.05;
/** Largest contours to try before giving up. */
const MAX_CANDIDATES = 8;
/** approxPolyDP tolerances, as a fraction of the contour perimeter. */
const APPROX_EPSILONS = [0.02, 0.035, 0.05];
/** The quad must explain most of the contour's convex hull (rejects blobs). */
const MIN_HULL_FILL = 0.85;
/** Shortest side over longest side; rejects slivers. */
const MIN_SIDE_RATIO = 0.3;
/** Weakest side's fraction on ink needed to accept a quad (see edgeSupport). */
const MIN_EDGE_SUPPORT = 0.75;
/** Edge support at which a fit is trusted without trying the slower fallbacks. */
const GOOD_EDGE_SUPPORT = 0.9;
/** Weakest 3x3 box line's ink contrast for a quad to count as a sudoku grid. */
const MIN_GRID_SUPPORT = 0.4;
/**
 * A grid quad nested inside another and covering at least this fraction of it is
 * the board, and the outer one its paper or a frame: board-to-paper area runs from
 * about 0.4 (wide margin) to 0.9, while a single 3x3 box is only 1/9 of a board.
 */
const MIN_NESTED_AREA = 0.25;
/** Box lines are searched this far (fraction of the board) from where the quad puts them. */
const GRID_SHIFT = 1 / 60;
/** Contour segments within 8 degrees and 2% of the board size merge into one side. */
const SIDE_PARALLEL_COS = Math.cos((8 * Math.PI) / 180);
const SIDE_MERGE_DISTANCE = 0.02;
/** Strongest side lines whose 4-combinations quadFromSides tries. */
const MAX_SIDE_LINES = 12;
/** Holes up to this fraction of the image (a few cells of a full-frame board) get filled. */
const MAX_FILLED_HOLE_FRACTION = 0.02;

/** support: edgeSupport of the outline; grid: whether gridSupport passed. */
type Fit = { quad: Point[]; support: number; grid: boolean };

function matToPoints(mat: Mat): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < mat.rows; i++) pts.push({ x: mat.data32S[i * 2], y: mat.data32S[i * 2 + 1] });
  return pts;
}

function sideRatio(q: readonly Point[]): number {
  const sides = q.map((a, i) => Math.hypot(a.x - q[(i + 1) % 4].x, a.y - q[(i + 1) % 4].y));
  return Math.min(...sides) / Math.max(...sides);
}

function plausibleQuad(quad: readonly Point[], minArea: number): boolean {
  return isConvex(quad) && polygonArea(quad) >= minArea && sideRatio(quad) >= MIN_SIDE_RATIO;
}

/** Fraction of points sampled every 2 px from a to b with ink within `radius` px. */
function segmentSupport(binary: Mat, a: Point, b: Point, radius: number): number {
  const { rows, cols } = binary;
  const data = binary.data;
  const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  let hits = 0;
  for (let s = 0; s < steps; s++) {
    const x = Math.round(a.x + ((b.x - a.x) * s) / steps);
    const y = Math.round(a.y + ((b.y - a.y) * s) / steps);
    search: for (let dy = -radius; dy <= radius; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= rows) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < cols && data[yy * cols + xx]) {
          hits++;
          break search;
        }
      }
    }
  }
  return hits / steps;
}

/**
 * How well a quad's edges lie on ink: for each side, the fraction of points sampled
 * every 2 px that have ink within a couple of pixels in the binary mask; returns
 * the weakest side's score. A real board outline scores near 1 on every side; a
 * side that strays onto clutter or across the board's interior scores much lower.
 */
export function edgeSupport(binary: Mat, quad: readonly Point[]): number {
  const radius = Math.max(2, Math.round(Math.min(binary.rows, binary.cols) / 400));
  let weakest = 1;
  for (let i = 0; i < 4; i++) {
    weakest = Math.min(weakest, segmentSupport(binary, quad[i], quad[(i + 1) % 4], radius));
  }
  return weakest;
}

/**
 * How clearly the quad's interior shows a sudoku's 3x3 box lines. For each of the
 * four lines at 1/3 and 2/3 across (mapped through the quad's perspective): the
 * fraction of pixels exactly on ink, at the best of small shifts that absorb fit
 * error, minus the fraction on the lines half a cell either side. Returns the
 * weakest line's contrast. Contrast rather than raw ink keeps the score meaningful
 * on noisy masks, where speckle puts ink near every point. An inked outline that is
 * not a board, such as the edge of the paper the board is printed on (adaptive
 * thresholding inks the dark side of that step), scores near 0.
 */
export function gridSupport(binary: Mat, quad: readonly Point[]): number {
  const h = squareToQuad(quad);
  const side = Math.sqrt(polygonArea(quad));
  const at = (u: number, v: number) => applyHomography(h, { x: u, y: v });
  let weakest = Infinity;
  for (const across of [true, false]) {
    const ink = (t: number) => {
      const a = across ? at(t, 0) : at(0, t);
      const b = across ? at(t, 1) : at(1, t);
      return inkOnSegment(binary, a, b) / (Math.round(Math.hypot(b.x - a.x, b.y - a.y)) + 1);
    };
    for (const t of [1 / 3, 2 / 3]) {
      let on = 0;
      for (let dt = -GRID_SHIFT; dt <= GRID_SHIFT; dt += 1 / side) on = Math.max(on, ink(t + dt));
      const off = (ink(t - 1 / 18) + ink(t + 1 / 18)) / 2;
      weakest = Math.min(weakest, on - off);
    }
  }
  return weakest;
}

function makeFit(binary: Mat, quad: Point[]): Fit {
  const support = edgeSupport(binary, quad);
  // Only well-outlined quads can win on grid, so skip the extra sampling otherwise.
  const grid = support >= GOOD_EDGE_SUPPORT && gridSupport(binary, quad) >= MIN_GRID_SUPPORT;
  return { quad, support, grid };
}

/** Fit a convex 4-gon to one contour's hull, or null if none fits. */
function quadFromHull(cv: CV, contour: Mat, minArea: number): Point[] | null {
  const hull = new cv.Mat();
  const approx = new cv.Mat();
  try {
    cv.convexHull(contour, hull, false, true);
    const hullArea = cv.contourArea(hull);
    if (hullArea < minArea) return null;
    const perimeter = cv.arcLength(hull, true);
    for (const eps of APPROX_EPSILONS) {
      cv.approxPolyDP(hull, approx, eps * perimeter, true);
      if (approx.rows < 4) return null;
      if (approx.rows > 4) continue;
      const quad = matToPoints(approx);
      const ok = plausibleQuad(quad, minArea) && polygonArea(quad) >= MIN_HULL_FILL * hullArea;
      return ok ? quad : null;
    }
    return null;
  } finally {
    hull.delete();
    approx.delete();
  }
}

/** A straight side: unit normal (nx, ny), offset d (n . p = d), length-weighted centre. */
type Line = { nx: number; ny: number; d: number; weight: number; mx: number; my: number };
type Segment = { a: Point; b: Point; length: number };

/** Total least-squares line through segments, each weighted by its length. */
function fitLine(segments: readonly Segment[]): Line {
  let w = 0;
  let mx = 0;
  let my = 0;
  for (const { a, b, length } of segments) {
    w += length;
    mx += ((a.x + b.x) / 2) * length;
    my += ((a.y + b.y) / 2) * length;
  }
  mx /= w;
  my /= w;
  // Second moments of each segment as a uniform rod about the common centre.
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const { a, b, length } of segments) {
    const cx = (a.x + b.x) / 2 - mx;
    const cy = (a.y + b.y) / 2 - my;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    sxx += length * (cx * cx + (dx * dx) / 12);
    syy += length * (cy * cy + (dy * dy) / 12);
    sxy += length * (cx * cy + (dx * dy) / 12);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // principal direction
  const nx = -Math.sin(theta);
  const ny = Math.cos(theta);
  return { nx, ny, d: nx * mx + ny * my, weight: w, mx, my };
}

function intersect(l1: Line, l2: Line): Point | null {
  const det = l1.nx * l2.ny - l1.ny * l2.nx;
  if (Math.abs(det) < 0.2) return null; // nearly parallel
  return { x: (l1.d * l2.ny - l2.d * l1.ny) / det, y: (l1.nx * l2.d - l2.nx * l1.d) / det };
}

/**
 * Prefer fits that enclose a 3x3 box grid, then fits whose edges are all on ink and,
 * among those, the largest: the inner box lines are inked too, so only area
 * separates the outer border from them.
 */
function better(a: Fit, b: Fit): boolean {
  if (a.grid !== b.grid) return a.grid;
  const aGood = a.support >= GOOD_EDGE_SUPPORT;
  const bGood = b.support >= GOOD_EDGE_SUPPORT;
  if (aGood !== bGood) return aGood;
  return aGood ? polygonArea(a.quad) > polygonArea(b.quad) : a.support > b.support;
}

/**
 * Fit a quad from the contour's dominant straight sides instead of its hull:
 * simplify the contour, merge collinear segments into length-weighted lines, then
 * try every 4 of the strongest lines and keep the best (see `better`). Blobs stuck to the board (clutter, text) add bulges and stray lines, but
 * the board's four long, fully inked sides still win.
 */
function quadFromSides(cv: CV, contour: Mat, binary: Mat, minArea: number): Fit | null {
  const approx = new cv.Mat();
  let pts: Point[];
  try {
    cv.approxPolyDP(contour, approx, 0.01 * cv.arcLength(contour, true), true);
    pts = matToPoints(approx);
  } finally {
    approx.delete();
  }
  if (pts.length < 4) return null;
  const scale = Math.sqrt(polygonArea(pts));
  const segments = pts
    .map((a, i) => {
      const b = pts[(i + 1) % pts.length];
      return { a, b, length: Math.hypot(b.x - a.x, b.y - a.y) };
    })
    .filter((s) => s.length > 0)
    .sort((s1, s2) => s2.length - s1.length);

  const groups: { line: Line; members: Segment[] }[] = [];
  for (const seg of segments) {
    const nx = -(seg.b.y - seg.a.y) / seg.length;
    const ny = (seg.b.x - seg.a.x) / seg.length;
    const mx = (seg.a.x + seg.b.x) / 2;
    const my = (seg.a.y + seg.b.y) / 2;
    const group = groups.find(
      ({ line }) =>
        Math.abs(nx * line.nx + ny * line.ny) > SIDE_PARALLEL_COS &&
        Math.abs(line.nx * mx + line.ny * my - line.d) < SIDE_MERGE_DISTANCE * scale,
    );
    if (group) {
      group.members.push(seg);
      group.line = fitLine(group.members);
    } else {
      groups.push({ line: fitLine([seg]), members: [seg] });
    }
  }
  const lines = groups
    .map((g) => g.line)
    .sort((l1, l2) => l2.weight - l1.weight)
    .slice(0, MAX_SIDE_LINES);

  let best: Fit | null = null;
  const n = lines.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++)
        for (let l = k + 1; l < n; l++) {
          const four = [lines[i], lines[j], lines[k], lines[l]];
          const cx = four.reduce((s, ln) => s + ln.mx, 0) / 4;
          const cy = four.reduce((s, ln) => s + ln.my, 0) / 4;
          four.sort((a, b) => Math.atan2(a.my - cy, a.mx - cx) - Math.atan2(b.my - cy, b.mx - cx));
          const quad: Point[] = [];
          for (let m = 0; m < 4; m++) {
            const p = intersect(four[m], four[(m + 1) % 4]);
            if (p) quad.push(p);
          }
          if (quad.length !== 4 || !plausibleQuad(quad, minArea)) continue;
          const fit = makeFit(binary, quad);
          if (!best || better(fit, best)) best = fit;
        }
  return best;
}

/**
 * Ink mask with the board turned into a solid blob and thin strokes removed, for
 * boards whose outline touches clutter or text: fill every hole up to a few cells
 * in size (so the grid becomes solid while large loops formed by clutter stay
 * open), then open with a kernel wider than pen strokes and text. Caller deletes.
 */
function solidBoardMask(cv: CV, binary: Mat): Mat {
  const k = Math.max(5, Math.round(Math.min(binary.rows, binary.cols) / 60)) | 1;
  const mask = binary.clone();
  let contours: MatVector | undefined;
  let hierarchy: Mat | undefined;
  let kernel: Mat | undefined;
  try {
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k));
    cv.findContours(binary, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
    const maxHole = MAX_FILLED_HOLE_FRACTION * binary.rows * binary.cols;
    for (let i = 0; i < contours.size(); i++) {
      if (hierarchy.data32S[i * 4 + 3] < 0) continue; // not a hole
      const c = contours.get(i);
      try {
        if (cv.contourArea(c) <= maxHole) {
          cv.drawContours(mask, contours, i, new cv.Scalar(255), cv.FILLED);
        }
      } finally {
        c.delete();
      }
    }
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
    return mask;
  } catch (err) {
    mask.delete();
    throw err;
  } finally {
    contours?.delete();
    hierarchy?.delete();
    kernel?.delete();
  }
}

/**
 * Among the largest contours of `mask`, the best quad by `better`. Nested contours
 * are included, so a board inside an inked outline is still found. When the edge of
 * the paper (or a frame) runs close to the board, its own 1/3 lines can land on the
 * board's box lines and it passes as a grid too; so a grid quad nested well inside
 * the chosen one replaces it (see MIN_NESTED_AREA). Each contour is fitted by its
 * hull first and by its straight sides if the hull fit is weak.
 */
function bestQuad(cv: CV, mask: Mat, binary: Mat, minArea: number): Fit | null {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const fits: Fit[] = [];
  try {
    cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const candidates: { index: number; area: number }[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      try {
        // Cheap prefilter on the bounding box, then rank by enclosed area.
        const rect = cv.boundingRect(c);
        if (rect.width * rect.height >= minArea) {
          candidates.push({ index: i, area: cv.contourArea(c) });
        }
      } finally {
        c.delete();
      }
    }
    candidates.sort((a, b) => b.area - a.area);
    for (const { index } of candidates.slice(0, MAX_CANDIDATES)) {
      const c = contours.get(index);
      try {
        const hullQuad = quadFromHull(cv, c, minArea);
        let fit = hullQuad ? makeFit(binary, hullQuad) : null;
        if (!fit || !fit.grid) {
          const sides = quadFromSides(cv, c, binary, minArea);
          if (sides && (!fit || better(sides, fit))) fit = sides;
        }
        if (fit) fits.push(fit);
      } finally {
        c.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
  let best = fits.reduce<Fit | null>((b, f) => (!b || better(f, b) ? f : b), null);
  for (;;) {
    const outer = best;
    if (!outer?.grid) return outer;
    const area = polygonArea(outer.quad);
    const inner = fits.find(
      (f) =>
        f.grid &&
        polygonArea(f.quad) < area &&
        polygonArea(f.quad) >= MIN_NESTED_AREA * area &&
        f.quad.every((p) => containsPoint(outer.quad, p)),
    );
    if (!inner) return outer;
    best = inner;
  }
}

/** Count of points sampled every pixel from a to b that land exactly on ink. */
function inkOnSegment(binary: Mat, a: Point, b: Point): number {
  const { rows, cols } = binary;
  const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
  let hits = 0;
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(a.x + ((b.x - a.x) * s) / steps);
    const y = Math.round(a.y + ((b.y - a.y) * s) / steps);
    if (x >= 0 && x < cols && y >= 0 && y < rows && binary.data[y * cols + x]) hits++;
  }
  return hits;
}

/**
 * Snap each side onto the border line: slide its two ends independently up to
 * REFINE_RADIUS px along the side's normal and keep the placement with the most
 * ink exactly under it, then intersect neighbouring sides for the new corners.
 * Fixes fits pulled a few pixels off by text or clutter touching the border.
 * Ends are sampled 10% in from the corners so neighbouring sides do not count.
 */
function refineQuad(binary: Mat, quad: readonly Point[]): Point[] {
  const radius = Math.max(3, Math.round(Math.min(binary.rows, binary.cols) / 150));
  const lines: Line[] = [];
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % 4];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const nx = -(q.y - p.y) / len;
    const ny = (q.x - p.x) / len;
    const a = { x: p.x + (q.x - p.x) * 0.1, y: p.y + (q.y - p.y) * 0.1 };
    const b = { x: p.x + (q.x - p.x) * 0.9, y: p.y + (q.y - p.y) * 0.9 };
    let best = { score: -1, move: 0, a, b };
    for (let da = -radius; da <= radius; da++) {
      for (let db = -radius; db <= radius; db++) {
        const a2 = { x: a.x + nx * da, y: a.y + ny * da };
        const b2 = { x: b.x + nx * db, y: b.y + ny * db };
        const score = inkOnSegment(binary, a2, b2);
        const move = Math.abs(da) + Math.abs(db);
        // Ties go to the smaller move, so a solid thick line keeps its fitted edge.
        if (score > best.score || (score === best.score && move < best.move)) {
          best = { score, move, a: a2, b: b2 };
        }
      }
    }
    lines.push(fitLine([{ a: best.a, b: best.b, length: 1 }]));
  }
  const refined: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const p = intersect(lines[(i + 3) % 4], lines[i]);
    if (!p) return [...quad];
    refined.push(p);
  }
  return refined;
}

/**
 * Find the board outline in a binary ink mask (see preprocess): the largest
 * contour that is well approximated by a convex quadrilateral covering at least
 * MIN_BOARD_AREA_FRACTION of the image, whose edges lie on ink and whose interior
 * shows the 3x3 box lines (see gridSupport). If clutter or text touching the board
 * spoils that, retry on a mask where the board is a solid blob (solidBoardMask).
 * A quad without a box grid is still returned if nothing better is found. Returns the corners ordered top-left, top-right,
 * bottom-right, bottom-left, or null if there is no board.
 */
export function findBoardQuad(cv: CV, binary: Mat): [Point, Point, Point, Point] | null {
  const minArea = MIN_BOARD_AREA_FRACTION * binary.rows * binary.cols;
  let fit = bestQuad(cv, binary, binary, minArea);
  if (!fit?.grid) {
    const solid = solidBoardMask(cv, binary);
    try {
      const retry = bestQuad(cv, solid, binary, minArea);
      if (retry && (!fit || better(retry, fit))) fit = retry;
    } finally {
      solid.delete();
    }
  }
  return fit && fit.support >= MIN_EDGE_SUPPORT ? orderCorners(refineQuad(binary, fit.quad)) : null;
}
