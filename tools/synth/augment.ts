/**
 * Photo-like augmentations for synthetic boards: camera pose (rotation and perspective
 * tilt), uneven lighting, blur and sensor noise. Pure functions on RGBA buffers,
 * deterministic given the PRNG. Never imported by src.
 */
import type { Rgba } from "./browser";
import { pick, uniform } from "./render";
import type { Point } from "./truth";

type Rand = () => number;
type Mat3 = number[]; // row-major 3x3

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error("singular system");
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Homography mapping the four `src` points onto the four `dst` points. */
export function homography(src: Point[], dst: Point[]): Mat3 {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solveLinear(A, b), 1];
}

export function project(H: Mat3, [x, y]: Point): Point {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function invert(H: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
}

export type Pose = {
  /** In-plane rotation, degrees (positive = clockwise on screen). */
  rotationDeg: number;
  /** Camera tilt about the paper's horizontal and vertical axes, degrees. */
  tiltXDeg: number;
  tiltYDeg: number;
  /** Camera distance in units of the paper size; smaller = stronger keystone. */
  distance: number;
};

/**
 * Where the corners of a unit square (centered at the origin) land when photographed
 * with `pose`, before scaling and placement. Pinhole camera with focal = distance.
 */
export function poseQuad(pose: Pose, square: Point[]): Point[] {
  const rad = Math.PI / 180;
  const [rz, rx, ry] = [pose.rotationDeg * rad, pose.tiltXDeg * rad, pose.tiltYDeg * rad];
  return square.map(([u, v]) => {
    // In-plane rotation.
    let x = u * Math.cos(rz) - v * Math.sin(rz);
    let y = u * Math.sin(rz) + v * Math.cos(rz);
    let z = 0;
    // Tilt about the x axis, then the y axis.
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    const depth = pose.distance + z;
    return [(x * pose.distance) / depth, (y * pose.distance) / depth];
  });
}

/** Draw `src` onto `dst` (in place) through homography H (src -> dst), bilinear, antialiased edges. */
export function warpOnto(dst: Rgba, src: Rgba, H: Mat3): void {
  const Hi = invert(H);
  const corners = [
    [0, 0],
    [src.width, 0],
    [src.width, src.height],
    [0, src.height],
  ].map((p) => project(H, p as Point));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x0 = clamp(Math.floor(Math.min(...xs)), 0, dst.width);
  const x1 = clamp(Math.ceil(Math.max(...xs)), 0, dst.width);
  const y0 = clamp(Math.floor(Math.min(...ys)), 0, dst.height);
  const y1 = clamp(Math.ceil(Math.max(...ys)), 0, dst.height);
  const { width: sw, height: sh, data: s } = src;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [u, v] = project(Hi, [x + 0.5, y + 0.5]);
      // Coverage: fade over the last half pixel at the paper edge.
      const edge = Math.min(u, v, sw - u, sh - v) + 0.5;
      if (edge <= 0) continue;
      const alpha = Math.min(1, edge);
      const fx = clamp(u - 0.5, 0, sw - 1);
      const fy = clamp(v - 0.5, 0, sh - 1);
      const ix = Math.min(Math.floor(fx), sw - 2);
      const iy = Math.min(Math.floor(fy), sh - 2);
      const ax = fx - ix;
      const ay = fy - iy;
      const o = (y * dst.width + x) * 4;
      const i00 = (iy * sw + ix) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] * (1 - ax) + s[i10 + c] * ax;
        const bot = s[i01 + c] * (1 - ax) + s[i11 + c] * ax;
        const val = top * (1 - ay) + bot * ay;
        dst.data[o + c] = dst.data[o + c] * (1 - alpha) + val * alpha;
      }
    }
  }
}

export type Lighting = {
  /** Linear falloff: brightness goes from 1 to `low` along `angleDeg`. */
  angleDeg: number;
  low: number;
  /** Overall exposure multiplier. */
  exposure: number;
  /** Per-channel color cast (warm or cool light). */
  tint: [number, number, number];
  /** Soft elliptical shadow (e.g. a hand or phone), coordinates as image fractions. */
  shadow: { cx: number; cy: number; rx: number; ry: number; strength: number } | null;
};

export function applyLighting(img: Rgba, L: Lighting): void {
  const { width: w, height: h, data } = img;
  const dx = Math.cos((L.angleDeg * Math.PI) / 180);
  const dy = Math.sin((L.angleDeg * Math.PI) / 180);
  // Project the image corners onto the gradient direction to normalize t into [0, 1].
  const ts = [0, w * dx, h * dy, w * dx + h * dy];
  const tMin = Math.min(...ts);
  const tSpan = Math.max(...ts) - tMin || 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x * dx + y * dy - tMin) / tSpan;
      let f = L.exposure * (1 - (1 - L.low) * t);
      if (L.shadow) {
        const sx = (x / w - L.shadow.cx) / L.shadow.rx;
        const sy = (y / h - L.shadow.cy) / L.shadow.ry;
        f *= 1 - L.shadow.strength * Math.exp(-(sx * sx + sy * sy));
      }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = data[o + c] * f * L.tint[c];
    }
  }
}

/** Approximate Gaussian blur with three box-blur passes per axis. */
export function gaussianBlur(img: Rgba, sigma: number): void {
  if (sigma < 0.3) return;
  // Box radius whose three-pass variance matches sigma^2.
  const radius = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  const { width: w, height: h, data } = img;
  const buf = new Float32Array(Math.max(w, h));
  const pass = (len: number, count: number, at: (line: number, k: number) => number) => {
    for (let line = 0; line < count; line++) {
      for (let c = 0; c < 3; c++) {
        for (let k = 0; k < len; k++) buf[k] = data[at(line, k) + c];
        let acc = 0;
        for (let k = -radius; k <= radius; k++) acc += buf[clamp(k, 0, len - 1)];
        for (let k = 0; k < len; k++) {
          data[at(line, k) + c] = acc / (2 * radius + 1);
          acc += buf[Math.min(k + radius + 1, len - 1)] - buf[Math.max(k - radius, 0)];
        }
      }
    }
  };
  for (let p = 0; p < 3; p++) {
    pass(w, h, (row, k) => (row * w + k) * 4);
    pass(h, w, (col, k) => (k * w + col) * 4);
  }
}

/** Additive Gaussian sensor noise, mostly luminance with a little chroma. */
export function addNoise(img: Rgba, sigma: number, r: Rand): void {
  if (sigma <= 0) return;
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const { data } = img;
  for (let o = 0; o < data.length; o += 4) {
    const lum = gauss() * sigma;
    for (let c = 0; c < 3; c++) data[o + c] = data[o + c] + lum + gauss() * sigma * 0.3;
  }
}

export type AugmentParams = {
  pose: Pose;
  /** Board edge length as a fraction of the image's short side. */
  boardFrac: number;
  blurSigma: number;
  noiseSigma: number;
  lighting: Lighting | null;
  /** Number of clutter objects on the background (0 = plain surface). */
  clutter: number;
  jpegQuality: number;
  /** Labels for the strong augmentations applied; ["clean"] when none. */
  tags: string[];
};

const KINDS = ["rot", "persp", "blur", "noise", "light", "clutter"] as const;
const PROB: Record<(typeof KINDS)[number], number> = {
  rot: 0.65,
  persp: 0.6,
  blur: 0.45,
  noise: 0.45,
  light: 0.55,
  clutter: 0.6,
};

/**
 * Sample augmentation strengths. `clean` images get a straight, sharp, evenly lit board on a
 * plain surface. Otherwise each augmentation is switched on independently (at least one is),
 * and the ones left off still get a small, untagged amount of variation.
 */
export function sampleAugment(r: Rand, clean: boolean): AugmentParams {
  const on = new Set(clean ? [] : KINDS.filter((k) => r() < PROB[k]));
  if (!clean && on.size === 0) on.add(pick(r, KINDS));
  const signed = (lo: number, hi: number) => (r() < 0.5 ? -1 : 1) * uniform(r, lo, hi);
  const small = clean ? 0 : 1;

  const pose: Pose = {
    rotationDeg: round(on.has("rot") ? signed(3, 30) : small * signed(0, 2)),
    tiltXDeg: round(on.has("persp") ? signed(8, 38) : small * signed(0, 4)),
    tiltYDeg: round(on.has("persp") ? signed(0, 30) : small * signed(0, 4)),
    distance: round(uniform(r, 1.3, 3)),
  };
  const lighting: Lighting | null = on.has("light")
    ? {
        angleDeg: round(uniform(r, 0, 360)),
        low: round(uniform(r, 0.45, 0.85)),
        exposure: round(uniform(r, 0.85, 1.1)),
        tint: pick(r, [
          [1, 1, 1],
          [1, 0.96, 0.86],
          [1, 0.93, 0.8],
          [0.92, 0.96, 1],
        ] as [number, number, number][]),
        shadow:
          r() < 0.45
            ? {
                cx: round(uniform(r, 0.1, 0.9)),
                cy: round(uniform(r, 0.1, 0.9)),
                rx: round(uniform(r, 0.15, 0.5)),
                ry: round(uniform(r, 0.15, 0.5)),
                strength: round(uniform(r, 0.2, 0.5)),
              }
            : null,
      }
    : null;
  return {
    pose,
    boardFrac: round(uniform(r, 0.5, 0.85)),
    blurSigma: round(on.has("blur") ? uniform(r, 0.7, 2) : 0),
    noiseSigma: round(on.has("noise") ? uniform(r, 4, 14) : 0),
    lighting,
    clutter: on.has("clutter") ? 5 + Math.floor(r() * 12) : 0,
    jpegQuality: round(clean ? 0.95 : uniform(r, 0.72, 0.95)),
    tags: on.size ? KINDS.filter((k) => on.has(k)) : ["clean"],
  };
}
