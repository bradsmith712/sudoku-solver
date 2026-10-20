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

- [ ] Implement `solve(grid)` with constraint propagation and backtracking
- [ ] Detect invalid grids (duplicates in a row, column, or box)
- [ ] Detect unsolvable puzzles and puzzles with multiple solutions (stop at 2)
- [ ] Build at least 50 fixtures: easy, medium, hard, invalid, unsolvable, multi-solution
- [ ] Add a property check: every returned solution has valid rows, columns, and boxes and preserves the givens
- [ ] Benchmark: the hardest fixture solves in under 100 ms

Done when: all solver tests pass and the benchmark is met.

## Phase 2: Manual-entry UI

- [ ] Build a 9x9 editable grid with keyboard and tap input, mobile-friendly
- [ ] Add Solve and Clear buttons, displaying solved digits in a different color from givens
- [ ] Show clear messages for invalid, unsolvable, and multiple-solution results
- [ ] Add a Playwright test: enter a puzzle, solve, verify the displayed solution is valid
- [ ] Screenshot the app at phone width and fix any layout issues

Done when: a puzzle can be entered and solved entirely by hand in the browser.

## Phase 3: Synthetic test image generator (tools, offline)

- [ ] Write a script that renders a puzzle grid image using multiple fonts and line weights
- [ ] Add augmentations: perspective warp, rotation, blur, noise, uneven lighting, background clutter
- [ ] Generate at least 200 labeled images into `tests/fixtures/synthetic/` with ground-truth grids as JSON
- [ ] Commit a small sample (about 20) and ignore the rest in git; document how to regenerate
- [ ] Add 10 or more real photos of printed puzzles supplied by the owner to `tests/fixtures/real/` with ground-truth JSON

Done when: the fixture set exists and a script can list image and ground-truth pairs.

## Phase 4: Board detection

- [ ] Load OpenCV.js lazily and verify it initializes in the browser and in tests
- [ ] Implement preprocessing: grayscale, blur, adaptive threshold
- [ ] Find the largest quadrilateral contour and order its four corners
- [ ] Apply a perspective transform to a 450x450 top-down board image
- [ ] Throw `ScanError("no_board_found")` when no valid board is detected
- [ ] Test: on the synthetic set, at least 95% of boards are detected and aligned; save debug output images for failures
- [ ] Verify all OpenCV `Mat` objects are deleted (no memory growth over 100 scans)

Done when: warped boards look correct on the synthetic set and on the real photos.

## Phase 5: Cell extraction and digit recognition

- [ ] Split the warped board into 81 cells, crop margins to remove grid lines
- [ ] Implement blank vs. digit detection (e.g., ink fraction in the center region)
- [ ] Write `tools/train/train.py`: generate digit crops from fonts with augmentation, train a small CNN, export `model.onnx`
- [ ] Integrate onnxruntime-web, loading the model lazily; return digit and confidence per cell
- [ ] Add `npm run eval:vision` reporting cell accuracy and full-board accuracy on synthetic and real sets
- [ ] Iterate on augmentation or model until targets are met: at least 98% cell accuracy (synthetic), at least 90% (real clean photos)
- [ ] Check model size and keep it small (target under 1 MB)

Done when: `eval:vision` meets the thresholds in `SPEC.md`.

## Phase 6: Integration and review screen

- [ ] Implement `scan(image)` combining detection, extraction, and recognition into a `ScanResult`
- [ ] Add camera and upload input (`accept="image/*"` and `capture="environment"`), resizing to a max of about 1024px
- [ ] Build the review screen: show the recognized grid, highlight cells under 0.9 confidence, tap to edit
- [ ] Wire review to solve to solution view, with the solution drawn over the warped board
- [ ] Add friendly error states and retry for no board found, invalid grid, and unsolvable puzzle
- [ ] Playwright test: upload a fixture photo, correct one cell, solve, assert the solution is valid
- [ ] Measure scan time; optimize until under 3 seconds on a mid-range phone for a 1024px image

Done when: photo in, solved puzzle out works in a real browser from end to end.

## Phase 7: PWA and deploy

- [ ] Add a web manifest, icons, and a service worker that caches the app shell, OpenCV.js, and the model
- [ ] Verify installability and offline manual entry using Lighthouse or Playwright
- [ ] Configure GitHub Pages deployment through Actions (correct `base` path in Vite config)
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
- [ ] Handwritten digit support with accuracy comparison
- [ ] Step-by-step hint mode
- [ ] Optional Claude vision fallback via a rate-limited proxy, compared against the local pipeline in the README

## Intervention log (fill in as you go)

Record each time you had to step in, the cause, and the fix (rule, hook, skill, or clearer spec). The count should fall over time.

| Date | Task | What went wrong | Fix |
| ---- | ---- | --------------- | --- |
|      |      |                 |     |
