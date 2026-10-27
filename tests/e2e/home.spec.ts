import { expect, test, type Page } from "@playwright/test";

// The home screen (docs/mockups-home.png): headline, one animated example board, and
// Scan / Upload / Or enter manually. Screenshots land in test-results/ for a visual check.
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

const heading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Every puzzle. Every step." });
const hero = (page: Page) => page.locator(".hero");
const heroCells = (page: Page) => page.locator(".hero .cell");

for (const vp of VIEWPORTS) {
  test(`home layout at ${vp.width}px (${vp.name})`, async ({ page }, info) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("./");
    await expect(heading(page)).toBeVisible();
    await page.screenshot({ path: info.outputPath(`home-${vp.width}.png`), fullPage: true });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // All three ways in are on screen without scrolling.
    for (const name of ["Scan a puzzle", "Upload image", "Or enter manually"]) {
      const box = (await page.getByRole("button", { name }).boundingBox())!;
      expect(box.y + box.height, name).toBeLessThanOrEqual(vp.height);
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole("button", { name: "Back" })).toBeHidden();

    const board = (await page.locator(".hero .board").boundingBox())!;
    const copy = (await heading(page).boundingBox())!;
    if (vp.name === "desktop") expect(board.x).toBeGreaterThanOrEqual(copy.x + copy.width);
    else expect(board.y).toBeGreaterThanOrEqual(copy.y + copy.height);
  });
}

test("the example board is decorative and its caption names the three stages", async ({ page }) => {
  await page.goto("./");
  await expect(heroCells(page)).toHaveCount(81);
  await expect(page.getByRole("group", { name: "Example puzzle" })).toHaveCount(0);
  await expect(page.locator(".hero figcaption li")).toHaveText([
    /Your puzzle/,
    /We solve it/,
    /Explore the steps/,
  ]);
});

test("the example board animates on home and stops when you leave", async ({ page }) => {
  await page.goto("./");
  await expect(hero(page)).toHaveAttribute("data-phase", "photo");
  await expect(hero(page)).toHaveAttribute("data-phase", "solve", { timeout: 4000 });
  await expect(hero(page)).toHaveAttribute("data-phase", "explore", { timeout: 6000 });
  expect((await heroCells(page).allTextContents()).every((t) => t !== "")).toBe(true);

  await page.getByRole("button", { name: "Or enter manually" }).click();
  const phase = await hero(page).getAttribute("data-phase");
  await page.waitForTimeout(4000);
  await expect(hero(page)).toHaveAttribute("data-phase", phase!);
});

test("enter manually and back again", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Or enter manually" }).click();
  await expect(page.getByTestId("title")).toHaveText("Enter your puzzle");
  await expect(heading(page)).toBeHidden();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(heading(page)).toBeVisible();
  await expect(hero(page)).toHaveAttribute("data-phase", "photo");
});

test("under reduced motion the example board shows the solution, still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await expect(hero(page)).toHaveAttribute("data-phase", "still");
  expect((await heroCells(page).allTextContents()).every((t) => t !== "")).toBe(true);
  await page.waitForTimeout(2500);
  await expect(hero(page)).toHaveAttribute("data-phase", "still");
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
