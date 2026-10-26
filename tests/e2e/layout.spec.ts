import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// SPEC.md Design: single column under 640px, larger board at 640-1023px, two columns
// from 1024px. Screenshots land in test-results/ for a visual check.
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, columns: 1 },
  { name: "tablet", width: 768, height: 1024, columns: 1 },
  { name: "desktop", width: 1280, height: 800, columns: 2 },
];

for (const vp of VIEWPORTS) {
  test(`manual entry layout at ${vp.width}px (${vp.name})`, async ({ page }, info) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("./");
    await page.screenshot({ path: info.outputPath(`manual-${vp.width}.png`), fullPage: true });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const board = (await page.locator(".board").boundingBox())!;
    const pad = (await page.getByRole("group", { name: "Number pad" }).boundingBox())!;
    if (vp.columns === 1) {
      expect(pad.y).toBeGreaterThanOrEqual(board.y + board.height - 1);
    } else {
      expect(pad.x).toBeGreaterThanOrEqual(board.x + board.width - 1);
    }
    if (vp.name === "mobile") {
      // About 38px cells on a 390px phone (Design rule 1).
      expect(board.width / 9).toBeGreaterThanOrEqual(36);
    }
    if (vp.name === "tablet") expect(board.width).toBeGreaterThan(440);
  });
}

const REPAIR = fileURLToPath(new URL("../fixtures/e2e/synth-repair.jpg", import.meta.url));

for (const vp of VIEWPORTS) {
  test(`review and solved layout at ${vp.width}px (${vp.name})`, async ({ page }, info) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("./");
    await page.getByTestId("upload-input").setInputFiles(REPAIR);
    await expect(page.getByTestId("title")).toHaveText("Review the recognized puzzle", {
      timeout: 60_000,
    });
    await page.locator(".cell.changed").first().click();
    await page.screenshot({ path: info.outputPath(`review-${vp.width}.png`), fullPage: true });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const board = (await page.locator(".board").boundingBox())!;
    const pad = (await page.getByRole("group", { name: "Number pad" }).boundingBox())!;
    if (vp.columns === 1) expect(pad.y).toBeGreaterThanOrEqual(board.y + board.height - 1);
    else expect(pad.x).toBeGreaterThanOrEqual(board.x + board.width - 1);

    await page.getByRole("button", { name: "Solve puzzle" }).click();
    await expect(page.getByTestId("title")).toHaveText("Puzzle solved!");
    await page.screenshot({ path: info.outputPath(`solved-${vp.width}.png`), fullPage: true });
  });
}
