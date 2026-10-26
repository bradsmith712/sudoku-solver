// Service worker: offline app shell, plus the vision assets cached on first use.
// In production builds the `swPrecache` plugin in vite.config.ts fills the
// placeholders below: SHELL is precached on install; LAZY (the vision chunk,
// OpenCV.js, onnxruntime, its wasm and the model, each with a SHA-256) is cached
// only when the user first scans, so first paint and install never wait on ~25 MB.
// URLs are relative to this script, so the worker works under any `base` path.
//
// Both cache names are versioned. On activate, assets whose hashed URL is still
// listed are carried over from the previous assets cache (same name, same bytes),
// so an app-only update does not re-download them; every other old cache is deleted.
// The ready marker is written only when every LAZY file is cached and verified.

const SHELL_VERSION = "__SW_SHELL_VERSION__";
const ASSETS_VERSION = "__SW_ASSETS_VERSION__";
const SHELL = /* __SW_SHELL__ */ ["./"];
const LAZY = /* __SW_LAZY__ */ [];

const SHELL_CACHE = `sudoku-shell-${SHELL_VERSION}`;
const ASSETS_CACHE = `sudoku-assets-${ASSETS_VERSION}`;

const abs = (path) => new URL(path, self.location).href;
const INDEX_URL = abs("./");
const READY_URL = abs("__scan-assets-ready__");
const SHELL_URLS = new Set(SHELL.map(abs));
const DIGESTS = new Map(LAZY.map((e) => [abs(e.url), e.sha256]));

/** Downloads being verified and stored, by URL, so a fill does not fetch them twice. */
const storing = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Bypass the HTTP cache: Pages allows a 10-minute-old index.html.
      .then((cache) => cache.addAll(SHELL.map((p) => new Request(abs(p), { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const assets = await caches.open(ASSETS_CACHE);
      for (const key of keys) {
        if (!key.startsWith("sudoku-assets-") || key === ASSETS_CACHE) continue;
        const old = await caches.open(key);
        for (const request of await old.keys()) {
          if (!DIGESTS.has(request.url) || (await assets.match(request.url))) continue;
          const response = await old.match(request);
          if (response) await assets.put(request.url, response);
        }
      }
      await Promise.all(
        keys
          .filter((k) => k.startsWith("sudoku-") && k !== SHELL_CACHE && k !== ASSETS_CACHE)
          .map((k) => caches.delete(k)),
      );
      await updateReady(assets);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") event.respondWith(page(request));
  else if (DIGESTS.has(request.url)) event.respondWith(lazy(event, request));
  else if (SHELL_URLS.has(request.url)) event.respondWith(shell(request));
});

self.addEventListener("message", (event) => {
  const port = event.ports[0];
  const reply = (ready) => port?.postMessage({ ready });
  if (event.data?.type === "scan-assets-status") event.waitUntil(isReady().then(reply));
  else if (event.data?.type === "cache-scan-assets") event.waitUntil(fillMissing().then(reply));
});

/** Network first (revalidated, not from the HTTP cache), falling back to the cached shell. */
async function page(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request.url, { cache: "no-cache" });
    if (response.ok) await cache.put(INDEX_URL, response.clone());
    return response;
  } catch {
    return (await cache.match(INDEX_URL)) ?? Response.error();
  }
}

async function shell(request) {
  const cached = await caches.match(request.url, { cacheName: SHELL_CACHE });
  return cached ?? fetch(request);
}

/** Cache first; a miss goes to the network and is stored once fully read and verified. */
async function lazy(event, request) {
  const cache = await caches.open(ASSETS_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) event.waitUntil(store(cache, request.url, response.clone()));
  return response;
}

function store(cache, url, response) {
  let job = storing.get(url);
  if (!job) {
    job = verifyAndPut(cache, url, response).finally(() => storing.delete(url));
    storing.set(url, job);
  }
  return job;
}

async function verifyAndPut(cache, url, response) {
  try {
    const body = await response.arrayBuffer();
    // A truncated or replaced download fails the digest and is never cached.
    if ((await sha256(body)) !== DIGESTS.get(url)) return;
    const headers = {};
    const type = response.headers.get("content-type");
    if (type) headers["content-type"] = type; // wasm streaming compile needs it
    await cache.put(url, new Response(body, { headers }));
    await updateReady(cache);
  } catch {
    // Network dropped mid-download: nothing is cached; the next scan tries again.
  }
}

/** Fetch whatever LAZY files are missing (usually from the HTTP cache) and verify them. */
async function fillMissing() {
  const cache = await caches.open(ASSETS_CACHE);
  for (const url of DIGESTS.keys()) {
    if (storing.has(url)) await storing.get(url);
    if (await cache.match(url)) continue;
    try {
      const response = await fetch(url);
      if (response.ok) await store(cache, url, response);
    } catch {
      // Offline: report not ready.
    }
  }
  await updateReady(cache);
  return isReady();
}

async function updateReady(cache) {
  const present = await Promise.all([...DIGESTS.keys()].map((u) => cache.match(u)));
  if (DIGESTS.size > 0 && present.every(Boolean)) {
    await cache.put(READY_URL, new Response(ASSETS_VERSION));
  } else {
    await cache.delete(READY_URL);
  }
}

async function isReady() {
  const cache = await caches.open(ASSETS_CACHE);
  return Boolean(await cache.match(READY_URL));
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
