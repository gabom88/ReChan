// audiotest.js — hidden sound test for the ZIP mode's music and speech.
// Open it by tapping the "Version …" line 5 times (start screen or Options),
// or with ?audiotest in the URL. It reports what the browser supports, what
// is installed, what every decoding method returns (including silent output),
// what the engine asked for, and lets you listen to the decoded music.
'use strict';

const RechanAudioTest = (() => {
  let panel = null, out = null, lines = [];
  const log = (s) => { lines.push(s); if (out) out.textContent = lines.join('\n'); };
  const errText = (e) => ((e && e.name) || 'Error') + (e && e.message ? ': ' + e.message : '');

  function musicKeys() {
    return RechanStore.keys().filter((k) => k.startsWith('media/music/')).sort();
  }

  function peakOf(buf) {
    let peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i += 53) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    }
    return Math.round(peak * 1000) / 1000;
  }

  async function run() {
    lines = [];
    log('### ReChan audio test');
    log('when: ' + new Date().toISOString());
    log('ua: ' + navigator.userAgent);
    log('standalone (home-screen app): ' + (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches));
    const Live = window.AudioContext || window.webkitAudioContext;
    const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    log('AudioContext: ' + (window.AudioContext ? 'yes' : window.webkitAudioContext ? 'webkit only' : 'NO'));
    log('OfflineAudioContext: ' + (window.OfflineAudioContext ? 'yes' : window.webkitOfflineAudioContext ? 'webkit only' : 'NO'));
    for (const r of [22050, 44100, 48000]) {
      try { new Off(2, r, r); log(`  offline ${r} Hz: ok`); } catch (e) { log(`  offline ${r} Hz: ${errText(e)}`); }
    }
    const a = document.createElement('audio');
    log('canPlayType audio/mp4 (AAC): "' + a.canPlayType('audio/mp4; codecs="mp4a.40.2"') + '"  x-m4a: "' + a.canPlayType('audio/x-m4a') + '"');

    log('');
    let meta = null;
    try { meta = await RechanStore.getMeta(); } catch (_) {}
    log('install: source=' + (meta && meta.source) + ' downloaded=' + !!(meta && meta.downloaded) + ' files=' + RechanStore.fileCount);
    log('media mode active: ' + RechanMedia.active);
    const keys = RechanStore.keys();
    const count = (p) => keys.filter((k) => k.startsWith(p)).length;
    log(`media in store: music=${count('media/music/')} dialog=${count('media/dialog/')} movies=${count('media/movies/')}`);
    const mk = musicKeys();
    if (!mk.length) { log('NO MUSIC FILES INSTALLED -> the pack has no converted music'); finish(); return; }
    const key = mk.find((k) => /china1_s00/.test(k)) || mk[0];
    const blob = RechanStore.getBlob(key);
    log('test file: ' + key + ' (' + blob.size + ' bytes, ' + (blob.type || 'no type') + ')');
    let data;
    try {
      data = await blob.arrayBuffer();
      const h = new Uint8Array(data, 0, 16);
      const ascii = String.fromCharCode(...h.slice(4, 12));
      log('header: ' + Array.from(h, (b) => b.toString(16).padStart(2, '0')).join(' ') + '  "' + ascii.replace(/[^\x20-\x7e]/g, '.') + '"' + (ascii.startsWith('ftyp') ? ' (MP4 ok)' : ' (NOT an MP4 header!)'));
    } catch (e) { log('read FAILED: ' + errText(e)); finish(); return; }

    log('');
    log('decode methods:');
    for (const m of ['offline:22050', 'offline:44100', 'offline:48000', 'live']) {
      const t0 = performance.now();
      try {
        const buf = await RechanMedia.decodeMethod(data, m);
        const peak = peakOf(buf);
        log(`  ${m}: ok ${buf.length} frames ${buf.numberOfChannels}ch @${buf.sampleRate} Hz, ${buf.duration.toFixed(1)} s, peak ${peak}${peak === 0 ? ' SILENT!' : ''}, ${Math.round(performance.now() - t0)} ms`);
      } catch (e) {
        log(`  ${m}: FAILED ${errText(e)} (${Math.round(performance.now() - t0)} ms)`);
      }
    }
    log('');
    log('what the game uses (decodeAudio):');
    try {
      const d = await RechanMedia.decodeAudio(key.slice('media/'.length), 22050, true);
      log('  ' + (d ? `ok ${d.frames} frames ${d.channels}ch @${d.rate} Hz` : 'returned nothing'));
    } catch (e) { log('  threw ' + errText(e)); }
    finish();
  }

  function finish() {
    log('');
    log('engine requests so far:');
    const calls = RechanMedia.calls;
    log(calls.length ? '  ' + calls.join('\n  ') : '  (none: start a level first, then open this test from ☰ → Options)');
    log('decode errors:');
    const errs = RechanMedia.errors;
    log(errs.length ? '  ' + errs.join('\n  ') : '  (none)');
    if (window.Module && Module.HEAPU8) log('engine memory: ' + Math.round(Module.HEAPU8.length / 1048576) + ' MB');
  }

  // Plays 6 s of the decoded music straight through Web Audio (no engine).
  async function listenWebAudio() {
    const key = musicKeys()[0];
    if (!key) { log('no music installed'); return; }
    try {
      const Live = window.AudioContext || window.webkitAudioContext;
      const ctx = new Live();
      await ctx.resume();
      const data = await RechanStore.getBlob(key).arrayBuffer();
      const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(data, res, rej); if (p && p.then) p.then(res, rej); });
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0, 0, 6);
      log(`▶ Web Audio: playing ${key} (state ${ctx.state}, ${ctx.sampleRate} Hz). Do you hear music?`);
      setTimeout(() => ctx.close().catch(() => {}), 7000);
    } catch (e) { log('▶ Web Audio FAILED: ' + errText(e)); }
  }

  // Plays the file with Safari's own <audio> player (no Web Audio).
  function listenElement() {
    const key = musicKeys()[0];
    if (!key) { log('no music installed'); return; }
    const url = URL.createObjectURL(RechanStore.getBlob(key));
    const el = new Audio(url);
    el.onerror = () => log('▶ <audio> error code ' + (el.error && el.error.code));
    el.onplaying = () => log(`▶ <audio>: playing ${key} (${el.duration.toFixed(1)} s). Do you hear music?`);
    el.play().catch((e) => log('▶ <audio> play FAILED: ' + errText(e)));
    setTimeout(() => { el.pause(); URL.revokeObjectURL(url); }, 6000);
  }

  function open() {
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'sheet';
      panel.id = 'audiotest';
      panel.innerHTML = `<div class="sheet-body">
        <h2>Prueba de sonido / Audio test</h2>
        <div class="row wrap">
          <button class="btn primary" data-a="run">Ejecutar prueba</button>
          <button class="btn" data-a="wa">▶ Escuchar (Web Audio)</button>
          <button class="btn" data-a="el">▶ Escuchar (&lt;audio&gt;)</button>
        </div>
        <pre class="audiotest-out"></pre>
        <div class="row wrap">
          <button class="btn" data-a="copy">Copiar resultados</button>
          <button class="btn" data-a="close">Cerrar</button>
        </div></div>`;
      document.body.appendChild(panel);
      out = panel.querySelector('pre');
      panel.addEventListener('click', async (e) => {
        const a = e.target && e.target.dataset && e.target.dataset.a;
        if (a === 'run') run();
        else if (a === 'wa') listenWebAudio();
        else if (a === 'el') listenElement();
        else if (a === 'copy') {
          try { await navigator.clipboard.writeText(lines.join('\n')); e.target.textContent = '✓ Copiado'; }
          catch (_) { const r = document.createRange(); r.selectNodeContents(out); getSelection().removeAllRanges(); getSelection().addRange(r); e.target.textContent = 'Seleccionado: copia con el menú'; }
        }
        else if (a === 'close') panel.classList.add('hidden');
      });
    }
    panel.classList.remove('hidden');
    run();
  }

  // 5 taps on any "Version …" line within 3 s.
  function wire() {
    let taps = [];
    document.addEventListener('click', (e) => {
      if (!e.target.closest || !e.target.closest('.version-text')) return;
      const now = Date.now();
      taps = taps.filter((t) => now - t < 3000).concat(now);
      if (taps.length >= 5) { taps = []; open(); }
    });
    if (new URLSearchParams(location.search).has('audiotest')) setTimeout(open, 1500);
  }

  return { open, run, wire };
})();
