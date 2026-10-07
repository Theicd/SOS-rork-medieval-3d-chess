/**
 * King's Gambit offline shell.
 *
 * After the first online visit that finishes loading the hall:
 *   - JS/CSS/HTML/icons come from Cache Storage (fast reopen, works offline)
 *   - Local era models under /models/ are cache-first
 *   - Classic-era models + audio on r2-pub.rork.com are also cached once fetched
 *
 * A brand-new install still needs one online session to fill the asset cache.
 * After that, opening the installed app with no network should still reach the
 * board (matchmaking alone still needs the net).
 */
const CACHE = "kg-v2";
const SAME_ORIGIN_STATIC = /\/(assets|models)\//;
const REMOTE_HOSTS = new Set(["r2-pub.rork.com"]);

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const shell = ["./", "./index.html", "./manifest.webmanifest", "./icon.png", "./favicon.png", "./sw.js"];
      await Promise.all(shell.map((u) => cache.add(u).catch(() => {})));
      try {
        const res = await fetch("./");
        if (!res.ok) return;
        const html = await res.text();
        const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
          .map((m) => m[1])
          .filter((u) => u.includes("/assets/") || u.endsWith(".webmanifest") || u.endsWith(".png"));
        await Promise.all(
          urls.map((u) =>
            cache.match(new URL(u, self.location).href).then((hit) => hit || cache.add(u)).catch(() => {}),
          ),
        );
      } catch {
        /* runtime caching fills the rest on first play */
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

  if (url.origin === self.location.origin) {
    if (SAME_ORIGIN_STATIC.test(url.pathname)) {
      e.respondWith(cacheFirst(req, url.origin + url.pathname));
      return;
    }
    e.respondWith(networkFirst(req));
    return;
  }

  // Classic sculpts + score stems live on Rork's public R2. Cache them the
  // first time they load so an installed game survives without the network.
  if (REMOTE_HOSTS.has(url.hostname)) {
    e.respondWith(cacheFirst(req, req.url));
  }
});

async function cacheFirst(req, key) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque") && res.status !== 206) {
      cache.put(key, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const fallback = await cache.match(key);
    return fallback || Response.error();
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.status === 200) {
      const key = req.mode === "navigate" ? new URL("./", self.location).href : req.url;
      cache.put(req.mode === "navigate" ? key : req, res.clone()).catch(() => {});
      if (req.mode === "navigate") {
        cache.put("./index.html", res.clone()).catch(() => {});
        res
          .clone()
          .text()
          .then((html) => prune(cache, html))
          .catch(() => {});
      }
    }
    return res;
  } catch {
    if (req.mode === "navigate") {
      return (
        (await cache.match("./")) ||
        (await cache.match("./index.html")) ||
        (await cache.match(req, { ignoreSearch: true })) ||
        Response.error()
      );
    }
    const hit = await cache.match(req);
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
