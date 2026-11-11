// update.js — tells the player when a newer ReChan Web build is published and
// lets them switch to it with one tap.
//
// The build stamps its id into this file and into version.json (web/Makefile).
// version.json is always fetched from the network, so comparing the two tells
// whether the page that is running is the latest one. The service worker keeps
// serving the running build until the player chooses to update.
'use strict';

const RechanUpdate = (() => {
  const CURRENT = { build: '__RECHAN_BUILD__', commit: '__RECHAN_COMMIT__' };
  const CHECK_EVERY_MS = 30 * 60 * 1000;
  let latest = null;          // version.json of a newer build, or null
  let lastResult = 'unknown'; // 'latest' | 'available' | 'offline' | 'checking' | 'unknown'
  let registration = null;
  let reloading = false;
  const listeners = new Set();

  const isDevBuild = () => CURRENT.build.startsWith('__');

  // "20261111202802" (UTC) -> local date/time text.
  function formatBuild(build) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(build || '');
    if (!m) return build || '?';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function notify() { listeners.forEach((fn) => { try { fn(state()); } catch (_) {} }); }

  function state() {
    return {
      current: CURRENT, currentText: formatBuild(CURRENT.build),
      latest, latestText: latest ? formatBuild(latest.build) : '',
      result: lastResult,
    };
  }

  async function check() {
    if (isDevBuild() || location.protocol === 'file:') return state();
    lastResult = 'checking'; notify();
    try {
      const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const info = await res.json();
      // Whatever is published is the build to run (it may even be a rollback).
      if (info && info.build && info.build !== CURRENT.build) {
        latest = info; lastResult = 'available';
        if (registration) registration.update().catch(() => {}); // start downloading it
      } else {
        latest = null; lastResult = 'latest';
      }
    } catch (_) {
      lastResult = 'offline';
    }
    notify();
    return state();
  }

  function waitFor(cond, ms) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => (cond() || Date.now() - t0 > ms) ? resolve(cond()) : setTimeout(tick, 250);
      tick();
    });
  }

  // Activates the new build and reloads. Saves live in IndexedDB, so they are
  // kept; whatever is not saved in the current game is lost.
  async function apply() {
    if (reloading) return;
    reloading = true;
    const reg = registration;
    if (reg && navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
      try { await reg.update(); } catch (_) {}
      await waitFor(() => reg.waiting, 60000);
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        setTimeout(() => location.reload(), 5000); // fallback if controllerchange never fires
        return;
      }
    }
    location.reload();
  }

  function onChange(fn) { listeners.add(fn); fn(state()); return () => listeners.delete(fn); }

  function init() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        registration = reg;
        // A build downloaded in the background counts as available too.
        const watch = (w) => w && w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller && lastResult !== 'available') check();
        });
        watch(reg.installing);
        reg.addEventListener('updatefound', () => watch(reg.installing));
      }).catch((e) => console.warn('SW:', e));
    }
    check();
    setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  }

  return { init, check, apply, onChange, state, formatBuild };
})();
