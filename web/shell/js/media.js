// media.js — experimental media-pack mode: modern audio/video for the engine
// (see src/pc/webmedia.*). AAC is decoded by the browser; MP4 movies play in
// a full-screen <video>. Only used when the game was loaded from a ZIP pack.
'use strict';

const RechanMedia = (() => {
  let active = false;

  function has(key) { return !!RechanStore.getBlob('media/' + key); }

  async function decodeAudio(key, preferredRate) {
    const blob = RechanStore.getBlob('media/' + key);
    if (!blob) return null;
    const data = await blob.arrayBuffer();
    // Decode straight to (about) the original rate to keep memory use like
    // the stable mode. Safari wants >= 22050 Hz for an OfflineAudioContext.
    const rate = Math.max(22050, Math.min(48000, preferredRate | 0 || 44100));
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Ctx(2, 1, rate);
    const buf = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(data, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
    const ch = Math.min(2, buf.numberOfChannels);
    const frames = buf.length;
    const pcm = new Int16Array(frames * ch);
    for (let c = 0; c < ch; c++) {
      const src = buf.getChannelData(c);
      for (let i = 0, o = c; i < frames; i++, o += ch) {
        const v = src[i];
        pcm[o] = v >= 1 ? 32767 : v <= -1 ? -32768 : (v * 32767) | 0;
      }
    }
    return { pcm, rate: buf.sampleRate, channels: ch, frames };
  }

  // Resolves when the movie ends or is skipped (Start / A / Enter / Esc /
  // Space / "Skip" button when the original movie was skippable).
  function playMovie(key, skippable) {
    const blob = RechanStore.getBlob('media/' + key);
    if (!blob) return Promise.resolve(false);
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const layer = document.createElement('div');
      layer.id = 'movie-layer';
      const video = document.createElement('video');
      video.src = url;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.preload = 'auto';
      layer.appendChild(video);
      const tapBtn = document.createElement('button');
      tapBtn.className = 'btn primary movie-tap hidden';
      tapBtn.textContent = RechanI18n.t('tapToPlay');
      layer.appendChild(tapBtn);
      let skipBtn = null;
      if (skippable) {
        skipBtn = document.createElement('button');
        skipBtn.className = 'btn movie-skip';
        skipBtn.textContent = RechanI18n.t('skip') + ' ▶▶';
        layer.appendChild(skipBtn);
      }
      document.body.appendChild(layer);

      let finished = false;
      let raf = 0;
      const finish = () => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey, true);
        try { video.pause(); } catch (_) { /* ignore */ }
        layer.remove();
        URL.revokeObjectURL(url);
        resolve(true);
      };
      const onKey = (e) => {
        if (skippable && ['Enter', 'Escape', 'Space', 'NumpadEnter'].includes(e.code)) {
          e.preventDefault(); e.stopImmediatePropagation(); finish();
        }
      };
      // Gamepad: Start (9) or A (0) skips.
      let padHeld = true;
      const pollPads = () => {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let down = false;
        for (const p of pads) if (p && p.buttons && ((p.buttons[9] && p.buttons[9].pressed) || (p.buttons[0] && p.buttons[0].pressed))) down = true;
        if (skippable && down && !padHeld) { finish(); return; }
        padHeld = down;
        raf = requestAnimationFrame(pollPads);
      };
      window.addEventListener('keydown', onKey, true);
      if (skipBtn) skipBtn.addEventListener('click', finish);
      video.addEventListener('ended', finish);
      video.addEventListener('error', finish);
      tapBtn.addEventListener('click', () => { tapBtn.classList.add('hidden'); video.play().catch(() => {}); });
      raf = requestAnimationFrame(pollPads);
      const p = video.play();
      // Autoplay with sound may be blocked (iOS): ask for a tap.
      if (p && p.catch) p.catch(() => tapBtn.classList.remove('hidden'));
    });
  }

  return {
    get active() { return active; },
    setActive(on) { active = !!on; },
    has, decodeAudio, playMovie,
  };
})();
