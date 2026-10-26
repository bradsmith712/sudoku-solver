/**
 * Whether scanning can work offline. The service worker (public/sw.js) caches the
 * vision assets (OpenCV.js, onnxruntime, its wasm and the model) on the first scan
 * and reports them ready only once every file is cached and verified. Until then,
 * an offline user is told to connect once instead of being sent to the camera.
 */
export type AssetsStatus = "ready" | "missing" | "unknown";

/** True when a scan cannot work: offline and the vision assets are not all cached. */
export function needsConnection(online: boolean, status: AssetsStatus): boolean {
  return !online && status !== "ready";
}

/** "unknown" without a controlling service worker (dev, first visit) or a reply in time. */
function ask(type: string, timeoutMs: number): Promise<AssetsStatus> {
  const controller = globalThis.navigator?.serviceWorker?.controller;
  if (!controller) return Promise.resolve("unknown");
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve("unknown"), timeoutMs);
    channel.port1.onmessage = (e: MessageEvent<{ ready?: boolean }>) => {
      clearTimeout(timer);
      resolve(e.data?.ready ? "ready" : "missing");
    };
    controller.postMessage({ type }, [channel.port2]);
  });
}

/** Ask the service worker whether every vision asset is cached. */
export const scanAssetsStatus = (): Promise<AssetsStatus> => ask("scan-assets-status", 1000);

/**
 * Ask the service worker to fetch and verify any vision asset it is missing (usually
 * from the HTTP cache), e.g. when the first scan started before it controlled the page.
 */
export const cacheScanAssets = (): Promise<AssetsStatus> => ask("cache-scan-assets", 120_000);
