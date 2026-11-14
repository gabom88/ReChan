// sw.js — offline support for the installed PWA.
// Caches only ReChan's own files (engine, page, bundled fonts/textures). Disc
// assets never go through here: they live in IndexedDB on the device.
'use strict';

const VERSION = '__RECHAN_BUILD__';
const CACHE = 'rechan-shell-' + VERSION;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/i18n.js',
  'js/store.js',
  'js/extractor.js',
  'js/zippack.js',
  'js/media.js',
  'js/netpack.js',
  'js/input.js',
  'js/dpad-gemuboy.js',
  'js/touch.js',
  'js/update.js',
  'js/app.js',
  'rechan.js',
  'rechan.wasm',
  'rechan.data',
  'icons/rechan-192.png',
  'icons/rechan-512.png',
  'icons/apple-touch-icon.png',
];

// A new build downloads in the background and waits: the page shows
// "new version available" and activates it (SKIP_WAITING) when the player
// taps Update, so a running game never mixes files from two builds. The very
// first install has nothing to replace and activates at once.
self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache: GitHub Pages lets it keep
  // files for 10 minutes, so a plain fetch could fill this build's cache with
  // the previous build's files (and the page would keep saying "new version").
  event.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => {
    if (!self.registration.active) return self.skipWaiting();
  }));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('rechan-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Everything comes from this build's cache (page included), so the page and
// the engine always match. version.json always goes to the network: it is how
// the page learns that a newer build exists.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (new URL(req.url).pathname.endsWith('/version.json')) return; // network only
  // The game data parts (option "Download the game") are ~100 MB: they go
  // straight to IndexedDB, never into this cache.
  if (/\/data\//.test(new URL(req.url).pathname)) return;
  const isPage = req.mode === 'navigate';
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isPage) {
      const cached = await cache.match('index.html');
      if (cached) return cached;
      try {
        const fresh = await fetch(req.url, { cache: 'reload' });
        if (fresh.ok) cache.put('index.html', fresh.clone());
        return fresh;
      } catch (_) {
        return Response.error();
      }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req, { cache: 'reload' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
