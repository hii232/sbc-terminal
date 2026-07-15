/* SBC Terminal — service worker: cache app shell for offline / phone use */
const CACHE = "sbc-terminal-v40";
const SHELL = ["./", "./index.html", "./app.js?v=40", "./charts.js?v=40", "./universe.js?v=40", "./data.js?v=40", "./sec.js?v=40", "./segments.js?v=40", "./sectors.js?v=40", "./estimates.js?v=40", "./scores.js?v=40", "./manifest.json", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // never cache live API calls — always network
  if (url.origin !== location.origin) return;
  // network-first for app shell so updates land, cache fallback for offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
