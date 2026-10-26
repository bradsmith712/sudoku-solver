import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import jpeg from "jpeg-js";

const FIXTURES = fileURLToPath(new URL("../fixtures/e2e/", import.meta.url));
const REAL = fileURLToPath(new URL("../fixtures/real/", import.meta.url));
// First scan loads OpenCV.js, onnxruntime-web and the model.
const SCAN_TIMEOUT = 60_000;

type Truth = { grid: number[][] };
const truth = (name: string, dir = FIXTURES): Truth =>
  JSON.parse(readFileSync(`${dir}${name}.json`, "utf8")) as Truth;

const cell = (page: Page, r: number, c: number) => page.locator(".cell").nth(r * 9 + c);

async function readGrid(page: Page): Promise<number[][]> {
  const texts = await page.locator(".cell").allTextContents();
  return Array.from({ length: 9 }, (_, r) =>
    texts.slice(r * 9, r * 9 + 9).map((t) => Number(t || 0)),
  );
}

function isValidSolution(g: number[][]): boolean {
  const ok = (xs: number[]) => [...xs].sort().join("") === "123456789";
  for (let i = 0; i < 9; i++) {
    const [bi, bj] = [Math.floor(i / 3) * 3, (i % 3) * 3];
    const box = [0, 1, 2].flatMap((a) => [0, 1, 2].map((b) => g[bi + a][bj + b]));
    if (!ok(g[i]) || !ok(g.map((r) => r[i])) || !ok(box)) return false;
  }
  return true;
}

async function upload(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
) {
  await page.getByTestId("upload-input").setInputFiles(file);
}

async function expectReview(page: Page) {
  await expect(page.getByTestId("title")).toHaveText("Review the recognized puzzle", {
    timeout: SCAN_TIMEOUT,
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
});

test("upload a photo, correct a cell, solve, and the solution is valid", async ({ page }) => {
  const want = truth("synth-upright").grid;
  await upload(page, `${FIXTURES}synth-upright.jpg`);
  await expectReview(page);
  expect(await readGrid(page)).toEqual(want);

  // Correct one cell: the user mistypes a given, sees the conflict, then fixes it.
  const [r, c] = [0, want[0].findIndex((v) => v !== 0)];
  const right = want[r][c];
  const wrong = want[r].find((v) => v !== 0 && v !== right)!; // repeats in the row
  await cell(page, r, c).click();
  await page.getByRole("button", { name: `Enter ${wrong}` }).click();
  await expect(cell(page, r, c)).toHaveClass(/conflict/);
  await page.getByRole("button", { name: "Solve puzzle" }).click();
  await expect(page.getByTestId("message")).toContainText("repeated digit");
  await page.getByRole("button", { name: `Enter ${right}` }).click();
  await expect(page.locator(".cell.conflict")).toHaveCount(0);

  await page.getByRole("button", { name: "Solve puzzle" }).click();
  await expect(page.getByTestId("title")).toHaveText("Puzzle solved!");
  const solved = await readGrid(page);
  expect(isValidSolution(solved)).toBe(true);
  want.forEach((row, i) => row.forEach((v, j) => v && expect(solved[i][j]).toBe(v)));

  // Drawn over the warped photo: givens show through, solved digits in another colour.
  await expect(page.locator(".board")).toHaveClass(/on-photo/);
  const free = want.flat().findIndex((v) => v === 0);
  const solvedColor = await cell(page, Math.floor(free / 9), free % 9).evaluate(
    (e) => getComputedStyle(e).color,
  );
  const givenColor = await cell(page, r, c).evaluate((e) => getComputedStyle(e).color);
  expect(solvedColor).not.toBe(givenColor);

  await page.getByRole("button", { name: "Solve another" }).click();
  await expect(page.getByTestId("title")).toHaveText("Enter your puzzle");
});

for (const name of ["synth-rot90", "synth-rot180", "synth-exif6"]) {
  test(`reads ${name} upright`, async ({ page }) => {
    await upload(page, `${FIXTURES}${name}.jpg`);
    await expectReview(page);
    expect(await readGrid(page)).toEqual(truth(name).grid);
  });
}

test("a repaired cell is shown as changed and can be undone", async ({ page }) => {
  const want = truth("synth-repair").grid;
  await upload(page, `${FIXTURES}synth-repair.jpg`);
  await expectReview(page);
  // Repair already swapped the confident misread (a 3 read as 4) to the runner-up.
  expect(await readGrid(page)).toEqual(want);
  const changed = page.locator(".cell.changed");
  await expect(changed).toHaveCount(1);
  await expect(page.getByTestId("repairs")).toContainText("changed 1 cell");

  await changed.click();
  await page.getByRole("button", { name: /Undo this cell \(was 4\)/ }).click();
  await expect(page.locator(".cell.changed")).toHaveCount(0);
  await expect(page.locator(".cell.conflict").first()).toBeVisible(); // the misread repeats a 4
  await page.getByRole("button", { name: "Solve puzzle" }).click();
  await expect(page.getByTestId("message")).toContainText("repeated digit");

  // The user fixes it by hand instead.
  await page.getByRole("button", { name: "Enter 3" }).click();
  await page.getByRole("button", { name: "Solve puzzle" }).click();
  await expect(page.getByTestId("title")).toHaveText("Puzzle solved!");
  expect(isValidSolution(await readGrid(page))).toBe(true);
});

test("a large EXIF-rotated photo is decoded upright and resized to 1024 px", async ({ page }) => {
  // Stored as a 1440x1920 portrait with EXIF orientation 6, displayed as 1920x1440
  // landscape and scanned at 1024x768. Ignoring EXIF would give 768x1024.
  await upload(page, `${FIXTURES}synth-exif6.jpg`);
  await expectReview(page);
  const size = await page.evaluate(() => {
    const mark = performance.getEntriesByName("photo:decoded")[0] as PerformanceMark;
    return mark.detail as { width: number; height: number };
  });
  expect(size).toEqual({ width: 1024, height: 768 });
});

test("no board found shows a friendly error with retry paths", async ({ page }) => {
  const w = 320;
  const h = 240;
  const blank = jpeg.encode({ data: Buffer.alloc(w * h * 4, 225), width: w, height: h }, 90);
  await upload(page, { name: "blank.jpg", mimeType: "image/jpeg", buffer: blank.data });
  await expect(page.getByTestId("title")).toHaveText("We couldn't read that photo", {
    timeout: SCAN_TIMEOUT,
  });
  await expect(page.getByTestId("error-text")).toContainText("couldn't find a sudoku grid");
  await expect(page.getByRole("button", { name: "Try another photo" })).toBeVisible();

  // Retry with a good photo from the error screen.
  await page.getByTestId("upload-input").setInputFiles(`${FIXTURES}synth-upright.jpg`);
  await expectReview(page);
});

test("a scan too wrong to review asks for another photo, with review anyway", async ({ page }) => {
  // synth-0118: the board is detected out of position and most digits come out wrong.
  await upload(page, `${FIXTURES}synth-retake.jpg`);
  await expect(page.getByTestId("title")).toHaveText("We couldn't read that photo", {
    timeout: SCAN_TIMEOUT,
  });
  await expect(page.getByTestId("error-text")).toContainText("couldn't read this one");
  await expect(page.getByRole("button", { name: "Try another photo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeHidden();

  await page.getByRole("button", { name: "Review anyway" }).click();
  await expect(page.getByTestId("title")).toHaveText("Review the recognized puzzle");
  expect(await page.locator(".cell.conflict").count()).toBeGreaterThanOrEqual(8);
});

test("enter manually from the error screen", async ({ page }) => {
  const blank = jpeg.encode({ data: Buffer.alloc(200 * 200 * 4, 200), width: 200, height: 200 });
  await upload(page, { name: "blank.jpg", mimeType: "image/jpeg", buffer: blank.data });
  await page.getByRole("button", { name: "Enter manually" }).click({ timeout: SCAN_TIMEOUT });
  await expect(page.getByTestId("title")).toHaveText("Enter your puzzle");
  expect((await readGrid(page)).flat().every((v) => v === 0)).toBe(true);
});

// The owner's photos are local only (git-ignored); this is skipped when they are absent.
test.describe("real photo", () => {
  test.skip(!existsSync(`${REAL}book-234.jpg`), "tests/fixtures/real is not present");

  test("a split=train real photo scans and solves", async ({ page }) => {
    await upload(page, `${REAL}book-234.jpg`);
    await expectReview(page);
    expect(await readGrid(page)).toEqual(truth("book-234", REAL).grid);
    await page.getByRole("button", { name: "Solve puzzle" }).click();
    await expect(page.getByTestId("title")).toHaveText("Puzzle solved!");
    expect(isValidSolution(await readGrid(page))).toBe(true);
  });
});
