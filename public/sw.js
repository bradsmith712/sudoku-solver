// Service worker: offline app shell, cache-first static assets, network-first pages.
// In production builds the `swPrecache` plugin in vite.config.ts replaces the two
// placeholders below with a content hash and the list of emitted files. URLs are
// relative to this script, so the worker works under any `base` path.

const BUILD = "__SW_BUILD__";
const CACHE = `sudoku-${BUILD}`;

const SHELL = /* __SW_PRECACHE__ */ ["./"];

// TODO(phase-4/5): add the self-hosted OpenCV.js file and the ONNX digit model
// (plus any onnxruntime-web .wasm files) once their final paths exist, e.g.
//   "vendor/opencv.js", "models/digits.onnx", "ort/ort-wasm-simd.wasm"
// They are cached on install but do not block it, so manual entry still goes
// offline even if a large download fails. Until then they are cached on first
// use by the cache-first fetch handler below.
const HEAVY = [];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(SHELL);
      await Promise.all(HEAVY.map((url) => cache.add(url).catch(() => undefined)));
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("sudoku-") && k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(request.mode === "navigate" ? networkFirst(request) : cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(new URL("./", self.location).href, response.clone());
    return response;
  } catch {
    const cached = await cache.match(new URL("./", self.location).href);
    return cached ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") cache.put(request, response.clone());
  return response;
}
