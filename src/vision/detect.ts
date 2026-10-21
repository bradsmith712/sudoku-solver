import type { Mat, MatVector } from "@techstark/opencv-js";
import { isConvex, orderCorners, polygonArea, type Point } from "./geometry";
import type { CV } from "./opencv";

/** A board must cover at least this fraction of the image. */
export const MIN_BOARD_AREA_FRACTION = 0.05;
/** Largest contours to try before giving up. */
const MAX_CANDIDATES = 5;
/** approxPolyDP tolerances, as a fraction of the contour perimeter. */
const APPROX_EPSILONS = [0.02, 0.035, 0.05];
/** The quad must explain most of the contour's convex hull (rejects blobs). */
const MIN_HULL_FILL = 0.85;
/** Shortest side over longest side; rejects slivers. */
const MIN_SIDE_RATIO = 0.3;

function matToPoints(mat: Mat): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < mat.rows; i++) pts.push({ x: mat.data32S[i * 2], y: mat.data32S[i * 2 + 1] });
  return pts;
}

function sideRatio(q: readonly Point[]): number {
  const sides = q.map((a, i) => Math.hypot(a.x - q[(i + 1) % 4].x, a.y - q[(i + 1) % 4].y));
  return Math.min(...sides) / Math.max(...sides);
}

/** Fit a convex 4-gon to one contour's hull, or null if none fits. */
function quadFromContour(cv: CV, contour: Mat, minArea: number): Point[] | null {
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
      if (
        isConvex(quad) &&
        polygonArea(quad) >= Math.max(minArea, MIN_HULL_FILL * hullArea) &&
        sideRatio(quad) >= MIN_SIDE_RATIO
      ) {
        return quad;
      }
      return null;
    }
    return null;
  } finally {
    hull.delete();
    approx.delete();
  }
}

/**
 * Fallback for a board whose outline touches clutter (a pen stroke, a table edge):
 * fill the contour, open it with a kernel wider than thin lines so only the solid
 * board region survives, then fit a quad to what is left.
 */
function quadFromOpenedContour(
  cv: CV,
  contours: MatVector,
  index: number,
  rows: number,
  cols: number,
  minArea: number,
): Point[] | null {
  const mask = cv.Mat.zeros(rows, cols, cv.CV_8UC1);
  const k = Math.max(5, Math.round(Math.min(rows, cols) / 60)) | 1;
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k));
  const inner = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.drawContours(mask, contours, index, new cv.Scalar(255), cv.FILLED);
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
    cv.findContours(mask, inner, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best: Point[] | null = null;
    let bestArea = 0;
    for (let i = 0; i < inner.size(); i++) {
      const c = inner.get(i);
      try {
        const area = cv.contourArea(c);
        if (area <= bestArea) continue;
        const quad = quadFromContour(cv, c, minArea);
        if (quad) {
          best = quad;
          bestArea = area;
        }
      } finally {
        c.delete();
      }
    }
    return best;
  } finally {
    mask.delete();
    kernel.delete();
    inner.delete();
    hierarchy.delete();
  }
}

/**
 * Find the board outline in a binary ink mask (see preprocess): the largest
 * external contour that is well approximated by a convex quadrilateral covering
 * at least MIN_BOARD_AREA_FRACTION of the image. Returns its corners ordered
 * top-left, top-right, bottom-right, bottom-left, or null if there is none.
 */
export function findBoardQuad(cv: CV, binary: Mat): [Point, Point, Point, Point] | null {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const minArea = MIN_BOARD_AREA_FRACTION * binary.rows * binary.cols;
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
        const quad =
          quadFromContour(cv, c, minArea) ??
          quadFromOpenedContour(cv, contours, index, binary.rows, binary.cols, minArea);
        if (quad) return orderCorners(quad);
      } finally {
        c.delete();
      }
    }
    return null;
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}
