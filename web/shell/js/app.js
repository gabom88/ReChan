// app.js — launcher, settings, PWA wiring and engine bootstrap.
'use strict';

(() => {
  const t = RechanI18n.t;
  const $ = (id) => document.getElementById(id);
  const PREFS_KEY = 'rechan.prefs.v1';

  const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches;
  const isIOS = /iP(hone|ad|od)/.test(navigator.platform) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
    /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const prefs = { touch: 'auto', scale: 1 };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (_) { /* ignore */ }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* ignore */ } }

  // Last engine log lines, included in "Copy diagnostics".
  const logRing = [];
  function logLine(s) {
    logRing.push(String(s));
    if (logRing.length > 200) logRing.shift();
  }

  let playing = false;
  let engineLoaded = false;
  let touchHiddenByPhysical = false;

  function fmtBytes(n) {
    if (!n && n !== 0) return '?';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }

  function showPanel(name) {
    for (const p of document.querySelectorAll('#launcher .panel')) p.classList.add('hidden');
    $('panel-' + name).classList.remove('hidden');
  }

  let toastTimer = 0;
  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 3500);
  }

  function showError(msg) {
    $('error-text').textContent = msg;
    showPanel('error');
  }

  async function refreshStorageInfo() {
    if (!navigator.storage || !navigator.storage.estimate) return;
    try {
      const est = await navigator.storage.estimate();
      $('storage-info').textContent = t('storage', { used: fmtBytes(est.usage), quota: fmtBytes(est.quota) });
    } catch (_) { /* ignore */ }
  }

  async function showReady() {
    const meta = await RechanStore.getMeta();
    $('assets-info').textContent = t('assetsInfo', {
      serial: (meta && meta.serial) || '?',
      files: RechanStore.fileCount,
      size: fmtBytes(RechanStore.totalBytes()),
    });
    showPanel('ready');
  }

  async function checkAssets() {
    showPanel('loading');
    try {
      await RechanStore.load();
      const meta = await RechanStore.getMeta();
      if (meta && RechanStore.fileCount > 0 && RechanStore.has('license.tim')) {
        await showReady();
      } else {
        showPanel('disc');
      }
    } catch (e) {
      console.error(e);
      showError(String(e && e.message || e));
    }
  }

  async function onDiscChosen(file) {
    if (!file) return;
    showPanel('extract');
    $('extract-bar').style.width = '0%';
    $('extract-status').textContent = t('scanning');
    $('extract-file').textContent = file.name + ' · ' + fmtBytes(file.size);
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    try {
      const meta = await RechanExtractor.extract(file, (p) => {
        if (p.phase === 'extract') {
          const pct = Math.floor((p.done / Math.max(p.total, 1)) * 100);
          $('extract-bar').style.width = pct + '%';
          $('extract-status').textContent = t('extracting', { pct });
          $('extract-file').textContent = p.current || '';
        } else if (p.phase === 'done') {
          $('extract-bar').style.width = '100%';
          $('extract-status').textContent = t('saving');
        }
      });
      await RechanStore.load();
      toast(t('extracted', { files: meta.files, size: fmtBytes(meta.bytes) }));
      await showReady();
    } catch (e) {
      console.error(e);
      showError(e instanceof RechanExtractor.ExtractError ? e.message : String(e && e.message || e));
    } finally {
      $('disc-input').value = '';
    }
  }

  // --- touch overlay visibility ---
  function updateTouchVisibility() {
    if (!playing || RechanTouch.editing) return;
    let show;
    if (prefs.touch === 'on') show = true;
    else if (prefs.touch === 'off') show = false;
    else show = isTouchDevice && !touchHiddenByPhysical;
    RechanTouch.show(show);
  }

  function updateRotateHint() {
    const portrait = window.innerHeight > window.innerWidth;
    $('rotate-hint').classList.toggle('hidden', !(playing && isTouchDevice && portrait && !RechanTouch.editing));
  }

  // --- touch editor ---
  function openTouchEditor() {
    closeSettings();
    $('touch-editor').classList.remove('hidden');
    document.body.classList.add('editing-touch');
    const s = RechanTouch.settings;
    $('ed-opacity').value = s.opacity;
    $('ed-mode').value = s.mode;
    $('ed-labels').checked = !!s.labels;
    $('ed-haptics').checked = !!s.haptics;
    selectForEditor(null);
    RechanTouch.setEditing(true, { onSelect: selectForEditor });
  }

  function selectForEditor(c) {
    $('ed-selected').classList.toggle('disabled', !c);
    $('ed-name').textContent = c ? (c.label ? t('touch.' + c.label) + ' (' + c.sym + ')' : (c.sym || c.id)) : '—';
    if (c) $('ed-size').value = c.size;
  }

  function closeTouchEditor() {
    RechanTouch.setEditing(false);
    $('touch-editor').classList.add('hidden');
    document.body.classList.remove('editing-touch');
    if (playing) updateTouchVisibility(); else RechanTouch.show(false);
    updateRotateHint();
  }

  // --- settings sheet ---
  function openSettings() {
    $('opt-touch').value = prefs.touch;
    $('opt-scale').value = String(prefs.scale);
    $('opt-lang').value = RechanI18n.lang;
    $('opt-delete').classList.toggle('hidden', playing);
    refreshStorageInfo();
    $('settings').classList.remove('hidden');
  }
  function closeSettings() { $('settings').classList.add('hidden'); }

  async function toggleFullscreen() {
    const el = document.documentElement;
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' });
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      } else {
        toast(t('fullscreenUnsupported'));
      }
    } catch (_) {
      toast(t('fullscreenUnsupported'));
    }
  }

  // --- diagnostics ---
  function buildDiagnostics() {
    let state = '(engine not running)';
    if (window.Module && Module._rcweb_debug_dump && Module.rcInputPtr) {
      const ptr = Module._rcweb_debug_dump();
      if (ptr) { state = Module.UTF8ToString(ptr); Module._free(ptr); }
    }
    return [
      '### ReChan web diagnostics',
      'url: ' + location.href,
      'ua: ' + navigator.userAgent,
      'screen: ' + innerWidth + 'x' + innerHeight + ' @' + devicePixelRatio,
      'pads: ' + (navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean).map((p) => p.id).join(' | ') : '-'),
      'touch: ' + RechanTouch.shown,
      '',
      state,
      '--- last log lines ---',
      logRing.join('\n'),
    ].join('\n');
  }

  async function copyDiagnostics() {
    const text = buildDiagnostics();
    console.log(text);
    try {
      await navigator.clipboard.writeText(text);
      toast(t('diagCopied'));
    } catch (_) {
      const w = window.open('', '_blank');
      if (w) { w.document.body.innerHTML = '<pre></pre>'; w.document.querySelector('pre').textContent = text; }
      toast(t('diagShown'));
    }
  }

  // --- test mode (?autotest=LEVEL&minutes=N[&queue=1,2,3]) ---
  const params = new URLSearchParams(location.search);
  const testLevel = params.get('autotest');
  const testMode = testLevel !== null;

  function testArguments() {
    const fps = 30;
    const minutes = Math.max(0.25, parseFloat(params.get('minutes') || '3'));
    const args = ['--autotest', String(parseInt(testLevel, 10) || 0),
                  '--frames', String(Math.round(minutes * 60 * fps)),
                  '--fps', String(fps), '--fight', '--tour', String(parseInt(params.get('tour') || '450', 10))];
    if (params.get('petal')) args.push('--petal', params.get('petal'));
    if (params.get('dump')) args.push('--dump-interval', params.get('dump'));
    return args;
  }

  function showTestBanner(text, cls) {
    const el = $('test-banner');
    el.textContent = text;
    el.className = cls || '';
  }

  function startTestFromMenu() {
    const level = $('test-level').value;
    const minutes = $('test-minutes').value;
    const queue = level === 'all' ? [0, 1, 2, 3, 4, 5, 6] : [parseInt(level, 10)];
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('autotest', String(queue[0]));
    url.searchParams.set('minutes', minutes);
    if (queue.length > 1) url.searchParams.set('queue', queue.slice(1).join(','));
    location.href = url.toString();
  }

  function onAutotestDone(exitCode, stuck) {
    const summary = { level: testLevel, exitCode, stuck };
    let results = [];
    try { results = JSON.parse(sessionStorage.getItem('rechan.testResults') || '[]'); } catch (_) { /* ignore */ }
    results.push(summary);
    try { sessionStorage.setItem('rechan.testResults', JSON.stringify(results)); } catch (_) { /* ignore */ }
    window.rcAutotestResult = summary;
    const stuckLines = logRing.filter((l) => l.includes('[AnimWatch]')).join('\n');
    const queue = (params.get('queue') || '').split(',').filter(Boolean);
    const anyFail = results.some((r) => r.stuck > 0 || r.exitCode !== 0);
    const lines = results.map((r) => `nivel ${r.level}: ${r.stuck > 0 ? r.stuck + ' atasco(s)' : 'ok'} (exit ${r.exitCode})`);
    showTestBanner((anyFail ? t('testFail', { n: results.reduce((a, r) => a + r.stuck, 0) }) : t('testOk')) +
      '\n' + lines.join('\n') + (stuckLines ? '\n' + stuckLines : ''), anyFail ? 'fail' : 'ok');
    if (queue.length) {
      const url = new URL(location.href);
      url.searchParams.set('autotest', queue[0]);
      url.searchParams.set('chain', '1');
      url.searchParams.set('queue', queue.slice(1).join(','));
      if (!queue.slice(1).length) url.searchParams.delete('queue');
      setTimeout(() => { location.href = url.toString(); }, 1500);
    }
  }

  // --- engine ---
  function hasWebGL2() {
    try { return !!document.createElement('canvas').getContext('webgl2'); } catch (_) { return false; }
  }

  function startEngine() {
    if (engineLoaded) return;
    if (!hasWebGL2()) { showError(t('noWebgl')); return; }
    engineLoaded = true;
    playing = true;
    document.body.classList.add('playing');
    $('launcher').classList.add('hidden');
    $('menu-btn').classList.remove('hidden');

    const canvas = $('canvas');
    RechanInput.attach(canvas);
    RechanInput.setRenderScale(prefs.scale);
    RechanInput.start();
    updateTouchVisibility();
    updateRotateHint();

    if (!isIOS && isTouchDevice && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }

    if (testMode) {
      // A fresh test run (not a continuation of a level queue) starts a new report.
      if (!params.has('chain')) {
        try { sessionStorage.removeItem('rechan.testResults'); } catch (_) { /* ignore */ }
      }
      showTestBanner(t('testRunning', { level: testLevel }));
    }

    window.Module = {
      arguments: testMode ? testArguments() : [],
      rcOnAutotestDone: onAutotestDone,
      canvas,
      rcAssets: RechanStore.engineApi,
      locateFile: (path) => path,
      print: (s) => { logLine(s); console.log(s); },
      printErr: (s) => { logLine(s); console.warn(s); },
      rcSetTitle: () => {},
      rcSetPointerLock: (want) => RechanInput.setPointerLock(want && !isTouchDevice),
      rcSetFullscreen: (want) => {
        const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
        if (want !== fs) toggleFullscreen();
      },
      rcOnFatal: (msg) => {
        playing = false;
        document.body.classList.remove('playing');
        $('launcher').classList.remove('hidden');
        showError(t('fatal', { msg }));
      },
      onAbort: (what) => console.error('[ReChan] abort:', what),
    };
    const script = document.createElement('script');
    script.src = 'rechan.js';
    script.async = true;
    document.body.appendChild(script);
  }

  // --- wiring ---
  function wire() {
    RechanI18n.apply();
    RechanTouch.init($('touch-layer'), t);
    $('ios-hint').classList.toggle('hidden', !(isIOS && !isStandalone));

    $('disc-input').addEventListener('change', (e) => onDiscChosen(e.target.files && e.target.files[0]));
    $('error-retry').addEventListener('click', () => { showPanel('disc'); $('disc-input').click(); });
    $('play-btn').addEventListener('click', startEngine);
    $('touch-config-btn').addEventListener('click', openTouchEditor);
    $('settings-btn').addEventListener('click', openSettings);
    $('menu-btn').addEventListener('click', openSettings);
    $('settings-close').addEventListener('click', closeSettings);
    $('settings').addEventListener('click', (e) => { if (e.target === $('settings')) closeSettings(); });

    $('opt-touch').addEventListener('change', (e) => {
      prefs.touch = e.target.value; savePrefs();
      touchHiddenByPhysical = false;
      updateTouchVisibility();
    });
    $('opt-scale').addEventListener('change', (e) => {
      prefs.scale = parseFloat(e.target.value) || 1; savePrefs();
      RechanInput.setRenderScale(prefs.scale);
    });
    $('opt-lang').addEventListener('change', (e) => {
      RechanI18n.setLang(e.target.value);
      RechanTouch.relabel(t);
      if (!playing && !$('panel-ready').classList.contains('hidden')) showReady();
      refreshStorageInfo();
    });
    $('opt-edit-touch').addEventListener('click', openTouchEditor);
    $('opt-fullscreen').addEventListener('click', toggleFullscreen);
    $('opt-diag').addEventListener('click', copyDiagnostics);
    $('test-start').addEventListener('click', startTestFromMenu);
    // F8 copies diagnostics without leaving the game.
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F8') { e.preventDefault(); copyDiagnostics(); }
    });
    $('opt-delete').addEventListener('click', async () => {
      if (!confirm(t('confirmDelete'))) return;
      await RechanStore.clear();
      closeSettings();
      checkAssets();
    });

    $('ed-size').addEventListener('input', (e) => RechanTouch.updateSelected({ size: parseFloat(e.target.value) }));
    $('ed-hide').addEventListener('click', () => { RechanTouch.updateSelected({ visible: false }); selectForEditor(null); });
    $('ed-opacity').addEventListener('input', (e) => RechanTouch.setSetting('opacity', parseFloat(e.target.value)));
    $('ed-mode').addEventListener('change', (e) => RechanTouch.setSetting('mode', e.target.value));
    $('ed-labels').addEventListener('change', (e) => RechanTouch.setSetting('labels', e.target.checked));
    $('ed-haptics').addEventListener('change', (e) => RechanTouch.setSetting('haptics', e.target.checked));
    $('ed-showall').addEventListener('click', () => RechanTouch.showAll());
    $('ed-reset').addEventListener('click', () => {
      RechanTouch.reset();
      const s = RechanTouch.settings;
      $('ed-opacity').value = s.opacity;
      $('ed-mode').value = s.mode;
      $('ed-labels').checked = !!s.labels;
      $('ed-haptics').checked = !!s.haptics;
      selectForEditor(null);
    });
    $('ed-done').addEventListener('click', closeTouchEditor);

    // Hide the overlay when a real pad or keyboard is used; show it again on touch.
    RechanInput.onPhysicalInput(() => {
      if (prefs.touch === 'auto' && !touchHiddenByPhysical && !RechanTouch.editing) {
        touchHiddenByPhysical = true;
        updateTouchVisibility();
      }
    });
    window.addEventListener('touchstart', () => {
      if (touchHiddenByPhysical) { touchHiddenByPhysical = false; updateTouchVisibility(); }
    }, { passive: true });

    window.addEventListener('resize', updateRotateHint);
    // Prevent pinch-zoom / double-tap zoom on iOS while playing.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => { if (playing) e.preventDefault(); });

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW:', e));
    }

    // ?autoplay skips the launcher when assets are present (handy from the home-screen icon).
    checkAssets().then(() => {
      if ((new URLSearchParams(location.search).has('autoplay') || testMode) &&
          !$('panel-ready').classList.contains('hidden')) startEngine();
    });
  }

  wire();
})();
