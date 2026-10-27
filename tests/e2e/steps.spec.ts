import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { generateSteps, type Step } from "../../src/solver/steps";

type Fixture = { grid: number[][]; solution: number[][] };
const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(new URL(`../fixtures/solver/${name}.json`, import.meta.url), "utf8"));

const EASY = fixture("easy-01");
const EASY_STEPS = generateSteps(EASY.grid);
const M = EASY_STEPS.length;

const mainCell = (page: Page, i: number) => page.locator(".workspace .cell").nth(i);
const stepCells = (page: Page) => page.locator(".steps .cell");
const count = (page: Page) => page.getByTestId("step-count");
const log = (page: Page) => page.getByTestId("step-log");
const allSteps = (page: Page) => page.getByRole("button", { name: /^All steps/ });

/** Open the step list if it is a sheet (under 1024px); from 1024px it is always shown. */
async function openList(page: Page) {
  if (await allSteps(page).isVisible()) await allSteps(page).click();
  await expect(log(page)).toBeVisible();
}

/** Jump to step `k + 1` from the step list. */
async function jump(page: Page, k: number | "last") {
  await openList(page);
  const rows = log(page).getByRole("button");
  await (k === "last" ? rows.last() : rows.nth(k)).click();
}

/** The card leads with the step's conclusion, then lists its reasons. */
async function expectCard(page: Page, step: Step) {
  await expect(page.getByTestId("step-conclusion")).toHaveText(step.conclusion);
  await expect(page.getByTestId("step-reasons").getByRole("listitem")).toHaveText(step.reasons);
}

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

  // Step 1: the conclusion and reasons from the engine, announced politely, target highlighted.
  await expect(count(page)).toHaveText(`Step 1 of ${M}`);
  await expect(page.getByTestId("step-pct")).toHaveText(`${Math.round(100 / M)}% complete`);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  await expect(page.getByTestId("step-explanation")).toHaveAttribute("aria-live", "polite");
  await expectCard(page, EASY_STEPS[0]);
  const p1 = EASY_STEPS[0].placements[0];
  await expect(page.getByTestId("step-where")).toHaveText(
    `Row ${p1.row + 1}, Column ${p1.col + 1}`,
  );
  const answer = page.getByTestId("step-candidates").getByRole("listitem", { name: /answer/ });
  await expect(answer).toHaveText(String(p1.digit));
  const target = stepCells(page).nth(p1.row * 9 + p1.col);
  await expect(target).toHaveText(String(p1.digit));
  await expect(target).toHaveClass(/focus/);
  await expect(target).toHaveClass(/solved/);
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

  // Next / Previous and the arrow keys.
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(count(page)).toHaveText(`Step 2 of ${M}`);
  await expectCard(page, EASY_STEPS[1]);
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(count(page)).toHaveText(`Step 1 of ${M}`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(count(page)).toHaveText(`Step 3 of ${M}`);
  await page.keyboard.press("ArrowLeft");
  await expect(count(page)).toHaveText(`Step 2 of ${M}`);

  // Jump from the step list to a middle step: the board shows exactly that many placements.
  await jump(page, 9);
  await expect(count(page)).toHaveText(`Step 10 of ${M}`);
  await expect(page.getByTestId("step-pct")).toHaveText(`${Math.round(1000 / M)}% complete`);
  await expect(log(page).getByRole("button").nth(9)).toHaveAttribute("aria-current", "step");
  const givens = EASY.grid.flat().filter(Boolean).length;
  const filled = (await readSteps(page)).flat().filter(Boolean).length;
  expect(filled).toBe(givens + 10);

  // Jump to the last step: the board is the solution.
  await jump(page, "last");
  await expect(count(page)).toHaveText(`Step ${M} of ${M}`);
  await expect(page.getByTestId("step-pct")).toHaveText("100% complete");
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
  await jump(page, k);
  await expect(page.getByTestId("step-badge")).toHaveText("Trial and error");
  await expect(page.getByTestId("step-reasons")).toHaveText(
    "No simple pattern applies here; this digit comes from trial and error.",
  );
  await expectCard(page, steps[k]);
  await expect(log(page).getByRole("button").nth(k).locator(".tag")).toHaveText("Trial");
  await page.keyboard.press("End");
  await expect(count(page)).toHaveText(`Step ${steps.length} of ${steps.length}`);
  expect(await readSteps(page)).toEqual(hard.solution);
});

test("elimination steps lead with what they remove and mark the cells losing candidates", async ({
  page,
}) => {
  const hard = fixture("hard-01");
  const steps = generateSteps(hard.grid);
  const k = steps.findIndex((s) => s.technique === "pointing");
  expect(k).toBeGreaterThanOrEqual(0);
  await solveAndOpenSteps(page, hard.grid);
  await jump(page, k);
  await expectCard(page, steps[k]);
  await expect(page.getByTestId("step-candidates")).toBeHidden();
  for (const e of steps[k].eliminations)
    await expect(stepCells(page).nth(e.row * 9 + e.col)).toHaveClass(/elim/);
  await expect(log(page).getByRole("button").nth(k)).toContainText("remove");
});

test("the step list is a bottom sheet on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await solveAndOpenSteps(page, EASY.grid);
  const sheet = page.getByRole("dialog", { name: `All steps (${M})` });
  await expect(sheet).toBeHidden();

  // Opens on the current step; Escape closes it and gives focus back.
  await allSteps(page).click();
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  await expect(log(page).getByRole("button").first()).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Step controls" })).toHaveJSProperty(
    "inert",
    true,
  );
  // Arrow keys move through the list, not the steps.
  await page.keyboard.press("ArrowDown");
  await expect(log(page).getByRole("button").nth(1)).toBeFocused();
  await expect(count(page)).toHaveText(`Step 1 of ${M}`);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(allSteps(page)).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Step controls" })).toHaveJSProperty(
    "inert",
    false,
  );

  // The close button and the backdrop close it too.
  await allSteps(page).click();
  await page.getByRole("button", { name: "Close step list" }).click();
  await expect(sheet).toBeHidden();
  await allSteps(page).click();
  await page.getByTestId("sheet-backdrop").click({ position: { x: 20, y: 20 } });
  await expect(sheet).toBeHidden();

  // Picking a step jumps to it and closes the sheet; reopening centres that step.
  await jump(page, 4);
  await expect(count(page)).toHaveText(`Step 5 of ${M}`);
  await expect(sheet).toBeHidden();
  await allSteps(page).click();
  await expect(log(page).getByRole("button").nth(4)).toBeFocused();
  await expect(log(page).getByRole("button").nth(4)).toHaveAttribute("aria-current", "step");
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
    await jump(page, 11);
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
    // The step list scrolls inside itself and keeps the current step in view.
    await page.evaluate(() => window.scrollTo(0, 0));
    await openList(page);
    await page.waitForFunction(() => document.getAnimations().length === 0);
    if (vp.name !== "desktop")
      await page.screenshot({ path: info.outputPath(`steps-${vp.width}-sheet.png`) });
    expect(await log(page).evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    const inView = await log(page).evaluate((ol) => {
      const cur = ol.querySelector("[aria-current=step]") as HTMLElement;
      const [a, b] = [ol.getBoundingClientRect(), cur.getBoundingClientRect()];
      return b.top >= a.top && b.bottom <= a.bottom;
    });
    expect(inView).toBe(true);
    if (vp.name !== "desktop") await page.keyboard.press("Escape");

    const board = (await page.locator(".steps .board").boundingBox())!;
    const card = (await page.locator(".step-card").boundingBox())!;
    if (vp.name === "desktop") expect(card.x).toBeGreaterThanOrEqual(board.x + board.width - 1);
    else expect(card.y).toBeGreaterThanOrEqual(board.y + board.height - 1);
    if (vp.name === "mobile") expect(board.width / 9).toBeGreaterThanOrEqual(36);
    const next = (await page.getByRole("button", { name: "Next step" }).boundingBox())!;
    expect(next.height).toBeGreaterThanOrEqual(44);
  });
}
