import { describe, expect, it } from "vitest";
import {
  applyHomography,
  containsPoint,
  isConvex,
  orderCorners,
  polygonArea,
  squareToQuad,
  type Point,
} from "./geometry";

const p = (x: number, y: number): Point => ({ x, y });

function rotate(points: Point[], deg: number, cx = 0, cy = 0): Point[] {
  const r = (deg * Math.PI) / 180;
  return points.map(({ x, y }) =>
    p(
      cx + (x - cx) * Math.cos(r) - (y - cy) * Math.sin(r),
      cy + (x - cx) * Math.sin(r) + (y - cy) * Math.cos(r),
    ),
  );
}

describe("orderCorners", () => {
  const square = [p(0, 0), p(100, 0), p(100, 100), p(0, 100)];

  it("orders an axis-aligned square from any input permutation", () => {
    const perms = [
      [2, 0, 3, 1],
      [3, 2, 1, 0],
      [1, 3, 0, 2],
    ];
    for (const perm of perms) {
      expect(orderCorners(perm.map((i) => square[i]))).toEqual(square);
    }
  });

  it("keeps the puzzle's top-left first for rotations up to +-40 degrees", () => {
    for (const deg of [-40, -25, -10, 10, 25, 40]) {
      const rotated = rotate(square, deg, 50, 50);
      const shuffled = [rotated[3], rotated[1], rotated[0], rotated[2]];
      expect(orderCorners(shuffled)).toEqual(rotated);
    }
  });

  it("handles strong perspective where sum/diff ordering fails", () => {
    // Far edge (top) much narrower than the near edge, shifted right.
    const quad = [p(300, 50), p(380, 60), p(390, 400), p(10, 300)];
    expect(orderCorners([quad[2], quad[0], quad[3], quad[1]])).toEqual(quad);
  });

  it("does not mutate its input and rejects the wrong number of points", () => {
    const input = [p(1, 1), p(0, 0), p(1, 0), p(0, 1)];
    const copy = input.map((q) => ({ ...q }));
    orderCorners(input);
    expect(input).toEqual(copy);
    expect(() => orderCorners(input.slice(0, 3))).toThrow();
  });
});

describe("polygonArea and isConvex", () => {
  it("computes area regardless of winding", () => {
    const sq = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    expect(polygonArea(sq)).toBe(100);
    expect(polygonArea([...sq].reverse())).toBe(100);
  });

  it("detects convex and non-convex quadrilaterals", () => {
    expect(isConvex([p(0, 0), p(10, 0), p(10, 10), p(0, 10)])).toBe(true);
    expect(isConvex([p(0, 0), p(10, 0), p(3, 3), p(0, 10)])).toBe(false);
    // Self-intersecting "bow tie".
    expect(isConvex([p(0, 0), p(10, 10), p(10, 0), p(0, 10)])).toBe(false);
  });
});

describe("squareToQuad", () => {
  it("maps the unit square's corners onto a perspective quad", () => {
    const quad = [p(190, 40), p(560, 90), p(520, 450), p(90, 380)];
    const h = squareToQuad(quad);
    [p(0, 0), p(1, 0), p(1, 1), p(0, 1)].forEach((c, i) => {
      const m = applyHomography(h, c);
      expect(m.x).toBeCloseTo(quad[i].x, 6);
      expect(m.y).toBeCloseTo(quad[i].y, 6);
    });
  });

  it("maps the centre to the diagonals' intersection, not the corner average", () => {
    // Trapezoid: diagonals cross at y = 200 * 300 / (300 + 100) = 150, not 100.
    const h = squareToQuad([p(0, 0), p(300, 0), p(200, 200), p(100, 200)]);
    const c = applyHomography(h, p(0.5, 0.5));
    expect(c.x).toBeCloseTo(150, 6);
    expect(c.y).toBeCloseTo(150, 6);
  });
});

describe("containsPoint", () => {
  it("tests strict containment in a convex polygon of either winding", () => {
    const quad = [p(0, 0), p(100, 10), p(90, 100), p(5, 90)];
    expect(containsPoint(quad, p(50, 50))).toBe(true);
    expect(containsPoint([...quad].reverse(), p(50, 50))).toBe(true);
    expect(containsPoint(quad, p(120, 50))).toBe(false);
    expect(containsPoint(quad, p(0, 0))).toBe(false);
  });
});
