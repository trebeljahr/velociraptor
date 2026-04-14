/*
 * Raptor Runner service worker.
 *
 * Goal: make the game installable as a real PWA that works
 * offline after the first visit. Strategy:
 *
 *   • On `install`, pre-cache the entire game shell — HTML,
 *     game.js, the score-card worker, the manifest, every
 *     asset the game actually uses. Small payload, always
 *     worth fetching up front.
 *   • On `activate`, wipe any old cache versions so a bumped
 *     CACHE_NAME cleanly replaces them.
 *   • On `fetch`, serve same-origin GETs from the cache first,
 *     fall through to network, and update the cache with any
 *     fresh responses so subsequent visits are always fastest.
 *     Navigations fall back to the cached index.html when the
 *     network is offline.
 *
 * Bump CACHE_NAME to invalidate all cached content on deploy.
 */

const CACHE_NAME = "raptor-runner-v4";

const PRECACHE = [
  "./",
  "./index.html",
  "./game.js",
  "./score-card-worker.js",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./imprint.html",
  "./about.html",
  "./assets/raptor-sheet.png",
  "./assets/raptor-idle.png",
  "./assets/party-hat.png",
  "./assets/thug-glasses.png",
  "./assets/cactus1.png",
  "./assets/cactus2.png",
  "./assets/cactus3.png",
  "./assets/cactus4.png",
  "./assets/cactus5.png",
  "./assets/cactus6.png",
  "./assets/cactus7.png",
  "./assets/cactus8.png",
  "./assets/music2.mp3",
  "./assets/bow-tie.png",
  "./assets/ufo.png",
  "./assets/santa-sleigh.png",
  "./assets/reindeer.png",
  "./assets/tumbleweed.png",
  "./assets/rain.mp3",
  "./assets/thunder.mp3",
  "./assets/jump.mp3",
  "./assets/favicon-16.png",
  "./assets/favicon-32.png",
  "./assets/apple-touch-icon.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/og-image.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // Each add is isolated so one 404 doesn't poison the
        // whole install. Anything that 404s simply gets skipped
        // and will fall through to the network on demand.
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(url).catch((e) => {
              // eslint-disable-next-line no-console
              console.warn("sw precache miss:", url, e && e.message);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle GETs for same-origin resources. Cross-origin
  // fetches (fonts, analytics later, etc.) pass straight through.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation requests: try the network first, fall back to
  // the cached index.html so the app still loads offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          // Refresh the cached copy of the navigation target
          // in the background so future offline visits are
          // on the latest HTML.
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, respClone));
          return resp;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match("./index.html"))
        )
    );
    return;
  }

  // Static assets: cache-first, then network with cache update.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((resp) => {
          if (
            resp &&
            resp.status === 200 &&
            resp.type === "basic"
          ) {
            const respClone = resp.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(req, respClone));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
