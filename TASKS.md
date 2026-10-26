# TASKS

Work top to bottom, one task at a time. For each task: implement, run `npm run check`, commit, tick the box, move on. If a task is blocked, note why under it and continue with the next unblocked one. Every phase ends with something that runs.

## Phase 0: Setup and feedback loops

- [x] Scaffold a Vite and TypeScript project with Vitest, Playwright, ESLint, and Prettier
- [x] Add scripts: `dev`, `test`, `test:e2e`, `lint`, `typecheck`, `build`, `check`
- [x] Create `src/types.ts` with the `Grid` and `ScanResult` types from `SPEC.md`
- [x] Add a GitHub Actions workflow that runs `npm run check` on every push
- [x] Add a Claude Code PostToolUse hook that runs the formatter after file edits, and a Stop hook that runs `npm test` (`.claude/settings.json`)
- [x] Create a read-only `reviewer` subagent (`.claude/agents/reviewer.md`) with a checklist: correctness, tests, memory leaks, bundle size, spec drift

Done when: `npm run check` passes on an empty project and CI is green.

## Phase 1: Solver (pure logic)

- [x] Implement `solve(grid)` with constraint propagation and backtracking
- [x] Detect invalid grids (duplicates in a row, column, or box)
- [x] Detect unsolvable puzzles and puzzles with multiple solutions (stop at 2)
- [x] Build at least 50 fixtures: easy, medium, hard, invalid, unsolvable, multi-solution
- [x] Add a property check: every returned solution has valid rows, columns, and boxes and preserves the givens
- [x] Benchmark: the hardest fixture solves in under 100 ms

Done when: all solver tests pass and the benchmark is met.

## Phase 2: Manual-entry UI

- [x] Build a 9x9 editable grid with keyboard and tap input, mobile-friendly
- [x] Add Solve and Clear buttons, displaying solved digits in a different color from givens
- [x] Show clear messages for invalid, unsolvable, and multiple-solution results
- [x] Add a Playwright test: enter a puzzle, solve, verify the displayed solution is valid
- [x] Screenshot the app at phone width and fix any layout issues

Done when: a puzzle can be entered and solved entirely by hand in the browser.

## Phase 3: Synthetic test image generator (tools, offline)

- [x] Write a script that renders a puzzle grid image using multiple fonts and line weights
- [x] Add augmentations: perspective warp, rotation, blur, noise, uneven lighting, background clutter
- [x] Generate at least 200 labeled images into `tests/fixtures/synthetic/` with ground-truth grids as JSON
- [x] Commit a small sample (about 20) and ignore the rest in git; document how to regenerate
- [x] Add 10 or more real photos of printed puzzles supplied by the owner to `tests/fixtures/real/` with ground-truth JSON
- [x] Owner: supply 390px mobile mockups for all eight screens as `docs/mockups-mobile.png`, with extra attention to screens 2, 4, 5 and 8 (needed before Phase 6)

Done when: the fixture set exists and a script can list image and ground-truth pairs.

## Phase 4: Board detection

- [x] Load OpenCV.js lazily and verify it initializes in the browser and in tests
- [x] Implement preprocessing: grayscale, blur, adaptive threshold
- [x] Find the largest quadrilateral contour and order its four corners
- [x] Apply a perspective transform to a 450x450 top-down board image
- [x] Throw `ScanError("no_board_found")` when no valid board is detected
- [x] Test: on the synthetic set, at least 95% of boards are detected and aligned; save debug output images for failures
  - 239/240 on the full generated set, 20/20 on the committed sample. The one failure (synth-0118) has exact corners; the test's grid-line heuristic misreads its faint gray thin lines.
- [x] Verify all OpenCV `Mat` objects are deleted (no memory growth over 100 scans)
- [x] Detect boards on the real photos: every board in `tests/fixtures/real` found with grid lines within 15 px (a quarter cell), and `negative/book-229` throws `no_board_found`
  - Detection downscales to 1024 px, snaps hull fits to the border before scoring, and requires a weak box grid on every accepted board. Fixed OpenCV.js `clone()` sharing pixels, which let `solidBoardMask` fill in the caller's mask.
  - 17/17 found within 15 px; 14/17 within the strict 6 px. book-211, book-212 and book-512 (tag `curved-page`) bow 7-12 px, which a 4-corner warp cannot flatten; cell extraction handles it. The synthetic set keeps the 6 px, 95% bar. Real-photo pass/fail is cell accuracy in `eval:vision`.

Done when: warped boards look correct on the synthetic set and on the real photos.

## Phase 5: Cell extraction and digit recognition

- [x] Split the warped board into 81 cells, crop margins to remove grid lines
  - Find each cell's boundaries locally (e.g., the grid line positions near the expected 50 px spacing) rather than assuming a flat 50 px grid, so bowed pages work (`curved-page` photos are off by up to 12 px)
  - `src/vision/cells.ts`: lighting flattened by a grey-level closing; each grid line traced band by band (dynamic programming, within 15 px of flat and 5 px per band); crops inset 15% and resampled to 32x32. Follows a 12 px synthetic bow within 3 px; checked visually on book-211 and book-212.
- [x] Implement blank vs. digit detection (e.g., ink fraction in the center region)
  - `src/vision/blank.ts`: a digit is a 4-connected ink blob of at least 20 px in the crop's centre, ink being darker than 0.8 of the local paper (lighting already divided out). Set on synthetic + split=train only. Show-through (book-509, book-529) stays blank.
  - Blank/digit accuracy (`src/vision/cells.fixtures.test.ts`): synthetic 19440/19440 cells (full set) and 1620/1620 (sample); real 1377/1377 (test 567/567, train 810/810, `curved-page` 243/243, `shadow-hard` 243/243). With EXIF applied, every real board warps upright.
- [x] Write `tools/train/train.py`: generate digit crops from fonts with augmentation, train a small CNN, export `model.onnx`
  - 48 upright faces from 15 families (Helvetica/Arial-like sans first) for training, 4 families held out for validation; preprocessing matches `cells.ts` (`cells.parity.test.ts`). First model: synthetic only, 361 KB, 99.15% on held-out fonts.
- [x] Integrate onnxruntime-web, loading the model lazily; return digit and confidence per cell
  - `recognizeBoard(warped)` in `src/vision/recognize.ts`: the session is created once and reused (Phase 6 can call it per orientation); wasm (14.2 MB, 3.7 MB gzip) and model are self-hosted Vite assets, no CDN; tests run the same package and model under Node 18. Blank-cell confidence comes from the ink rule (`blankConfidence`), documented in SPEC.md. Checked in headless Chromium: correct digits, one model load, only same-origin requests.
- [x] Add `npm run eval:vision` reporting cell accuracy and full-board accuracy on synthetic and real sets, with real results per split and per tag (`tally()` in `src/vision/__fixtures__/real.ts`); headline real numbers come from `split=test` only
  - `src/vision/vision.eval.test.ts`: (1) all cells, (2) printed-digit cells, (3) perfect boards per set, split and tag; true blanks under 0.9 per board; share of missed digits under 0.9; top-10 confusions; `test-results/vision-eval/report.json`; fails on a missed SPEC target. `EVAL_SPLITS=train` keeps test photos out while tuning.
- [x] Iterate on augmentation or model until targets are met: at least 98% cell accuracy (synthetic), at least 90% (real clean photos)
  - v1 (synthetic fonts only): synthetic 99.5% cells / 92.5% boards, real train 100%; 47 of 97 synthetic errors were American Typewriter's flat-topped 3 read as 5, and errors grew with digit size. v2 adds 7 common print families (American Typewriter, Rockwell, Palatino, Menlo, Didot, Baskerville, Optima), digit height 40-80% of the cell and more bold strokes. Chosen on synthetic + split=train only; no real crops needed.
  - Final (`npm run eval:vision`), as (1) all cells / (2) printed-digit cells / (3) perfect boards: synthetic 99.8% / 99.5% / 97.9% (240 boards); real train 100% / 100% / 100% (10); real test 100% / 100% / 100% (7). True blanks under 0.9: 0 per board. Only 7 of 41 synthetic misreads fall under 0.9, so the review screen would flag few of them.
- [x] Check model size and keep it small (target under 1 MB)
  - 361 KB (`src/vision/model/model.onnx`); `train.py` refuses to export 1 MB or more.

Done when: `eval:vision` meets the thresholds in `SPEC.md`.

## Phase 6: Integration and review screen

- [x] Before building screens, check `docs/mockups.png` and the owner's 390px mobile mockups (`docs/mockups-mobile.png`) if present; follow the Design section of `SPEC.md`
- [x] Refactor the Phase 2 grid into a shared `SudokuGrid` component with a `mode` prop (editable, highlight, read-only); reuse it for review, manual entry and the solution view; keep the Phase 2 e2e tests passing
- [x] Add responsive layout: single column under 640px, larger board at 640-1023px, two columns from 1024px; verify with Playwright screenshots at 390px, 768px and 1280px
- [x] Implement `scan(image)` combining detection, extraction, and recognition into a `ScanResult`
  - `src/vision/scan.ts`; `scanDetailed` also returns the chosen turn, each turn's score and per-stage timings for the eval. EXIF stays with the decoder (browser, `readJpeg`).
- [x] Resolve board orientation: run recognition at all 4 rotations of the warped board and choose the one that gives a valid grid with the highest confidence. Puzzles are 180-degree symmetric, so the blank pattern cannot decide it (book-211 and book-212 warp out rotated 90 degrees)
  - All four quarter turns are read with one ONNX session (`scan.test.ts` checks one load). Correct on the three test samples and on all 10 split=train photos at every photo rotation. With EXIF applied, book-211 and book-212 already warp upright; the rotation tests turn the photos to exercise this.
- [x] Calibrate digit confidence: temperature scaling fitted on the held-out-font validation set; return the runner-up digit and top-two margin (optional `second` and `margin` in `ScanResult`)
  - T = 1.62 (`src/vision/model/calibration.json`). Validation ECE 0.0049 -> 0.0043. Synthetic boards (labelled-corner warps): ECE 0.0046 -> 0.0029, misreads under 0.9 7/41 -> 15/41, correct cells under 0.9 0.05 -> 0.17 per board. Informational: a margin flag with the same 57-cell budget also catches 15/41.
- [x] Repair confident misreads: if the scanned grid is invalid, unsolvable or has several solutions, swap the lowest-margin digit cells (up to 3 at a time) to their runner-up digit and accept only a unique solution (`src/solver/repair.ts`); `findConflicts` moved to `src/solver/conflicts.ts`
  - Pool of 10, checked on synthetic + split=train only (any pool from 2 to 20 gave the same result there). End to end at 1024 px, 6 of 250 boards are misread, all invalid; repair fixes the one with a single misread (synth-0103, 3 read as 4) and makes no wrong repair. The other five have 6 to 45 misreads each, beyond three swaps.
- [x] Add camera and upload input (`accept="image/*"` and `capture="environment"`), resizing to a max of about 1024px
  - `src/ui/photo.ts`: Scan opens a file input with `capture="environment"`, Upload a plain one; decoded through `<img>` so EXIF orientation applies (like `readJpeg` in tests), then drawn to a canvas at most 1024 px on its longer side. `src/ui/scanner.ts` lazy-loads the vision chunk, calls `scan()` and `repair()`, and records performance marks.
- [x] Build the review screen: show the recognized grid, highlight cells under 0.9 confidence, tap to edit
  - Review marks low confidence (amber, calibrated confidence under 0.9), repeated digits (red, `findConflicts`) and cells repair changed (purple outline and dot, with "Undo this cell" and "Undo all changes"); editing a cell clears its marks. "Show scanned photo" shows the warped board. Screenshots at 390, 768 and 1280 px in `tests/e2e/layout.spec.ts`.
- [x] Wire review to solve to solution view, with the solution drawn over the warped board
  - Solved digits are drawn in blue on the warped board image; the givens show through from the photo.
- [x] Add friendly error states and retry for no board found, invalid grid, and unsolvable puzzle
  - No board found: error card with Try another photo / Upload image / Enter manually. Scanner load failure: also Retry. Invalid, unsolvable and multiple-solution grids stay on review with a message and the cells highlighted, plus New photo.
- [x] Playwright test: upload a fixture photo, correct one cell, solve, assert the solution is valid
  - `tests/e2e/scan.spec.ts`: upload `synth-upright`, mistype then correct a cell, solve, valid solution keeping the givens, drawn over the photo; `synth-rot90`, `synth-rot180` and `synth-exif6` read upright; the EXIF photo is decoded at 1024x768 (EXIF applied, resized); a repaired cell is marked and can be undone; no-board errors offer retry and manual entry; one split=train real photo (skipped when `tests/fixtures/real` is absent).
- [x] Measure scan time; optimize until under 3 seconds on a mid-range phone for a 1024px image
  - Node, 1024 px (`npm run eval:vision`, end-to-end part), median/p95 ms: detect 135/234, warp 4/6, recognize 49/63 per turn (198/251 for all four), repair 0/1, total 339/468 (synthetic); real train total 427/528.
  - Chromium with 4x CPU throttling as the mid-range-phone stand-in (`tests/e2e/perf.spec.ts`), file chosen to review screen: warm 1.0-1.4 s; first scan through the Upload button 1.8 s, because tapping Scan or Upload now starts loading OpenCV.js and the model (`warmUp`) while the user picks a photo. A first scan with nothing preloaded takes 3.8 s, but every user path goes through that tap. Not yet measured on a real phone (Phase 7).

Done when: in a real browser, a photo uploaded or captured through the file input is scanned and auto-oriented, the review screen shows it with low-confidence, conflicting and repaired cells highlighted and editable, and Solve shows the solution over the warped board. The live camera view and corner adjustment are deferred to Stretch.

## Phase 7: PWA and deploy

- [x] Add a web manifest, icons, and a service worker that caches the app shell, OpenCV.js, and the model
  - App shell is precached. OpenCV.js and model entries are a TODO (`HEAVY` in `public/sw.js`) until Phases 4-5 fix their paths; until then they are cached on first use.
- [x] Verify installability and offline manual entry using Lighthouse or Playwright
  - Verified with an ad-hoc Playwright script (CDP `Page.getInstallabilityErrors` empty, SW controls page, offline reload then enter and solve at 390px). Not yet a committed e2e test.
- [x] Configure GitHub Pages deployment through Actions (correct `base` path in Vite config)
  - `.github/workflows/deploy.yml` deploys `main`; `BASE_PATH` comes from `actions/configure-pages`. Owner: set Settings > Pages > Source to "GitHub Actions".
- [ ] Deploy and verify the live URL with a browser check; confirm no console errors
- [ ] Test on a real phone with a real puzzle and note any failures as new tasks

Done when: the public HTTPS URL works on a phone and can be installed to the home screen.

## Phase 8: Polish for the resume

- [ ] Write the README: demo GIF, architecture diagram, accuracy table, "why client-side" explanation, how to run and test
- [ ] Add a short "what I learned about agentic workflows" section: your skills, hooks, subagents, and intervention count
- [ ] Add a skill (`.claude/skills/`) such as "add-fixture-and-evaluate" that adds a new test image and reports accuracy
- [ ] Final reviewer-subagent pass over the whole repo; fix findings

## Stretch

- [ ] Project the solution onto the original photo with the inverse homography
- [ ] Camera-first import screen: full-screen camera view with corner overlay and large shutter button, switch to photo library, Manual Entry as a secondary option; advance automatically to detection after capture
  - Deferred from Phase 6: nicer UX only. The fallback is the file input with `capture="environment"` (built in Phase 6), which already opens the phone camera.
- [ ] Detection screen with draggable crop corners and adjustment controls
  - Deferred from Phase 6: needs an optional `corners?` field in `ScanResult` plus a `SPEC.md` update. Intended as the manual recovery path when detection returns `no_board_found`.
- [ ] Handwritten digit support with accuracy comparison
- [ ] Step-by-step hint mode with the solving activity log, Solved screen (View steps, Solve another) and a step-by-step screen: board above an explanation card, sticky Previous/Next controls
- [ ] Landing page with a single-column mobile hero, prominent Scan button and Sudoku preview
- [ ] Optional Claude vision fallback via a rate-limited proxy, compared against the local pipeline in the README

## Intervention log (fill in as you go)

Record each time you had to step in, the cause, and the fix (rule, hook, skill, or clearer spec). The count should fall over time.

| Date       | Task                   | What went wrong                                                                                                                                       | Fix                                                                                                                                            |
| ---------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-21 | Phase 4 detection test | Synthetic test failed (18/20, incl. a clean image): detector took the paper sheet's edge, inked by adaptive threshold on dark surfaces, for the board | Search nested contours, require a 3x3 box grid inside the quad, prefer a grid quad nested inside another; regression tests in `detect.test.ts` |
