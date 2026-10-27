import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { generateSteps } from "../../src/solver/steps";

type Fixture = { grid: number[][]; solution: number[][] };
const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(new URL(`../fixtures/solver/${name}.json`, import.meta.url), "utf8"));

const EASY = fixture("easy-01");
const EASY_STEPS = generateSteps(EASY.grid);
const M = EASY_STEPS.length;

const mainCell = (page: Page, i: number) => page.locator(".workspace .cell").nth(i);
const stepCells = (page: Page) => page.locator(".steps .cell");
const count = (page: Page) => page.getByTestId("step-count");

async function enter(page: Page, grid: number[][]) {
  for (let i = 0; i < 81; i++) {
    const d = grid[Math.floor(i / 9)][i % 9];
    if (!d) continue;
    await mainCell(page, i).click();
    await page.keyboard.press(String(d));
  }
}

async function readSteps(page: Page): Promise<number[][]> {
  const texts = await stepCells(page).allTextContents();
  return Array.from({ length: 9 }, (_, r) =>
    texts.slice(r * 9, r * 9 + 9).map((t) => Number(t || 0)),
  );
}

async function solveAndOpenSteps(page: Page, grid: number[][]) {
  await enter(page, grid);
  await page.getByRole("button", { name: "Solve", exact: true }).click();
  await expect(page.getByTestId("title")).toHaveText("Puzzle solved!");
  await page.getByRole("button", { name: "View solving steps" }).click();
  await expect(page.getByTestId("title")).toHaveText("Solving steps");
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Or enter manually" }).click();
});

test("step through a solved puzzle, jump from the log, and end on the solution", async ({
  page,
}) => {
  await solveAndOpenSteps(page, EASY.grid);

  // Step 1: the explanation from the engine, announced politely, target highlighted.
  await expect(count(page)).toHaveText(`Step 1 of ${M}`);
  const explanation = page.getByTestId("step-explanation");
  await expect(explanation).toHaveAttribute("aria-live", "polite");
  await expect(explanation).toHaveText(EASY_STEPS[0].explanation);
  const p1 = EASY_STEPS[0].placements[0];
  const target = stepCells(page).nth(p1.row * 9 + p1.col);
  await expect(target).toHaveText(String(p1.digit));
  await expect(target).toHaveClass(/focus/);
  await expect(target).toHaveClass(/solved/);
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

  // Next / Previous and the arrow keys.
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(count(page)).toHaveText(`Step 2 of ${M}`);
  await expect(explanation).toHaveText(EASY_STEPS[1].explanation);
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(count(page)).toHaveText(`Step 1 of ${M}`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(count(page)).toHaveText(`Step 3 of ${M}`);
  await page.keyboard.press("ArrowLeft");
  await expect(count(page)).toHaveText(`Step 2 of ${M}`);

  // Jump from the activity log to a middle step: the board shows exactly that many placements.
  const log = page.getByTestId("step-log");
  await log.getByRole("button").nth(9).click();
  await expect(count(page)).toHaveText(`Step 10 of ${M}`);
  await expect(log.getByRole("button").nth(9)).toHaveAttribute("aria-current", "step");
  const givens = EASY.grid.flat().filter(Boolean).length;
  const filled = (await readSteps(page)).flat().filter(Boolean).length;
  expect(filled).toBe(givens + 10);

  // Jump to the last step: the board is the solution.
  await log.getByRole("button").last().click();
  await expect(count(page)).toHaveText(`Step ${M} of ${M}`);
  expect(await readSteps(page)).toEqual(EASY.solution);

  // Next on the last step goes back to the Solved screen.
  await page.getByRole("button", { name: "Back to solution" }).click();
  await expect(page.getByTestId("title")).toHaveText("Puzzle solved!");

  // Solve another goes home and resets cleanly; a new puzzle's steps start from step 1.
  await page.getByRole("button", { name: "Solve another" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Every puzzle. Every step." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Or enter manually" }).click();
  await expect(page.getByTestId("title")).toHaveText("Enter your puzzle");
  await expect(page.getByTestId("message")).toHaveText("");
  expect((await page.locator(".workspace .cell").allTextContents()).every((t) => t === "")).toBe(
    true,
  );
  const next = fixture("easy-02");
  await solveAndOpenSteps(page, next.grid);
  await expect(count(page)).toHaveText(`Step 1 of ${generateSteps(next.grid).length}`);
});

test("trial-and-error steps are labelled as such", async ({ page }) => {
  const hard = fixture("hard-known-01");
  const steps = generateSteps(hard.grid);
  const k = steps.findIndex((s) => s.technique === "fallback");
  expect(k).toBeGreaterThanOrEqual(0);
  await solveAndOpenSteps(page, hard.grid);
  await page.getByTestId("step-log").getByRole("button").nth(k).click();
  await expect(page.getByTestId("step-badge")).toHaveText("Trial and error");
  await expect(page.getByTestId("step-explanation")).toHaveText(
    "No simple pattern applies here; this digit comes from trial and error.",
  );
  await page.keyboard.press("End");
  await expect(count(page)).toHaveText(`Step ${steps.length} of ${steps.length}`);
  expect(await readSteps(page)).toEqual(hard.solution);
});

test("Hint shows the next step for the current board without filling it in", async ({ page }) => {
  await enter(page, EASY.grid);
  await page.getByRole("button", { name: "Hint" }).click();
  const first = EASY_STEPS[0];
  const p = first.placements[0];
  const message = page.getByTestId("message");
  await expect(message).toHaveText(
    `Hint · ${first.title} at row ${p.row + 1}, column ${p.col + 1}: ${first.explanation}`,
  );
  const target = mainCell(page, p.row * 9 + p.col);
  await expect(target).toHaveClass(/selected/);
  await expect(target).toHaveText("");

  // Filling it in clears the hint; the next hint is for the new board.
  await page.keyboard.press(String(p.digit));
  await expect(message).toHaveText("");
  await page.getByRole("button", { name: "Hint" }).click();
  const after = EASY.grid.map((row) => [...row]);
  after[p.row][p.col] = p.digit;
  await expect(message).toContainText(generateSteps(after)[0].explanation);

  // A board that breaks the rules gets the usual message instead.
  await mainCell(page, 0).click();
  await page.keyboard.press(String(EASY.grid[0].find((d, c) => d && c > 0)));
  await page.getByRole("button", { name: "Hint" }).click();
  await expect(message).toContainText("repeated digit");
});

test("respects prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await solveAndOpenSteps(page, EASY.grid);
  const duration = await stepCells(page)
    .first()
    .evaluate((e) => getComputedStyle(e).transitionDuration);
  expect(duration).toBe("0s");
});

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

for (const vp of VIEWPORTS) {
  test(`solved and steps layout at ${vp.width}px (${vp.name})`, async ({ page }, info) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await enter(page, EASY.grid);
    await page.getByRole("button", { name: "Solve", exact: true }).click();
    await page.screenshot({ path: info.outputPath(`solved-${vp.width}.png`), fullPage: true });
    await page.getByRole("button", { name: "View solving steps" }).click();
    await page.getByTestId("step-log").getByRole("button").nth(11).click();
    // Let the highlight fade finish so the screenshot shows step 12, not a blend.
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`steps-${vp.width}.png`) });
    await page.screenshot({ path: info.outputPath(`steps-${vp.width}-full.png`), fullPage: true });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The controls stay on screen (sticky) while the page and the log scroll.
    const nav = page.getByRole("navigation", { name: "Step controls" });
    for (const y of [0, 400]) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      const box = (await nav.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
      expect(box.y).toBeGreaterThanOrEqual(0);
    }
    // The log scrolls inside itself and keeps the current step in view.
    const log = page.getByTestId("step-log");
    expect(await log.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    const inView = await log.evaluate((ol) => {
      const cur = ol.querySelector("[aria-current=step]") as HTMLElement;
      const [a, b] = [ol.getBoundingClientRect(), cur.getBoundingClientRect()];
      return b.top >= a.top && b.bottom <= a.bottom;
    });
    expect(inView).toBe(true);

    const board = (await page.locator(".steps .board").boundingBox())!;
    const card = (await page.locator(".step-card").boundingBox())!;
    if (vp.name === "desktop") expect(card.x).toBeGreaterThanOrEqual(board.x + board.width - 1);
    else expect(card.y).toBeGreaterThanOrEqual(board.y + board.height - 1);
    if (vp.name === "mobile") expect(board.width / 9).toBeGreaterThanOrEqual(36);
    const next = (await page.getByRole("button", { name: "Next step" }).boundingBox())!;
    expect(next.height).toBeGreaterThanOrEqual(44);
  });
}
