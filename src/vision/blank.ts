/**
 * Blank vs. digit for a cell crop from cells.ts. Crops are already divided by the
 * local paper brightness, so one fixed cut-off works across shadows and dim photos.
 *
 * Constants were set on the synthetic set and the owner's split=train photos only:
 * at INK_RATIO, the largest ink blob in the centre was at most 7 px in any blank cell
 * (synthetic noise) and at least 39 px in any digit. Faint show-through from the
 * other side of the page stayed above 0.9 (book-529), well clear of INK_RATIO.
 */
import { CELL_SIZE, type Cell } from "./cells";

/** A pixel is ink when darker than this fraction of the local paper brightness. */
export const INK_RATIO = 0.8;
/** Smallest 4-connected ink blob in the centre region that counts as a digit. */
export const MIN_BLOB = 20;
/** The centre region: the middle half of the crop on each axis. */
const LO = CELL_SIZE / 4;
const HI = (CELL_SIZE * 3) / 4;

const isInk = (cell: Cell, x: number, y: number) => cell.pixels[y * CELL_SIZE + x] < INK_RATIO;

/** Fraction of the centre region that is ink (reported in debug output). */
export function inkFraction(cell: Cell): number {
  let n = 0;
  for (let y = LO; y < HI; y++) for (let x = LO; x < HI; x++) if (isInk(cell, x, y)) n++;
  return n / ((HI - LO) * (HI - LO));
}

/**
 * Size in pixels of the largest 4-connected ink blob inside the centre region. A
 * printed digit is one solid stroke through the centre; noise, paper texture and
 * stray specks are many tiny blobs, so a blob size rejects them where a raw ink
 * count would add them up.
 */
export function largestInkBlob(cell: Cell): number {
  const w = HI - LO;
  const seen = new Uint8Array(w * w);
  let best = 0;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !isInk(cell, LO + (start % w), LO + Math.floor(start / w))) continue;
    seen[start] = 1;
    const stack = [start];
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = Math.floor(i / w);
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        const j = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= w || seen[j]) continue;
        if (!isInk(cell, LO + nx, LO + ny)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    best = Math.max(best, size);
  }
  return best;
}

/** Whether the cell holds a digit (true) or is blank (false). */
export function isDigit(cell: Cell): boolean {
  return largestInkBlob(cell) >= MIN_BLOB;
}

/**
 * Largest blob size (px) at or below which a blank cell is fully certain. Set on the
 * synthetic set and split=train photos: true blanks had blobs of at most 7 px, so none
 * fall under the 0.9 review threshold, while a blank whose blob is over 12 px (close
 * to a faint or broken digit) does.
 */
export const BLANK_SURE = MIN_BLOB / 2;
/** Confidence of a blank cell whose largest blob is just under MIN_BLOB. */
export const BLANK_FLOOR = 0.5;

/**
 * Confidence (0-1) that a cell isDigit() calls blank is really blank, from the ink
 * rule's margin rather than the digit model: 1 while the largest centre ink blob is
 * at most BLANK_SURE, falling linearly to BLANK_FLOOR as it nears MIN_BLOB. Same
 * scale and 0.9 review threshold as digit confidence (SPEC.md, review screen).
 */
export function blankConfidence(cell: Cell): number {
  const blob = largestInkBlob(cell);
  if (blob <= BLANK_SURE) return 1;
  const t = Math.min(1, (blob - BLANK_SURE) / (MIN_BLOB - BLANK_SURE));
  return 1 - t * (1 - BLANK_FLOOR);
}
