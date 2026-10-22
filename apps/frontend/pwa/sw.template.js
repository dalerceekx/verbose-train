/*
 * MeningFermam service worker — generated at build time from this template
 * (see the service-worker plugin in vite.config.ts). It keeps the app shell
 * (index.html, the built scripts, styles and fonts) on the device so the app
 * opens without internet. API answers are never cached here: the app keeps
 * its own per-user offline copy and clears it on logout.
 */
const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const CACHE = `mf-shell-${VERSION}`;
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith('mf-shell-') && key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages: the network first (always the newest app), the stored shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(SHELL, { cacheName: CACHE }).then((cached) => cached || Response.error())),
    );
    return;
  }

  // Built files carry a content hash: the stored copy is always right.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }

  event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached || Response.error())));
});
