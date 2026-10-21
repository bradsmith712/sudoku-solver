/**
 * Synthetic sudoku photo generator (offline). See tools/synth/README.md.
 *
 *   npx vite-node tools/synth/generate.ts [--count 240] [--out tests/fixtures/synthetic] [--seed 3]
 *
 * Writes <name>.jpg + <name>.json (see truth.ts) per image. Labels are deterministic for a
 * given seed; pixels also depend on the fonts installed on the machine.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { solve } from "../../src/solver/solver";
import { dig, randomSolution, rng } from "../lib/puzzles";
import { Renderer } from "./browser";
import { FONT_CANDIDATES, boardCorners, boardSpec, uniform } from "./render";
import type { Truth } from "./truth";

const ROOT = new URL("../../", import.meta.url).pathname;
const { values: args } = parseArgs({
  options: {
    count: { type: "string", default: "240" },
    out: { type: "string", default: "tests/fixtures/synthetic" },
    seed: { type: "string", default: "3" },
  },
});
const count = Number(args.count);
const baseSeed = Number(args.seed);
const out = resolve(ROOT, args.out!);

const renderer = await Renderer.launch();
try {
  const fonts = await renderer.availableFonts(FONT_CANDIDATES);
  if (fonts.length < 4)
    throw new Error(`only ${fonts.length} fonts available (${fonts.join(", ")}); install more`);
  console.log(`fonts: ${fonts.join(", ")}`);

  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out)) if (/^synth-\d+.*\.(jpg|json)$/.test(f)) rmSync(join(out, f));

  for (let i = 1; i <= count; i++) {
    // One PRNG per image, so image i is the same whatever --count is.
    const seed = baseSeed * 100003 + i;
    const r = rng(seed);
    const solution = randomSolution(r);
    const grid = dig(solution, Math.round(uniform(r, 24, 40)), r);
    if (solve(grid).status !== "solved") throw new Error(`image ${i}: puzzle not unique`);

    const font = fonts[(i - 1) % fonts.length];
    const spec = boardSpec(r, grid, font, Math.round(uniform(r, 380, 720)));
    const img = await renderer.board(spec);

    const name = `synth-${String(i).padStart(4, "0")}-clean`;
    const truth: Truth = {
      image: `${name}.jpg`,
      width: img.width,
      height: img.height,
      grid,
      solution,
      corners: boardCorners(spec),
      seed,
      tags: ["clean"],
      render: { ...spec.style, size: spec.size, margin: spec.margin },
    };
    writeFileSync(join(out, truth.image), await renderer.jpeg(img, 0.92));
    writeFileSync(join(out, `${name}.json`), JSON.stringify(truth) + "\n");
  }
  console.log(`wrote ${count} images to ${out}`);
} finally {
  await renderer.close();
}
