# SPEC: Sudoku Photo Solver

## Goal

A web app that runs entirely in the browser. The user takes or uploads a photo of a sudoku puzzle, and the app reads the grid, lets them fix any misread digits, solves it, and shows the solution overlaid on the puzzle. No backend, no API keys, no per-request cost. Hosted free at a public URL, installable on a phone as a PWA.

## Design

Visual reference for the UI: `docs/mockups.png` (desktop). Layout and flow should follow it; where it conflicts with the written requirements in this file, this file wins. Dedicated 390px mobile mockups for all eight screens are owner-supplied (`docs/mockups-mobile.png`); until they exist, follow the rules below.

Style stays minimal. **Design mobile first:** scanning a physical puzzle is a primary feature, so the app should feel like a native camera-first app, not a desktop page squeezed into a narrow screen. Desktop layouts stay largely as in the current mockups.

### Screens

| Screen              | Mobile (under 640px)                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| 1. Homepage         | Single-column hero, smaller headline, prominent Scan button, Sudoku preview below |
| 2. Import           | Camera-first, with Upload and Manual Entry as secondary options                   |
| 3. Detection        | Full-width photo, draggable crop corners, adjustment controls below               |
| 4. Review & Correct | Large board with number keypad beneath it                                         |
| 5. Manual Entry     | Same board and keypad component as Review, optimized for touch                    |
| 6. Solving          | Board at top, compact progress indicator, expandable activity log                 |
| 7. Solved           | Completed board first, then View steps and Solve another                          |
| 8. Step-by-step     | Board above an explanation card, sticky Previous/Next controls                    |

Screens 7 and 8 and the activity log are built (feature 11). Screen 6 is not: solving takes milliseconds, so there is no progress to show, and the activity log lives on the step-by-step screen instead. Screens 2, 4, 5 and 8 need the most care for responsive behavior.

### Responsive breakpoints

| Viewport    | Layout                                               |
| ----------- | ---------------------------------------------------- |
| Under 640px | Mobile: single column, full-width board              |
| 640-1023px  | Tablet: larger board, optional side panels           |
| 1024px+     | Desktop: two-column layouts like the current mockups |

### Design rules

1. **Board first.** On mobile the 9x9 grid takes almost the full width (about 38px cells on a 390px phone after padding), with the custom 1-9 keypad beneath it. Desktop also supports direct keyboard entry.
2. **No system keyboard.** Tapping a cell must not open the OS keyboard; use the custom number pad. It is more predictable and avoids layout shift.
3. **Native-feeling camera.** Full-screen camera view, corner-detection overlay, large shutter button, easy switch to the photo library. After capture, advance automatically to the detection preview. The file input in feature 8 remains the baseline and fallback.
4. **Thumb-friendly learning controls.** Explanations sit below the grid, and Previous/Next stay anchored to the bottom.
5. **One shared `SudokuGrid` component** with a `mode` prop (editable, highlight, read-only, steps) reused for detection, editing, solving, results and explanations. The steps mode marks a step's target and pattern cells, its row, column or box, the cells losing candidates and the new digit; the target's candidates are shown in the explanation card, not as pencil marks on the board.

**Contract impact:** draggable crop corners need the detected corners exposed before warping, and a manual re-warp from user-adjusted corners. `scan()` and `ScanResult` as written do not provide this. Adding it means changing `src/types.ts`, so it requires updating this file and every module that uses the types, and telling the owner first.

## Non-goals

- No accounts, database, or server code.
- No handwriting recognition in v1 (printed puzzles only).
- No variants (killer, samurai, etc.).
- No paid APIs. Claude or other LLM vision is out of scope for the default pipeline.

## Stack

- TypeScript, Vite, plain DOM or a light framework (Preact or vanilla; keep the bundle small)
- OpenCV.js for board detection and perspective correction
- A small digit classifier (CNN) exported to ONNX and run with onnxruntime-web
- Vitest for unit tests, Playwright for end-to-end tests
- ESLint and Prettier; `tsc --noEmit` for type checks
- Hosting: GitHub Pages via GitHub Actions (alternatives: Cloudflare Pages, Netlify)
- Offline tooling (not shipped): Python script that generates synthetic training digits from fonts, trains the classifier with PyTorch, and exports ONNX

## Shared contract

```ts
type Grid = number[][];            // 9x9, 0 = blank, 1-9 = digit
type ScanResult = {
  grid: Grid;
  confidence: number[][];          // 9x9, 0-1 per cell (digit: temperature-scaled model softmax; blank: ink-rule margin)
  warped: ImageData;               // top-down 450x450 board image
  homography?: number[];           // optional, for projecting the solution back onto the photo
  second?: Grid;                   // optional, runner-up digit per digit cell; 0 on blanks
  margin?: number[][];             // optional, calibrated top-1 minus top-2 probability; 1 on blanks
};
solve(grid: Grid): { status: "solved" | "invalid" | "unsolvable" | "multiple"; solution?: Grid }
scan(image: ImageData): Promise<ScanResult>   // throws ScanError("no_board_found") if detection fails
```

Modules are independent and communicate only through these types: `src/solver`, `src/vision`, `src/ui`.

## Features

1. **Solver:** constraint propagation plus backtracking. Detects invalid input (duplicate in a row, column, or box), unsolvable puzzles, and puzzles with multiple solutions (stop counting at 2).
2. **Manual entry:** a 9x9 editable grid works without any camera or vision code.
3. **Board detection:** find the largest quadrilateral contour, order its corners, apply a perspective transform to a square board image. **Orientation:** `scan` takes an image already turned upright per its EXIF orientation (browsers and the test decoder apply it when decoding). The warped board can still be sideways or upside down, and puzzles are 180-degree symmetric, so `scan` reads the board at all four quarter turns with one model session and keeps the turn whose grid has no repeated digit, then the highest mean confidence over digit cells. `homography` maps the photo onto the returned, upright `warped` board.
4. **Cell extraction:** split the warped board into 81 cells, strip grid lines, and decide blank vs. digit before classification.
5. **Digit recognition:** classify each non-blank cell with the ONNX model, returning a digit and a confidence, plus the runner-up digit and the top-two margin (`second`, `margin`). Confidence is calibrated by temperature scaling: softmax(logits / T), with T fitted on the held-out-font validation set (`tools/train/calibrate.ts`, stored in `src/vision/model/calibration.json`), never on photos. Scaling does not change which digit wins.
6. **Review screen:** show the recognized grid, highlight low-confidence cells (below 0.9), and let the user tap to correct before solving. Blank and digit cells share the same 0-1 confidence scale and 0.9 threshold, but the values come from different places: a digit's confidence is the CNN's calibrated softmax probability for the chosen digit; a blank's comes from the blank-vs-digit ink rule (how far the largest ink blob in the cell centre is below the digit threshold), not from the CNN, which only sees cells already judged to hold a digit. Treat both the same on the review screen.
7. **Solution view:** original givens in one color, solved digits in another, drawn over the warped board. Stretch: project onto the original photo using the inverse homography.
8. **Camera input:** a file input with `accept="image/*"` and `capture="environment"` to open the phone camera. Resize large images to a max of about 1024px before processing. A full-screen live camera view (see Design rules) is an enhancement on top of this and must fall back to the file input when camera access is unavailable or denied.
9. **PWA:** web manifest, icons, service worker with offline caching of the app shell and model.
10. **Errors:** friendly messages for no board found, invalid grid after scan, and unsolvable puzzle, each with a retry path. A scan too wrong to review cell by cell (8 or more conflicting cells that repair cannot fix, or mean digit confidence under 0.8, usually a board detected out of position) gets "couldn't read this, try again" instead of the review screen, with a "Review anyway" option. Cut-offs set on synthetic and split=train data only (`src/ui/retake.ts`).
11. **Step-by-step explanations:** `generateSteps(grid)` (`src/solver/steps.ts`, pure) returns the moves from the givens to the unique solution, always the simplest available, in this order: naked single, hidden single, pointing / box-line claim, naked pair, hidden pair. Each step lists its placement or candidate eliminations, the cells and units to highlight, and an explanation built from the board at that moment. When none applies, the step is labelled trial and error ("No simple pattern applies here; this digit comes from trial and error.") and places the solver's digit for the most constrained cell; it never gives an invented reason. Output is deterministic. Manual and scanned solves both open the Solved screen (View solving steps, Edit puzzle, Solve another); the step-by-step screen shows the board above the explanation card, the activity log (tap a step to jump to it) and sticky Previous/Next, with arrow keys, `aria-live="polite"` explanations and reduced motion respected. It is bundled with the app shell so it works offline. Throws for grids without exactly one solution.

## Performance and size

- Scan to review screen in under 3 seconds on a mid-range phone for a 1024px image.
- Lazy-load OpenCV.js and the model only when the user first scans. The manual-entry path must work instantly. Loading starts when the user taps Scan or Upload, so it overlaps taking or picking the photo.
- Self-host OpenCV.js and the model file (no runtime dependency on a third-party CDN).
- Solving any valid puzzle takes under 100 ms; so does `generateSteps`.

## Done criteria (all must pass)

- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all succeed.
- Solver passes a fixture set of at least 50 puzzles (easy through hard, plus invalid, unsolvable, and multi-solution cases).
- Vision accuracy on the synthetic test set (at least 200 generated images with perspective, rotation, blur, noise, and lighting variation): at least 98% of cells correct and at least 90% of full boards read perfectly.
- Vision accuracy on at least 10 real photos of printed puzzles supplied by the owner: at least 90% of cells correct on clean photos.
- Playwright end-to-end test: upload a fixture photo, review screen appears, solve, solution grid is valid.
- Deployed at a public HTTPS URL, installable as a PWA, and verified on a real phone with a real puzzle.
- README with a demo GIF, architecture diagram, accuracy table, and the "why client-side" reasoning.

## Risks and decisions

- **Misread digits are the main failure.** The review screen and confidence highlighting are mandatory, not optional.
- **OpenCV.js is large.** Lazy loading and caching keep first paint fast.
- **Real photos vs. synthetic data.** The model is trained on synthetic digits; measure on real photos early (Phase 5) and add augmentation or real samples if accuracy lags.
- **Multiple fonts and newspaper-style puzzles** vary a lot. Start with clean printed puzzles and expand.

## Stretch goals

- Overlay the solution on the original photo with the homography.
- Handwritten digits (train on a handwriting set and compare).
- Optional Claude vision fallback behind a rate-limited proxy, with an accuracy comparison in the README. Not part of the default build.
- Step-by-step hint mode that explains the next logical move (screens 6 to 8 in Design: activity log, solved view with View steps, step-by-step with explanation card and sticky Previous/Next). Done: see feature 11.
