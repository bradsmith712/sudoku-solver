# Synthetic sudoku photos

Offline generator for the vision test set (Phase 3). It renders printed puzzles and turns them into phone-photo-like JPEGs, each with a ground-truth JSON file. Nothing here is imported by `src`.

## Regenerate

```sh
npx vite-node tools/synth/generate.ts            # 240 images, ~80 s, ~29 MB
npx vite-node tools/synth/list-pairs.ts          # list image / ground-truth pairs
```

This writes `tests/fixtures/synthetic/synth-NNNN-<tags>.jpg` and `.json`. It also copies the first 20 pairs into `tests/fixtures/synthetic/sample/`. Only `sample/` is committed; the rest is git-ignored. Old `synth-*` files in both directories are replaced on each run.

Options:

| Flag       | Default                    | Meaning                                         |
| ---------- | -------------------------- | ----------------------------------------------- |
| `--count`  | `240`                      | Number of images (the spec needs at least 200)  |
| `--sample` | `20`                       | How many of the first images to copy to sample/ |
| `--seed`   | `3`                        | Base seed; image `i` uses its own seeded PRNG   |
| `--out`    | `tests/fixtures/synthetic` | Output directory                                |

Requirements: `npm install` and the Playwright Chromium (`npx playwright install chromium`), which the e2e tests use already. There are no other dependencies.

**Reproducibility.** Puzzles, labels and all augmentation parameters depend only on the seed. Image `i` is the same whatever `--count` is. On the same machine, reruns are byte-identical. Pixels also depend on which fonts are installed, so on another OS the fonts (and therefore the images) differ. The generator prints the fonts it found and fails if fewer than 4 are available. On Linux, install `fonts-dejavu` and `fonts-liberation`.

## What it generates

1. **Puzzle**: a random unique puzzle with 24-40 givens (`tools/lib/puzzles.ts`, checked with the solver).
2. **Print** (`render.ts`, drawn by headless Chromium in `browser.ts`): fonts cycle through every available family in `FONT_CANDIDATES`, regular or bold. Digit size and per-cell jitter vary. Thin, thick and border line weights vary, sometimes with gray thin lines. Ink and paper tint (white or newsprint) vary, and some boards use newspaper-style shaded boxes. Some boards have a header or footer printed in the paper margin.
3. **Photo** (`augment.ts`, pure TypeScript on RGBA buffers):
   - `rot`: in-plane rotation of 3-30 degrees
   - `persp`: camera tilt of 8-38 degrees through a pinhole model (keystone), applied with a homography warp
   - `light`: directional falloff, exposure, warm or cool tint, optional soft shadow
   - `blur`: Gaussian, sigma 0.7-2
   - `noise`: Gaussian sensor noise, sigma 4-14
   - `clutter`: 5-16 objects on the surface (stray text with digits, shapes, pen strokes)

   Each augmentation is switched on independently, and every non-clean image gets at least one. Images 1, 21, 41, ... are `clean`, as a baseline. All images are 720-1024 px on the long side, on wood, desk, mat or fabric surfaces, with JPEG quality 0.72-0.95.

The file name lists the tags that were applied, e.g. `synth-0013-persp-noise-clutter.jpg`.

## Ground-truth JSON

See `truth.ts` for the type.

```jsonc
{
  "image": "synth-0001-clean.jpg",
  "width": 960, "height": 720,
  "grid": [[2,0,1, ...], ...],        // printed givens, 0 = blank
  "solution": [[2,3,1, ...], ...],    // unique solution
  "corners": [[x,y], [x,y], [x,y], [x,y]], // board outer edge: TL, TR, BR, BL, image px
  "seed": 300010,
  "tags": ["clean"],
  "render": { "font": "Helvetica", "thin": 1.4, "thick": 4.2, ... },
  "augment": { "pose": { "rotationDeg": 0, "tiltXDeg": 0, ... }, "blurSigma": 0, ... }
}
```

The board corners are verified against the camera model on every run. Use them to score board detection (Phase 4).

Real photos in `tests/fixtures/real/` use the same pairing (`<name>.jpg` + `<name>.json`); only `grid` is required there. `listPairs()` in `pairs.ts` returns the pairs for any directory and throws on unpaired files. `tests/fixtures/image-fixtures.test.ts` validates the sample, the full set when it has been generated, and any real photos.
