# Sudoku Photo Solver

Client-side web app: photo of a sudoku in, solved grid out. Full requirements are in `SPEC.md`. Work items are in `TASKS.md`.

## Commands

- `npm run dev`: start Vite dev server
- `npm test`: Vitest unit tests
- `npm run test:e2e`: Playwright end-to-end tests
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

- Never commit with failing checks. Run `npm run check` first.
- After any change to code, run the relevant tests and fix failures before stopping.
- Do not change the types in `src/types.ts` without updating `SPEC.md` and every module that uses them.
- Keep `src/solver` free of browser APIs so it stays fast to test.
- Use OpenCV.js `Mat` objects carefully: always `.delete()` them to avoid memory leaks. Use a try/finally.
- Do not add runtime network calls, third-party CDNs, analytics, or API keys.
- Do not add dependencies without a reason; mention each new one in the commit message. Watch bundle size.
- Lazy-load OpenCV.js and the ONNX model; manual entry must not depend on them.
- Prefer small commits, one task per commit, message format `phase-task: summary`.
- For visual or camera work, verify in a browser (screenshot or Playwright), not just unit tests.
- Ask before deleting files outside the task, rewriting history, or changing the deploy config.

## Design reference

- `docs/mockups.png` is the visual reference for the UI. Look at it before any UI work (Phase 2 and Phase 6) and note deviations in the commit message.

## Conventions

- TypeScript strict mode, no `any` without a comment explaining why.
- Pure functions where possible; side effects live at the edges.
- Test file next to the code it tests (`solver.ts`, `solver.test.ts`) except fixtures and e2e.
- Name test fixtures descriptively (`easy-01.json`, `skewed-30deg.png`).

## When you make the same mistake twice

Add a line to this file or propose a hook or skill so it does not happen a third time.
