import { expect, test, type Page } from "@playwright/test";

const PUZZLE = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";

const cell = (page: Page, i: number) => page.locator(".cell").nth(i);

async function enter(page: Page, puzzle: string) {
  for (let i = 0; i < 81; i++) {
    const ch = puzzle[i];
    if (ch === "0" || ch === ".") continue;
    await cell(page, i).click();
    await page.keyboard.press(ch);
  }
}

async function readGrid(page: Page): Promise<number[][]> {
  const texts = await page.locator(".cell").allTextContents();
  return Array.from({ length: 9 }, (_, r) =>
    texts.slice(r * 9, r * 9 + 9).map((t) => Number(t || 0)),
  );
}

function isValid(g: number[][]): boolean {
  const ok = (xs: number[]) => [...xs].sort().join("") === "123456789";
  for (let i = 0; i < 9; i++) {
    const [bi, bj] = [Math.floor(i / 3) * 3, (i % 3) * 3];
    const box = [0, 1, 2].flatMap((a) => [0, 1, 2].map((b) => g[bi + a][bj + b]));
    if (!ok(g[i]) || !ok(g.map((r) => r[i])) || !ok(box)) return false;
  }
  return true;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("enter a puzzle by keyboard, solve, and the displayed solution is valid", async ({ page }) => {
  await enter(page, PUZZLE);
  await page.getByRole("button", { name: "Solve" }).click();

  await expect(page.getByTestId("message")).toHaveText("Solved!");
  const grid = await readGrid(page);
  expect(isValid(grid)).toBe(true);
  for (let i = 0; i < 81; i++) {
    if (PUZZLE[i] !== "0") expect(grid[Math.floor(i / 9)][i % 9]).toBe(Number(PUZZLE[i]));
  }

  // Givens and solved digits use different colors.
  const given = await cell(page, 0).evaluate((e) => getComputedStyle(e).color);
  const solved = await cell(page, 2).evaluate((e) => getComputedStyle(e).color);
  expect(given).not.toBe(solved);
  await expect(cell(page, 0)).toHaveClass(/given/);
  await expect(cell(page, 2)).toHaveClass(/solved/);
});

test("tap input with the number pad", async ({ page }) => {
  await cell(page, 4).click();
  await page.getByRole("button", { name: "Enter 7" }).click();
  await expect(cell(page, 4)).toHaveText("7");
  await page.getByRole("button", { name: "Erase" }).click();
  await expect(cell(page, 4)).toHaveText("");
});

test("clear resets the grid and message", async ({ page }) => {
  await enter(page, PUZZLE);
  await page.getByRole("button", { name: "Solve" }).click();
  await page.getByRole("button", { name: "Clear" }).click();
  expect((await readGrid(page)).flat().every((v) => v === 0)).toBe(true);
  await expect(page.getByTestId("message")).toHaveText("");
});

test("editing after solving drops the solution", async ({ page }) => {
  await enter(page, PUZZLE);
  await page.getByRole("button", { name: "Solve" }).click();
  await cell(page, 0).click();
  await page.keyboard.press("Backspace");
  await expect(page.locator(".cell.solved")).toHaveCount(0);
  await expect(page.getByTestId("message")).toHaveText("");
});

test("invalid grid shows a message and highlights conflicts", async ({ page }) => {
  await cell(page, 0).click();
  await page.keyboard.press("5");
  await cell(page, 1).click();
  await page.keyboard.press("5");
  await page.getByRole("button", { name: "Solve" }).click();
  await expect(page.getByTestId("message")).toContainText("repeated digit");
  await expect(page.locator(".cell.conflict")).toHaveCount(2);
});

test("unsolvable grid shows a message", async ({ page }) => {
  // Row 1 holds 1-8, and a 9 in column 9 leaves the last cell of row 1 with no candidate.
  for (let c = 0; c < 8; c++) {
    await cell(page, c).click();
    await page.keyboard.press(String(c + 1));
  }
  await cell(page, 17).click();
  await page.keyboard.press("9");
  await page.getByRole("button", { name: "Solve" }).click();
  await expect(page.getByTestId("message")).toContainText("No solution");
});

test("multiple-solution grid shows a message and no solution", async ({ page }) => {
  await cell(page, 0).click();
  await page.keyboard.press("1");
  await page.getByRole("button", { name: "Solve" }).click();
  await expect(page.getByTestId("message")).toContainText("more than one solution");
  await expect(page.locator(".cell.solved")).toHaveCount(0);
});

test.describe("phone layout", () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

  test("fits the viewport with usable tap targets", async ({ page }, info) => {
    await enter(page, PUZZLE);
    await page.getByRole("button", { name: "Solve" }).click();
    await page.screenshot({ path: info.outputPath("phone-375.png"), fullPage: true });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const board = await page.locator(".board").boundingBox();
    expect(board).not.toBeNull();
    expect(board!.width).toBeLessThanOrEqual(375);
    expect(board!.width / 9).toBeGreaterThanOrEqual(30);
    const btn = await page.getByRole("button", { name: "Solve" }).boundingBox();
    expect(btn!.height).toBeGreaterThanOrEqual(44);
  });
});
