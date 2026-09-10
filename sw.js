// NOTUA – service worker: caches the app shell so it opens instantly and works offline.
// Your boards themselves are never stored here — those already live in IndexedDB / your chosen
// folder (see the app's own storage code). This only caches the static files that draw the UI.
const CACHE_NAME = 'notua-v71';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './app-icon.png',
  './favicon.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// stale-while-revalidate: answer instantly from cache when we have it, and quietly refresh the
// cache from the network in the background — so the next launch has the newest version too.
//
// Only ever touches same-origin requests (the app shell) — this never caches a cross-origin response
// anyway (see the .startsWith(self.location.origin) check below), so intercepting things like the WoW
// widget's CORS-proxy calls bought nothing but risk: when one of those got blocked by the browser's own
// CORS policy (a real, increasingly common case as free public CORS proxies lock down), the fetch()
// below rejected, .catch(() => cached) returned undefined (nothing was ever cached for a URL that's
// never same-origin), and respondWith(undefined) blew up with "Failed to convert value to 'Response'"
// in the console — confusing noise on top of the real proxy failure, for zero benefit. Letting
// cross-origin requests fall through untouched means the page's own fetch() sees the CORS failure
// exactly as it would with no service worker at all, which is exactly what the app's own per-proxy
// fallback logic (wowFetchViaCorsProxies) is already built to handle.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        // Falls back to the cached copy when there is one; when there isn't (first-ever load of this
        // asset, offline, nothing cached yet), Response.error() is always a valid Response — unlike
        // returning `cached` here (undefined in that case), which is what threw "Failed to convert
        // value to 'Response'" above. A network-error Response is exactly what the browser would have
        // produced with no service worker in the way, so callers see the same failure either way.
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});