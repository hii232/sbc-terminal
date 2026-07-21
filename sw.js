/* SBC Terminal — service worker: cache app shell for offline / phone use */
const V = "59";
const CACHE = "sbc-terminal-v" + V;
const SHELL = ["./", "./index.html", "./manifest.json", "./icon.svg"].concat(
  ["app.js", "charts.js", "universe.js", "data.js", "sec.js", "track.js", "segments.js", "sectors.js", "estimates.js", "scores.js"].map((f) => `./${f}?v=${V}`)
);

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
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
