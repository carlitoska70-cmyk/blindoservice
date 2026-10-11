// Presidio service worker.
// - Static build assets: cache-first (file names are content-hashed).
// - Pages: network-first; offline, the archived page or /offline.html is shown.
// - Documents saved for offline use live in a separate cache, filled only on the
//   owner's explicit request and cleared on logout. API data is never cached here.
const STATIC = 'presidio-static-v1';
const PAGES = 'presidio-pages-v1';
const DOCS = 'presidio-offline-docs';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then(c => c.addAll([OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  const keep = [STATIC, PAGES, DOCS];
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        hit =>
          hit ||
          fetch(req).then(res => {
            if (res.ok) caches.open(STATIC).then(c => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (url.pathname === '/api/files') {
    // Network first; offline, serve only documents the owner saved explicitly.
    event.respondWith(
      fetch(req).catch(() =>
        caches
          .open(DOCS)
          .then(c => c.match(req))
          .then(hit => hit || Response.error()),
      ),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});
