# Sudoku Photo Solver

Point your phone at a printed sudoku and get the solved grid. Everything runs in your browser: there's no server, no account, no API key, and nothing to pay per scan. You can install it to your home screen as an app, and it works offline.

**Live:** https://bradsmith712.github.io/sudoku-solver/

## What it does

1. **Scan or upload a photo.** The camera opens through a file input (`capture="environment"`). Photos are resized to at most 1024 px.
2. **Find the board.** The app straightens it into a top-down 450x450 image. It doesn't matter whether the photo is sideways or upside down.
3. **Read all 81 cells.** Each cell is either blank or a printed digit 1-9, and each reading comes with a confidence.
4. **Review.** You check the recognised grid. Doubtful cells are highlighted, and you fix them with an on-screen number pad.
5. **Solve.** The solution is drawn over your photo.

You can also type a puzzle in by hand. Manual entry never loads any of the vision code.

## Architecture

```
 photo (File)
   │  src/ui/photo.ts        decode with EXIF orientation, resize to ≤ 1024 px
   ▼
 ImageData ──► scan(image): Promise<ScanResult>                  src/vision (lazy chunk)
   │            detect.ts     grayscale, blur, adaptive threshold, largest
   │                          quadrilateral with a 3x3 box grid inside it
   │            warp.ts       perspective transform to 450x450
   │            cells.ts      trace each grid line locally (handles bowed pages),
   │                          crop 81 cells to 32x32
   │            blank.ts      blank vs. digit by ink blob size
   │            recognize.ts  small CNN (ONNX, 361 KB) on the digit cells,
   │                          temperature-scaled confidence, runner-up digit
   │            scan.ts       read all 4 quarter turns, keep the valid,
   │                          most confident one
   ▼
 ScanResult { grid, confidence, warped, second, margin }
   │  src/solver/repair.ts   fix confident misreads (see below)
   │  src/ui/retake.ts       too wrong to review? ask for another photo
   ▼
 review screen (src/ui) ──► solve(grid) ──► solution drawn over the warped board
                            src/solver: constraint propagation + backtracking,
                            reports invalid / unsolvable / multiple (stops at 2)
```

- **Three modules.** `src/solver` (pure logic), `src/vision` (OpenCV.js and onnxruntime-web) and `src/ui` (DOM and PWA) only talk to each other through the `Grid` and `ScanResult` types in `src/types.ts`. The contract is in [SPEC.md](SPEC.md).
- **Lazy loading.**
  - First paint is about 25 KB: 18 KB of JS and 6 KB of CSS, 9 KB gzipped.
  - OpenCV.js (10.8 MB, 3.5 MB gzipped), the onnxruntime wasm (14.2 MB) and the model only start downloading when you tap Scan or Upload. The download overlaps with taking or choosing the photo.
  - Everything is self-hosted; there are no CDNs or third-party requests.
- **Single-threaded ML.** GitHub Pages can't send cross-origin isolation headers, so onnxruntime-web runs with one thread. The model is small enough that reading one orientation takes about 50 ms.
- **Offline tooling, never shipped:**
  - `tools/synth` renders labelled synthetic photos with perspective, blur, noise, lighting and clutter.
  - `tools/train/train.py` trains the digit CNN on digits rendered from system fonts.
  - `tools/train/calibrate.ts` fits the softmax temperature on held-out fonts.

## Offline behaviour

A service worker (`public/sw.js`, filled in at build time by the `swPrecache` plugin in `vite.config.ts`) handles offline use.

**On the first visit**

- Only the app shell is cached: the HTML, entry JS and CSS, the manifest and the icons.
- After that, the app opens and manual entry works with no connection.

**Scanning**

- The vision files (OpenCV.js, the onnxruntime wasm and the model) are cached the first time you scan, not up front. If you only ever type puzzles in, you never download the ~8 MB.
- Each file is stored only after its full body matches the SHA-256 recorded at build time. A cut-off download is never kept.
- Scanning only counts as available offline once every file is cached and verified. One complete online scan is enough.
- If you're offline before that, tapping Scan or Upload shows **"Connect once to enable offline scanning"** instead of opening the camera. Manual entry still works.

**Updates**

- Cache names carry a content hash (`sudoku-shell-<hash>`, `sudoku-assets-<hash>`). When a new version activates, it deletes every old cache.
- The vision files have content-hashed names. A file that hasn't changed is carried over to the new cache instead of downloaded again, so an app-only update costs a few kilobytes.
- A new version takes over the next time you open the app.

**iOS Safari** can clear website data for sites you haven't added to your home screen. If offline scanning stops working there, scan once while online again. Installing the app to the home screen avoids this.

## Measured accuracy

Measured with `npm run eval:vision` on the shipped model. "Digit cells" counts only the cells with a printed digit, and "Perfect boards" means all 81 cells were read correctly.

| Set                                    | Size         | All cells             | Digit cells          | Perfect boards  |
| -------------------------------------- | ------------ | --------------------- | -------------------- | --------------- |
| Synthetic                              | 240 boards   | 99.8% (19399 / 19440) | 99.5% (7634 / 7675)  | 97.9% (235/240) |
| **Real photos, held out (split=test)** | **7 photos** | **100% (567 / 567)**  | **100% (199 / 199)** | **100% (7/7)**  |
| Real photos, split=train               | 10 photos    | 100% (810 / 810)      | 100% (301 / 301)     | 100% (10/10)    |

The SPEC targets are at least 98% of cells and 90% of boards on synthetic images, and at least 90% of cells on clean real photos.

**About the real set**

- It is small: 17 photos plus 1 negative case (a cut-off board that must report "no board found").
- All 17 photos are of one puzzle book, so they share one typeface and one kind of paper.
- They do cover a range of conditions: steep angles, curved pages, hard shadows, show-through from the other side of the page, and cluttered backgrounds.
- The headline real numbers are `split=test` only. Those photos were never used to tune a threshold, choose a model or pick a setting.
- 100% on 7 photos is not evidence that the app never misreads. Fresh photos with other print styles and glare are still to come.

## How it handles misreads

Misreads are the main way this app fails, so they are handled in several layers.

1. **Confidence highlight.** Cells with a calibrated confidence under 0.9 are outlined in amber on the review screen.
   - A digit's confidence is the CNN's temperature-scaled softmax.
   - A blank's confidence comes from how clearly the blank-vs-digit ink rule decided.
2. **Conflict marks.** Digits that repeat in a row, column or box are marked in red. On synthetic boards, conflicts catch more misreads than confidence does:

   | Flag                 | Misreads caught |
   | -------------------- | --------------- |
   | Confidence under 0.9 | 25 / 80         |
   | Conflicts            | 47 / 80         |
   | Either               | 50 / 80         |

3. **Automatic repair** (`src/solver/repair.ts`). If the scanned grid is invalid, unsolvable or has several solutions, the app tries swapping up to 3 of the least certain cells to their runner-up digit. It keeps a swap only if the result has exactly one solution.
   - Repaired cells are marked in purple and can be undone one at a time or all together.
   - End to end on synthetic photos, repair fixed the only board that had a single misread and never made a wrong repair.
4. **Retake guard** (`src/ui/retake.ts`). If 8 or more cells conflict and repair can't fix them, the board was usually found in the wrong place. The app then says "couldn't read this, try again" instead of showing a review screen full of wrong cells. "Review anyway" is still offered.
   - In the end-to-end run, 5 synthetic boards were sent back, none of which had been read perfectly. All 235 boards that reached review were correct after repair.

These cut-offs were set on synthetic and `split=train` data only. The real photos haven't produced a misread yet, so catch rates on real photos are still unmeasured.

## Why client-side

- **Cost.** The OCR is a 361 KB CNN and a ~10 MB computer-vision library running on the phone. Hosting is a static site on GitHub Pages, so there's no inference server, no GPU and no per-scan bill.
- **Privacy.** Photos never leave the device, because there is no server to send them to.
- **Latency and offline use.** Scan to review takes about 1 s on a 4x-throttled desktop CPU, standing in for a mid-range phone. Once the files are cached, scanning works on a plane.
- **Fit for the problem.** Printed digits on a known 9x9 grid are a narrow task. Classical geometry (OpenCV) plus a tiny classifier is enough, and a review screen covers the rest. A cloud vision model would add cost, a dependency and a privacy question without fixing the real failure, which is confident misreads.
- **The trade-off.** The first scan downloads about 8 MB, and onnxruntime runs single-threaded on hosts without cross-origin isolation. Both are measured; see `tests/e2e/perf.spec.ts`.

## Run and test

```sh
npm install            # also enables the pre-commit hook (.githooks/pre-commit)
npm run dev            # Vite dev server (no service worker in dev)
npm run check          # lint, typecheck, unit tests, build: run before every commit
npm run test:e2e       # Playwright against the production build under /sudoku-solver/
npm run test:live      # PWA and timing specs against the deployed site (LIVE_URL to override)
npm run eval:vision    # accuracy report on the synthetic and real sets
```

The real-photo fixtures (`tests/fixtures/real/`) are copyrighted puzzles kept out of git, so tests that need them skip without them. A sample of 20 synthetic images is committed; `tools/synth/README.md` explains how to regenerate the full set.

Deployment: every push to `main` runs `.github/workflows/deploy.yml`. It deploys to GitHub Pages only if `npm run check` and the full e2e suite pass on the subpath build.
