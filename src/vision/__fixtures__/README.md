# Vision test fixtures

`boards/` holds small hand-made board images (`<name>.jpg`) with ground truth
(`<name>.json`) in the same shape as the synthetic generator's records:
`image`, `width`, `height`, `grid`, and optional `corners` (board outer-border
corners TL, TR, BR, BL in image pixels) and `tags`.

- `opencv-*`: drawn with OpenCV and warped with a known perspective, plus lighting,
  noise, blur, clutter and thin-line variants. Regenerate with
  `npx vite-node src/vision/__fixtures__/make-fixtures.ts`.
- `browser-*`: rendered by Chromium with real fonts, CSS 3D transforms, newspaper text
  touching the board, drop shadows and JPEG compression. Regenerate with
  `npx vite-node src/vision/__fixtures__/make-browser-fixtures.ts`.

`src/vision/detect.fixtures.test.ts` checks detection and alignment on this set and,
when present, on `tests/fixtures/synthetic/` (or `$VISION_SYNTHETIC_DIR`) and
`tests/fixtures/real/`. Failures write overlay, binary and warped images to
`test-results/vision-debug/<set>/`; run with `VISION_DEBUG=all` to write them for
every image.
