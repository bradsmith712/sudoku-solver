# Real-photo fixtures (Big Book of Sudoku)

19 photos: 17 gradeable boards in `tests/fixtures/real/`, 1 in `pending/` (retake), 1 in `negative/` (expected failure).

## Install

From the repo root:

1. Unzip this into the repo root (merges into `tests/fixtures/real/`).
2. `./place-photos.sh /path/to/your/IMG_folder` copies each photo next to its JSON, renamed `book-###.jpg`.
3. Add `tests/fixtures/real/` to `.gitignore`. The puzzles are copyrighted, so keep the photos and JSON local.

## JSON fields

- `grid`: 9x9, 0 = blank. Printed givens only.
- `puzzleId`: photos of the same puzzle share it. Keep them in the same split.
- `split`: suggested `test` or `train`. Never train on `test`.
- `tags`: conditions, for per-condition accuracy in the README.
- `expect`: `"no_board_found"` on negative cases (no `grid`).

## Folders

- `pending/book-213`: blurry shot whose right border is cut off by the frame. Retake it with the full board in view; the same grid applies. The blur test is invalid until then.
- `negative/book-229`: board cut off on the left. Correct output is the "no board found" error, not a grid.

## How the grids were checked

Each grid has no row/column/box duplicates, exactly one solution (checked with a backtracking solver), and a 180-degree-symmetric givens pattern. A misread digit would almost always break one of these. Still re-run each through your Phase 1 solver, and spot-check a couple against the photos.

## Assumption to confirm

Photos were matched to puzzles using the puzzle number printed on each page and the order the files were uploaded. Open two or three renamed photos and confirm the number in the title matches the filename.
