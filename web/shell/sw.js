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
  'js/input.js',
  'js/dpad-gemuboy.js',
  'js/touch.js',
  'js/app.js',
  'rechan.js',
  'rechan.wasm',
  'rechan.data',
  'icons/rechan-192.png',
  'icons/rechan-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('rechan-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Network-first for the page itself (so updates show up), cache-first for the
// rest (large, versioned per build).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate';
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isPage) {
      try {
        const fresh = await fetch(req);
        cache.put('index.html', fresh.clone());
        return fresh;
      } catch (_) {
        return (await cache.match('index.html')) || Response.error();
      }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
