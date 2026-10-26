/**
 * SPEC.md: scan to review screen in under 3 seconds for a 1024 px image on a
 * mid-range phone. Stand-in: Chromium with CPU throttled 4x via CDP (and 1x for
 * reference). Cold = first scan after page load (includes loading and compiling
 * OpenCV.js, onnxruntime and the model from the local server), both with the file
 * handed straight to the input and through the Upload button, which starts loading
 * the vision code while the user picks a photo; warm = later scans. Network time is
 * not simulated. Writes test-results/perf/<rate>x.json.
 *
 * Gating: locally and in `npm run test:live`, warm and cold-via-Upload scans at 4x
 * must beat BUDGET_MS. GitHub runners are several times slower than the machine the
 * 4x stand-in was chosen on, so in CI the numbers go to the job summary and the test
 * fails only if the cold-via-Upload scan exceeds CI_COLD_LIMIT_MS or is more than
 * CI_MAX_REGRESSION times the previous successful run's (PERF_BASELINE, restored
 * by actions/cache in the workflows).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const PHOTO = fileURLToPath(new URL("../fixtures/e2e/synth-upright.jpg", import.meta.url));
const OUT = fileURLToPath(new URL("../../test-results/perf/", import.meta.url));
const BUDGET_MS = 3000;
const CI = Boolean(process.env.CI);
const CI_COLD_LIMIT_MS = 6000;
const CI_MAX_REGRESSION = 1.5;

/** Append markdown to the GitHub Actions job summary, when there is one. */
function summary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, markdown + "\n");
}

type Run = { toReview: number; stages: Record<string, number> };

/**
 * One scan; time runs from the file reaching the app to the review screen. With
 * `viaButton`, the user's path: tap Upload (which starts loading the vision code),
 * spend `pickMs` in the file picker, then choose the photo.
 */
async function scanOnce(page: Page, viaButton = false, pickMs = 0): Promise<Run> {
  await page.evaluate(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });
  if (viaButton) {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload image" }).click();
    await page.waitForTimeout(pickMs);
    const start = await page.evaluate(() => performance.now());
    await (await chooser).setFiles(PHOTO);
    return finish(page, start);
  }
  const start = await page.evaluate(() => performance.now());
  await page.getByTestId("upload-input").setInputFiles(PHOTO);
  return finish(page, start);
}

async function finish(page: Page, start: number): Promise<Run> {
  await expect(page.getByTestId("title")).toHaveText("Review the recognized puzzle", {
    timeout: 120_000,
  });
  return page.evaluate((t0) => {
    const shown = performance.getEntriesByName("review-shown")[0].startTime;
    const stages: Record<string, number> = {};
    for (const e of performance.getEntriesByType("measure"))
      stages[e.name] = Math.round(e.duration);
    return { toReview: Math.round(shown - t0), stages };
  }, start);
}

for (const rate of [1, 4]) {
  test(`scan to review at ${rate}x CPU throttling`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CPU throttling needs CDP");
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("./");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });

    const cold = await scanOnce(page);
    const warm = [await scanOnce(page), await scanOnce(page)];
    const best = warm.reduce((a, b) => (b.toReview < a.toReview ? b : a));

    // Cold again in a fresh page, the way a user gets there: tap Upload, take two
    // seconds to pick the photo (a camera shot takes longer), then choose it.
    const fresh = await page.context().newPage();
    await fresh.setViewportSize({ width: 390, height: 844 });
    await fresh.goto("./");
    await (
      await fresh.context().newCDPSession(fresh)
    ).send("Emulation.setCPUThrottlingRate", {
      rate,
    });
    const coldViaButton = await scanOnce(fresh, true, 2000);

    const report = { rate, budgetMs: BUDGET_MS, cold, coldViaButton, warm };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}${rate}x.json`, JSON.stringify(report, null, 1) + "\n");
    console.log(
      `[perf] ${rate}x CPU: cold ${cold.toReview} ms (via Upload after 2 s picking: ${coldViaButton.toReview} ms), ` +
        `warm ${warm.map((w) => w.toReview).join(" / ")} ms; ` +
        `warm stages ${JSON.stringify(best.stages)}`,
    );
    const baselineFile = process.env.PERF_BASELINE;
    const previous =
      rate === 4 && baselineFile && existsSync(baselineFile)
        ? (JSON.parse(readFileSync(baselineFile, "utf8")) as { coldViaButton: Run }).coldViaButton
        : undefined;
    summary(
      `### Scan timing, ${rate}x CPU throttling (informational)\n\n` +
        `| cold | cold via Upload | warm | previous cold via Upload |\n|---|---|---|---|\n` +
        `| ${cold.toReview} ms | ${coldViaButton.toReview} ms | ${warm.map((w) => w.toReview).join(" / ")} ms | ` +
        `${previous ? `${previous.toReview} ms` : "none"} |\n`,
    );
    if (CI) {
      // Readable as a check-run annotation without log access.
      console.log(
        `::notice title=perf ${rate}x::cold ${cold.toReview} ms, cold via Upload ${coldViaButton.toReview} ms, ` +
          `warm ${warm.map((w) => w.toReview).join(" / ")} ms, previous ${previous?.toReview ?? "none"}`,
      );
    }
    if (rate !== 4) return;
    if (!CI) {
      expect(best.toReview).toBeLessThan(BUDGET_MS);
      expect(coldViaButton.toReview).toBeLessThan(BUDGET_MS);
      return;
    }
    expect(coldViaButton.toReview, "CI cold scan limit").toBeLessThan(CI_COLD_LIMIT_MS);
    if (previous) {
      expect(
        coldViaButton.toReview,
        `CI cold scan regression vs previous run (${previous.toReview} ms)`,
      ).toBeLessThanOrEqual(previous.toReview * CI_MAX_REGRESSION);
    }
  });
}

/**
 * Network profiles for the first-visit measurement, applied with CDP (bits/s, ms).
 * PERF_NETWORKS=none,fast4g,slow4g picks them; the default measures without
 * throttling only. Numbers are this test's own, not DevTools presets.
 */
const NETWORKS: Record<string, { down: number; up: number; rtt: number } | null> = {
  none: null,
  fast4g: { down: 9_000_000, up: 1_500_000, rtt: 60 },
  slow4g: { down: 1_600_000, up: 750_000, rtt: 150 },
};

/**
 * First visit and repeat visit at 4x CPU, the user's path (tap Upload, 2 s picking,
 * choose the photo). First visit: a fresh profile with the service worker blocked so
 * the CDP network profile applies to every download (the worker's own requests are
 * not throttled); it reports tap-to-review too, since downloads can outlast the pick.
 * Repeat visit: a new page after one complete scan, every vision asset from the
 * worker's cache. Report only (test-results/perf/visits.json); no budget asserted.
 */
test("first visit and repeat visit at 4x CPU", async ({ browser, browserName, baseURL }) => {
  test.skip(browserName !== "chromium", "CPU and network throttling need CDP");
  test.setTimeout(600_000);
  const rate = 4;
  const profiles = (process.env.PERF_NETWORKS ?? "none").split(",");
  const report: Record<string, unknown> = { rate, baseURL };

  for (const name of profiles) {
    const net = NETWORKS[name];
    if (net === undefined) throw new Error(`unknown PERF_NETWORKS entry ${name}`);
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    if (net) {
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: net.rtt,
        downloadThroughput: net.down / 8,
        uploadThroughput: net.up / 8,
      });
    }
    await page.goto("./");
    const tap = await page.evaluate(() => performance.now());
    const run = await scanOnce(page, true, 2000);
    const shown = await page.evaluate(
      () => performance.getEntriesByName("review-shown")[0].startTime,
    );
    report[`first-${name}`] = { ...run, tapToReview: Math.round(shown - tap) };
    await context.close();
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await scanOnce(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const ch = new MessageChannel();
            ch.port1.onmessage = (e: MessageEvent<{ ready: boolean }>) => resolve(e.data.ready);
            navigator.serviceWorker.controller!.postMessage({ type: "scan-assets-status" }, [
              ch.port2,
            ]);
          }),
      ),
    )
    .toBe(true);
  const repeat = await context.newPage();
  await repeat.setViewportSize({ width: 390, height: 844 });
  await repeat.goto("./");
  await (await context.newCDPSession(repeat)).send("Emulation.setCPUThrottlingRate", { rate });
  report.repeatFromCache = await scanOnce(repeat, true, 2000);
  report.warm = await scanOnce(repeat);
  await context.close();

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}visits.json`, JSON.stringify(report, null, 1) + "\n");
  summary(
    "### First and repeat visit, 4x CPU (informational)\n\n```json\n" +
      JSON.stringify(report) +
      "\n```\n",
  );
  console.log(`[perf] visits ${JSON.stringify(report)}`);
});
