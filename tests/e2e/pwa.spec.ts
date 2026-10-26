/**
 * PWA behaviour of the production build (vite preview locally, or the live site via
 * playwright.live.config.ts): the service worker precaches only the app shell,
 * manual entry works offline, the vision assets are cached on the first scan and
 * only once every file downloaded completely, and a later scan works offline.
 * Every test also checks for console errors and cross-origin requests.
 */
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const PHOTO = fileURLToPath(new URL("../fixtures/e2e/synth-upright.jpg", import.meta.url));
const SCAN_TIMEOUT = 120_000;
const PUZZLE = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";

type Watch = { errors: string[]; foreign: string[]; failed: string[]; workers: string[] };

/** Record console errors, page errors, cross-origin requests and failed responses. */
function watch(context: BrowserContext, page: Page, origin: string): Watch {
  const w: Watch = { errors: [], foreign: [], failed: [], workers: [] };
  const attach = (p: Page) => {
    p.on("console", (m) => {
      // The deliberate offline probe below is expected to fail.
      if (m.type() === "error" && !m.location().url.endsWith("?probe")) w.errors.push(m.text());
    });
    p.on("pageerror", (e) => w.errors.push(e.message));
    p.on("worker", (wk) => w.workers.push(wk.url()));
  };
  attach(page);
  context.on("page", attach);
  context.on("request", (r) => {
    const url = new URL(r.url());
    if (url.protocol !== "data:" && url.protocol !== "blob:" && url.origin !== origin) {
      w.foreign.push(r.url());
    }
  });
  context.on("response", (r) => r.status() >= 400 && w.failed.push(`${r.status()} ${r.url()}`));
  return w;
}

function expectClean(w: Watch) {
  expect(w.errors, "console errors").toEqual([]);
  expect(w.foreign, "cross-origin requests").toEqual([]);
  expect(w.failed, "failed responses").toEqual([]);
}

async function open(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 30_000,
  });
}

/** Ask the service worker whether every vision asset is cached and verified. */
function assetsReady(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (e: MessageEvent<{ ready: boolean }>) => resolve(e.data.ready);
        navigator.serviceWorker.controller!.postMessage({ type: "scan-assets-status" }, [
          channel.port2,
        ]);
      }),
  );
}

async function enterAndSolve(page: Page) {
  for (let i = 0; i < 81; i++) {
    if (PUZZLE[i] === "0") continue;
    await page.locator(".cell").nth(i).click();
    await page.keyboard.press(PUZZLE[i]);
  }
  await page.getByRole("button", { name: "Solve" }).click();
  await expect(page.getByTestId("message")).toHaveText("Solved!");
}

async function scan(page: Page) {
  await page.getByTestId("upload-input").setInputFiles(PHOTO);
  await expect(page.getByTestId("title")).toHaveText("Review the recognized puzzle", {
    timeout: SCAN_TIMEOUT,
  });
}

/** Tap Upload while offline: the "connect once" card shows and no file picker opens. */
async function expectConnectOnce(page: Page) {
  let pickers = 0;
  const onChooser = () => pickers++;
  page.on("filechooser", onChooser);
  await page.getByRole("button", { name: "Upload image" }).first().click();
  await expect(page.getByTestId("title")).toHaveText("Connect once to enable offline scanning");
  await expect(page.getByTestId("error-text")).toContainText("one-time download");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload image" })).toBeHidden();
  page.off("filechooser", onChooser);
  expect(pickers, "no file picker while scanning cannot work").toBe(0);
}

test.describe.configure({ mode: "serial" });
test.skip(({ browserName }) => browserName !== "chromium", "service worker checks use Chromium");

test("the service worker precaches only the app shell", async ({ page, context, baseURL }) => {
  const w = watch(context, page, new URL(baseURL!).origin);
  await open(page);
  const source = await (await page.request.get("sw.js")).text();
  const shell = JSON.parse(/const SHELL = (\[.*\]);/.exec(source)![1]) as string[];
  const lazy = JSON.parse(/const LAZY = (\[.*\]);/.exec(source)![1]) as { url: string }[];
  expect(shell.filter((f) => /\.(wasm|onnx)$|opencv/.test(f))).toEqual([]);
  for (const heavy of [/\.wasm$/, /\.onnx$/, /opencv/]) {
    expect(lazy.some((e) => heavy.test(e.url))).toBe(true);
  }

  const caches = await page.evaluate(async () => {
    const keys = await window.caches.keys();
    const sizes: Record<string, number> = {};
    for (const k of keys) sizes[k] = (await (await window.caches.open(k)).keys()).length;
    return sizes;
  });
  const names = Object.keys(caches);
  expect(names.some((k) => /^sudoku-shell-[0-9a-f]{12}$/.test(k))).toBe(true);
  expect(names.every((k) => /^sudoku-(shell|assets)-[0-9a-f]{12}$/.test(k))).toBe(true);
  for (const [k, n] of Object.entries(caches))
    if (k.startsWith("sudoku-assets-")) expect(n).toBe(0);
  expect(await assetsReady(page)).toBe(false);
  // Manual entry never loads the vision code.
  expect(w.workers).toEqual([]);
  expectClean(w);
});

test("manual entry works offline", async ({ page, context, baseURL }) => {
  const w = watch(context, page, new URL(baseURL!).origin);
  await open(page);
  await context.setOffline(true);
  await page.reload();
  await enterAndSolve(page);
  await context.setOffline(false);
  expectClean(w);
});

test("offline before any scan: connect once, manual entry still works", async ({
  page,
  context,
  baseURL,
}) => {
  const w = watch(context, page, new URL(baseURL!).origin);
  await open(page);
  await context.setOffline(true);
  await page.reload();
  await expectConnectOnce(page);
  await page.screenshot({ path: "test-results/pwa/connect-once-390.png", fullPage: true });
  // Still offline: Try again keeps the card up rather than failing a scan.
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("title")).toHaveText("Connect once to enable offline scanning");
  await page.getByRole("button", { name: "Enter manually" }).click();
  await enterAndSolve(page);
  await context.setOffline(false);
  expectClean(w);
});

test("after one online scan, scanning works offline", async ({ page, context, baseURL }) => {
  test.setTimeout(300_000);
  const w = watch(context, page, new URL(baseURL!).origin);
  await open(page);
  await scan(page);
  // Single-threaded onnxruntime: static hosting has no cross-origin isolation.
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  expect(w.workers, "onnxruntime must not start workers").toEqual([]);
  await expect.poll(() => assetsReady(page), { timeout: 60_000 }).toBe(true);

  await context.setOffline(true);
  const offline = await context.newPage();
  const network: string[] = [];
  offline.on("response", (r) => {
    if (r.url().startsWith("http") && !r.fromServiceWorker()) network.push(r.url());
  });
  await open(offline);
  // Really offline: a URL the worker does not cache cannot be fetched.
  expect(
    await offline.evaluate(() =>
      fetch("sw.js?probe").then(
        () => true,
        () => false,
      ),
    ),
  ).toBe(false);
  // The real path: tap Upload, the picker opens (no "connect once" card), pick the photo.
  await expect.poll(() => assetsReady(offline)).toBe(true);
  const chooser = offline.waitForEvent("filechooser");
  await offline.getByRole("button", { name: "Upload image" }).click();
  await (await chooser).setFiles(PHOTO);
  await expect(offline.getByTestId("title")).toHaveText("Review the recognized puzzle", {
    timeout: SCAN_TIMEOUT,
  });
  expect(network, "offline responses must come from the service worker").toEqual([]);
  await context.setOffline(false);
  expectClean(w);
});

test("a truncated download is never cached or marked ready", async ({ page, context }) => {
  test.setTimeout(300_000);
  let truncated = 0;
  await context.route(/ort-wasm-simd-threaded-[^/]*\.wasm$/, async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    truncated++;
    await route.fulfill({ response, body: body.subarray(0, body.length >> 1) });
  });
  await open(page);
  await page.getByTestId("upload-input").setInputFiles(PHOTO);
  // onnxruntime cannot compile half a wasm file, so the scan fails.
  await expect(page.getByTestId("title")).toHaveText("We couldn't read that photo", {
    timeout: SCAN_TIMEOUT,
  });
  expect(truncated).toBeGreaterThan(0);
  const cachedAssets = () =>
    page.evaluate(async () => {
      const urls: string[] = [];
      for (const k of await window.caches.keys()) {
        if (!k.startsWith("sudoku-assets-")) continue;
        for (const r of await (await window.caches.open(k)).keys()) urls.push(r.url);
      }
      return urls;
    });
  // OpenCV.js loads independently and is cached; the half wasm is not.
  await expect.poll(async () => (await cachedAssets()).some((u) => /opencv/.test(u))).toBe(true);
  expect((await cachedAssets()).some((u) => u.endsWith(".wasm"))).toBe(false);
  expect(await assetsReady(page)).toBe(false);

  await context.setOffline(true);
  await page.reload();
  await expectConnectOnce(page);
  await context.setOffline(false);
});

test("activate deletes old caches and keeps still-listed assets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // A same-origin page that does not register the worker, to plant caches first.
  await page.goto("manifest.webmanifest");
  const source = await (await page.request.get("sw.js")).text();
  const lazy = JSON.parse(/const LAZY = (\[.*\]);/.exec(source)![1]) as { url: string }[];
  const kept = new URL(lazy.find((e) => e.url.endsWith(".onnx"))!.url, page.url()).href;
  const dropped = new URL("assets/model-0ld0ld.onnx", page.url()).href;
  await page.evaluate(
    async ([kept, dropped]) => {
      await (await caches.open("sudoku-c8b6132130fb")).put(kept, new Response("phase 5"));
      const old = await caches.open("sudoku-assets-000000000000");
      await old.put(kept, new Response("same hashed file"));
      await old.put(dropped, new Response("no longer listed"));
    },
    [kept, dropped],
  );

  await open(page);
  const after = await page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const k of await caches.keys()) {
      out[k] = (await (await caches.open(k)).keys()).map((r) => r.url);
    }
    return out;
  });
  const names = Object.keys(after);
  expect(names).not.toContain("sudoku-c8b6132130fb");
  expect(names).not.toContain("sudoku-assets-000000000000");
  const assets = names.filter((k) => k.startsWith("sudoku-assets-"));
  expect(assets).toHaveLength(1);
  expect(after[assets[0]]).toEqual([kept]);
  expect(await assetsReady(page)).toBe(false); // one file is not everything
});
