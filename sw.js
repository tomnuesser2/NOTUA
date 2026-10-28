// NOTUA – service worker: caches the app shell so it opens instantly and works offline.
// Your boards themselves are never stored here — those already live in IndexedDB / your chosen
// folder (see the app's own storage code). This only caches the static files that draw the UI.
const CACHE_NAME = 'notua-v323';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './app-icon.png',
  './favicon.png',
  './favicon.svg',
  './icon-512.png',
];
// So lange wartet die Seite höchstens aufs Netz, bevor die gespeicherte Version gezeigt wird (langsames Netz).
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS.map((u) => new Request(u, { cache: 'reload' }))).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putInCache(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  }
  return response;
}

// "auf macOS wird nicht die aktuellste Version gezeigt": Früher kam auch die Seite selbst (index.html) zuerst
// aus dem Speicher und wurde nur im Hintergrund erneuert — eine neue Version war deshalb erst beim
// übernächsten Öffnen zu sehen (Safari hält zusätzlich den 10-Minuten-HTTP-Cache von GitHub Pages ein).
// Jetzt: Seiten (HTML) immer zuerst frisch aus dem Netz (cache:'no-cache' = beim Server nachfragen, ob neu),
// nur offline oder nach NETWORK_TIMEOUT_MS aus dem Speicher. Alles andere (Icons, Bilder) weiter
// stale-while-revalidate: sofort aus dem Speicher, im Hintergrund erneuert.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (!req.url.startsWith(self.location.origin)) return;
  const url = new URL(req.url);
  // Update checks (?nocache=…) must always hit the network and must not be cached.
  if (url.searchParams.has('nocache')) return;

  const isPage = req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
  if (isPage) {
    event.respondWith((async () => {
      const cached = () => caches.match(req, { ignoreSearch: true }).then((c) => c || caches.match('./index.html'));
      const network = fetch(req, { cache: 'no-cache' }).then((r) => putInCache(req, r));
      const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, 'timeout'));
      try {
        const first = await Promise.race([network, timeout]);
        if (first !== 'timeout' && first && first.ok) return first;
        const c = await cached();
        if (c) return c;
        return await network;
      } catch (e) {
        return (await cached()) || Response.error();
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req, { cache: 'no-cache' })
        .then((response) => putInCache(req, response))
        // Falls back to the cached copy when there is one; Response.error() is always a valid Response.
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
