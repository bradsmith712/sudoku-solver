/** Pure 2D helpers for board corners. No OpenCV. */

export type Point = { x: number; y: number };

/** Unsigned polygon area (shoelace formula). */
export function polygonArea(points: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/**
 * Order four corners as top-left, top-right, bottom-right, bottom-left (image
 * coordinates, y down). Points are sorted clockwise around their centroid; the top
 * edge is the one whose midpoint is highest, and its first vertex is top-left.
 * Stable for any rotation under 45 degrees, including strong perspective where the
 * usual "smallest x + y is top-left" rule picks the wrong corner.
 */
export function orderCorners(points: readonly Point[]): [Point, Point, Point, Point] {
  if (points.length !== 4) throw new Error(`orderCorners needs 4 points, got ${points.length}`);
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  const clockwise = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  const edgeMidY = (i: number) => clockwise[i].y + clockwise[(i + 1) % 4].y;
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (edgeMidY(i) < edgeMidY(start)) start = i;
  }
  const o = (k: number) => ({ ...clockwise[(start + k) % 4] });
  return [o(0), o(1), o(2), o(3)];
}

/** True if the polygon (in order) turns the same way at every vertex. */
export function isConvex(points: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
