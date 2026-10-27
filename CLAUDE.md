# sudokulens (Sudoku Photo Solver)

Client-side web app: photo of a sudoku in, solved grid out. Full requirements are in `SPEC.md`. Work items are in `TASKS.md`.

## Commands

- `npm run dev`: start Vite dev server
- `npm test`: Vitest unit tests
- `npm run test:fast`: the fast unit tests (what the pre-commit hook runs)
- `npm run test:e2e`: Playwright end-to-end tests
- `npm run test:live`: PWA and perf specs against the deployed site (`LIVE_URL` to override)
- `npm run lint`: ESLint and Prettier check
- `npm run typecheck`: `tsc --noEmit`
- `npm run build`: production build
- `npm run check`: lint, typecheck, test, and build together (run this before every commit)
- `npm run eval:vision`: print vision accuracy on the synthetic test set
- `python tools/train/train.py`: regenerate and train the digit model (offline only)

## Architecture

- `src/solver`: pure logic, no DOM, no OpenCV
- `src/vision`: OpenCV.js and ONNX code, depends only on the `Grid` and `ScanResult` types in `src/types.ts`
- `src/ui`: DOM and PWA code, calls `scan()` and `solve()` through the contract in `SPEC.md`
- `tests/fixtures`: puzzle fixtures and test images
- `tools`: offline scripts (image generator, model training); never imported by `src`

## Rules

- Never commit with failing checks. Run `npm run check` first. Gate the commit on the check's exit code: `npm run check && git commit ...`, never `;`, an `echo`/`grep`, or a background run between them. A check that fails under load is a failure until it passes on a rerun. Commits also go through `.githooks/pre-commit` (lint, typecheck, `npm run test:fast`; enabled by `npm install`); never bypass it with `--no-verify`.
- After any change to code, run the relevant tests and fix failures before stopping.
- Do not change the types in `src/types.ts` without updating `SPEC.md` and every module that uses them.
- Keep `src/solver` free of browser APIs so it stays fast to test.
- Scripts that load OpenCV.js must run under vitest or the require-based loader (`src/vision/__fixtures__/node-opencv.ts`); they hang under vite-node.
- Use OpenCV.js `Mat` objects carefully: always `.delete()` them to avoid memory leaks. Use a try/finally.
- Do not add runtime network calls, third-party CDNs, analytics, or API keys.
- Do not add dependencies without a reason; mention each new one in the commit message. Watch bundle size.
- Lazy-load OpenCV.js and the ONNX model; manual entry must not depend on them.
- Prefer small commits, one task per commit, message format `phase-task: summary`.
- For visual or camera work, verify in a browser (screenshot or Playwright), not just unit tests.
- Ask before deleting files outside the task, rewriting history, or changing the deploy config.

## Design reference

- `docs/mockups.png` is the desktop visual reference for the UI; `docs/mockups-mobile.png` (390px, owner-supplied) is the mobile one. Look at them before any UI work and note deviations in the commit message.
- Design mobile first (breakpoints: under 640px mobile, 640-1023px tablet, 1024px+ desktop). Full rules are in the Design section of `SPEC.md`.
- Cells are not text inputs: never open the system keyboard on tap; use the custom 1-9 number pad.
- Reuse one shared `SudokuGrid` component with a `mode` prop for every screen that shows a board; do not fork the grid per screen.
- UI work is not done until verified at a 390px viewport in Playwright (screenshot), plus the other breakpoints when layout changes.

## Conventions

- TypeScript strict mode, no `any` without a comment explaining why.
- Pure functions where possible; side effects live at the edges.
- Test file next to the code it tests (`solver.ts`, `solver.test.ts`) except fixtures and e2e.
- Name test fixtures descriptively (`easy-01.json`, `skewed-30deg.png`).

## Plans

- Before coding, list the files you'll touch, the commands that verify each task, and anything you need from me (photos, decisions).
- Never use split=test photos to tune, select, or set thresholds.
- Flag any change to src/types.ts or SPEC.md thresholds in the plan.
- Say what could make the plan fail and what you'd do then.

## When you make the same mistake twice

Add a line to this file or propose a hook or skill so it does not happen a third time.
