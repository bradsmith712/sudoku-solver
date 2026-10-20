# SPEC: Sudoku Photo Solver

## Goal

A web app that runs entirely in the browser. The user takes or uploads a photo of a sudoku puzzle, and the app reads the grid, lets them fix any misread digits, solves it, and shows the solution overlaid on the puzzle. No backend, no API keys, no per-request cost. Hosted free at a public URL, installable on a phone as a PWA.

## Design

Visual reference for the UI: `docs/mockups.png`. Layout and flow should follow it; where it conflicts with the written requirements in this file, this file wins.

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
  confidence: number[][];          // 9x9, 0-1 per cell
  warped: ImageData;               // top-down 450x450 board image
  homography?: number[];           // optional, for projecting the solution back onto the photo
};
solve(grid: Grid): { status: "solved" | "invalid" | "unsolvable" | "multiple"; solution?: Grid }
scan(image: ImageData): Promise<ScanResult>   // throws ScanError("no_board_found") if detection fails
```

Modules are independent and communicate only through these types: `src/solver`, `src/vision`, `src/ui`.

## Features

1. **Solver:** constraint propagation plus backtracking. Detects invalid input (duplicate in a row, column, or box), unsolvable puzzles, and puzzles with multiple solutions (stop counting at 2).
2. **Manual entry:** a 9x9 editable grid works without any camera or vision code.
3. **Board detection:** find the largest quadrilateral contour, order its corners, apply a perspective transform to a square board image.
4. **Cell extraction:** split the warped board into 81 cells, strip grid lines, and decide blank vs. digit before classification.
5. **Digit recognition:** classify each non-blank cell with the ONNX model, returning a digit and a confidence.
6. **Review screen:** show the recognized grid, highlight low-confidence cells (below 0.9), and let the user tap to correct before solving.
7. **Solution view:** original givens in one color, solved digits in another, drawn over the warped board. Stretch: project onto the original photo using the inverse homography.
8. **Camera input:** a file input with `accept="image/*"` and `capture="environment"` to open the phone camera. Resize large images to a max of about 1024px before processing.
9. **PWA:** web manifest, icons, service worker with offline caching of the app shell and model.
10. **Errors:** friendly messages for no board found, invalid grid after scan, and unsolvable puzzle, each with a retry path.

## Performance and size

- Scan to review screen in under 3 seconds on a mid-range phone for a 1024px image.
- Lazy-load OpenCV.js and the model only when the user first scans. The manual-entry path must work instantly.
- Self-host OpenCV.js and the model file (no runtime dependency on a third-party CDN).
- Solving any valid puzzle takes under 100 ms.

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
- Step-by-step hint mode that explains the next logical move.
