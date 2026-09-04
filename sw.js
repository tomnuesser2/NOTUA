// NOTUA – service worker: caches the app shell so it opens instantly and works offline.
// Your boards themselves are never stored here — those already live in IndexedDB / your chosen
// folder (see the app's own storage code). This only caches the static files that draw the UI.
const CACHE_NAME = 'notua-v22';
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
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok && event.request.url.startsWith(self.location.origin)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});