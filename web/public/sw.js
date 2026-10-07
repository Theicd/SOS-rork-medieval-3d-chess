// Page shell: network first so a new deploy is seen on the next visit.
// Hashed build assets: cache first.
const CACHE = "kg-v1";
const STATIC = /\/assets\//;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    (async () => {
      try {
        const res = await fetch("./");
        if (!res.ok) return;
        const html = await res.text();
        const urls = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => m[1]);
        const cache = await caches.open(CACHE);
        await Promise.all(
          urls.map((u) =>
            cache.match(new URL(u, self.location).href).then((hit) => hit || cache.add(u)).catch(() => {}),
          ),
        );
      } catch {
        /* offline install: runtime caching fills in */
      }
    })(),
  );
});

self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (STATIC.test(url.pathname)) e.respondWith(cacheFirst(req, url));
  else e.respondWith(networkFirst(req));
});

async function cacheFirst(req, url) {
  const cache = await caches.open(CACHE);
  const key = url.origin + url.pathname;
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.status === 200) cache.put(key, res.clone()).catch(() => {});
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.status === 200) {
      cache.put(req, res.clone()).catch(() => {});
      if (req.mode === "navigate") res.clone().text().then((html) => prune(cache, html)).catch(() => {});
    }
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
    return hit || Response.error();
  }
}

async function prune(cache, html) {
  for (const req of await cache.keys()) {
    const p = new URL(req.url).pathname;
    if (p.includes("/assets/") && !html.includes(p.slice(p.lastIndexOf("/assets/") + 1))) {
      await cache.delete(req);
    }
  }
}
