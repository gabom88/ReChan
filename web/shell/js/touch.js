// touch.js — configurable on-screen controller for phones and tablets.
//
// Every control can be moved, resized or hidden from the in-app editor; the
// layout, opacity and stick/d-pad choice are saved in localStorage. Pressed
// state is merged with physical gamepads by input.js, so the engine just sees
// a standard pad (no engine changes needed for touch).
'use strict';

const RechanTouch = (() => {
  const STORAGE_KEY = 'rechan.touch.v1';
  const B = RechanInput.BTN;

  // x/y: centre as a fraction of the viewport; size: fraction of the
  // viewport's shorter side. bind: engine button index, or 'LT'/'RT' axes.
  const DEFAULT_CONTROLS = [
    { id: 'stick',    type: 'stick', x: 0.15, y: 0.68, size: 0.40, visible: true },
    { id: 'dpad',     type: 'dpad',  x: 0.15, y: 0.68, size: 0.40, visible: false },
    { id: 'cross',    type: 'button', bind: B.A, sym: '✕', label: 'jump',    x: 0.86, y: 0.82, size: 0.15, visible: true, color: '#7fb2ff' },
    { id: 'circle',   type: 'button', bind: B.B, sym: '○', label: 'grab',    x: 0.95, y: 0.64, size: 0.15, visible: true, color: '#ff7f7f' },
    { id: 'square',   type: 'button', bind: B.X, sym: '□', label: 'punch',   x: 0.77, y: 0.64, size: 0.15, visible: true, color: '#ff9fe0' },
    { id: 'triangle', type: 'button', bind: B.Y, sym: '△', label: 'kick',    x: 0.86, y: 0.46, size: 0.15, visible: true, color: '#6fe0b0' },
    { id: 'l1',       type: 'button', bind: B.LB, sym: 'L1', label: 'counter', x: 0.07, y: 0.30, size: 0.12, visible: true, pill: true },
    { id: 'r1',       type: 'button', bind: B.RB, sym: 'R1', label: 'roll',    x: 0.93, y: 0.27, size: 0.12, visible: true, pill: true },
    { id: 'l2',       type: 'button', bind: 'LT', sym: 'L2', label: 'status',  x: 0.07, y: 0.13, size: 0.12, visible: true, pill: true },
    { id: 'r2',       type: 'button', bind: 'RT', sym: 'R2', label: 'strafe',  x: 0.93, y: 0.11, size: 0.12, visible: true, pill: true },
    { id: 'select',   type: 'button', bind: B.BACK, sym: 'SELECT', label: '', x: 0.40, y: 0.09, size: 0.09, visible: true, pill: true, small: true },
    { id: 'start',    type: 'button', bind: B.START, sym: 'START', label: '', x: 0.60, y: 0.09, size: 0.09, visible: true, pill: true, small: true },
  ];

  const DEFAULT_SETTINGS = { opacity: 0.55, mode: 'stick', haptics: true, autoHide: true, labels: true };

  let controls = [];
  let settings = {};
  let layer = null;
  let editing = false;
  let selectedId = null;
  let shown = false;
  let t = (k) => k;
  const elements = new Map();
  const pointers = new Map(); // pointerId -> { id, ... }
  let onEditDone = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    controls = clone(DEFAULT_CONTROLS);
    settings = { ...DEFAULT_SETTINGS };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) {
        Object.assign(settings, saved.settings || {});
        for (const c of controls) {
          const s = (saved.controls || {})[c.id];
          if (s) Object.assign(c, { x: s.x, y: s.y, size: s.size, visible: s.visible });
        }
      }
    } catch (_) { /* corrupt or blocked storage: use defaults */ }
    applyMode();
  }

  function save() {
    const data = { settings, controls: {} };
    for (const c of controls) data.controls[c.id] = { x: c.x, y: c.y, size: c.size, visible: c.visible };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) { /* ignore */ }
  }

  function applyMode() {
    const stick = controls.find((c) => c.id === 'stick');
    const dpad = controls.find((c) => c.id === 'dpad');
    stick.visible = settings.mode === 'stick';
    dpad.visible = settings.mode === 'dpad';
  }

  function unit() { return Math.min(window.innerWidth, window.innerHeight); }

  function build() {
    layer.innerHTML = '';
    elements.clear();
    for (const c of controls) {
      const el = document.createElement('div');
      el.className = 'tc tc-' + c.type + (c.pill ? ' tc-pill' : '') + (c.small ? ' tc-small' : '');
      el.dataset.id = c.id;
      if (c.type === 'stick') {
        el.innerHTML = '<div class="tc-knob"></div>';
      } else if (c.type === 'dpad') {
        el.innerHTML = '<div class="tc-dir tc-up">▲</div><div class="tc-dir tc-right">▶</div>' +
                       '<div class="tc-dir tc-down">▼</div><div class="tc-dir tc-left">◀</div>';
      } else {
        el.innerHTML = '<span class="tc-sym"></span><span class="tc-label"></span>';
        el.querySelector('.tc-sym').textContent = c.sym;
        el.querySelector('.tc-label').textContent = c.label ? t('touch.' + c.label) : '';
        if (c.color) el.style.setProperty('--tc-color', c.color);
      }
      layer.appendChild(el);
      elements.set(c.id, el);
    }
    layout();
  }

  function layout() {
    if (!layer) return;
    const u = unit();
    layer.style.setProperty('--tc-opacity', settings.opacity);
    layer.classList.toggle('tc-no-labels', !settings.labels);
    for (const c of controls) {
      const el = elements.get(c.id);
      if (!el) continue;
      const w = c.size * u * (c.pill ? 1.45 : 1);
      const h = c.size * u * (c.pill ? 0.62 : 1);
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      // Scale glyphs with the control so resized buttons stay legible.
      el.style.fontSize = (c.pill ? h * (c.small ? 0.5 : 0.36) : Math.min(w, h) * 0.24) + 'px';
      el.style.left = (c.x * window.innerWidth - w / 2) + 'px';
      el.style.top = (c.y * window.innerHeight - h / 2) + 'px';
      el.style.display = c.visible ? '' : 'none';
      el.classList.toggle('tc-selected', editing && c.id === selectedId);
    }
  }

  function controlAt(x, y, slop) {
    const u = unit();
    let best = null;
    let bestD = Infinity;
    for (const c of controls) {
      if (!c.visible) continue;
      const cx = c.x * window.innerWidth;
      const cy = c.y * window.innerHeight;
      const rx = c.size * u * (c.pill ? 1.45 : 1) / 2 * slop;
      const ry = c.size * u * (c.pill ? 0.62 : 1) / 2 * slop;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d <= 1 && d < bestD) { best = c; bestD = d; }
    }
    return best;
  }

  function buzz() {
    if (settings.haptics && navigator.vibrate) {
      try { navigator.vibrate(8); } catch (_) { /* ignore */ }
    }
  }

  // Recompute the merged pad state from every active pointer.
  function recompute() {
    let buttons = 0;
    const axes = [0, 0, 0, 0, 0, 0];
    for (const p of pointers.values()) {
      const c = controls.find((cc) => cc.id === p.id);
      if (!c) continue;
      if (c.type === 'button') {
        if (c.bind === 'LT') axes[4] = 1;
        else if (c.bind === 'RT') axes[5] = 1;
        else buttons |= (1 << c.bind);
      } else if (c.type === 'stick') {
        axes[0] = p.ax || 0;
        axes[1] = p.ay || 0;
      } else if (c.type === 'dpad') {
        buttons |= p.dirs || 0;
      }
    }
    RechanInput.touch.buttons = buttons;
    RechanInput.touch.axes = axes;
    for (const [id, el] of elements) {
      let pressed = false;
      for (const p of pointers.values()) if (p.id === id) pressed = true;
      el.classList.toggle('tc-pressed', pressed);
    }
  }

  function updateStick(p, c, x, y) {
    const u = unit();
    const r = c.size * u / 2;
    let dx = (x - c.x * window.innerWidth) / r;
    let dy = (y - c.y * window.innerHeight) / r;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    p.ax = Math.abs(dx) < 0.08 ? 0 : dx;
    p.ay = Math.abs(dy) < 0.08 ? 0 : dy;
    const knob = elements.get(c.id).querySelector('.tc-knob');
    knob.style.transform = `translate(${dx * 50}%, ${dy * 50}%)`;
  }

  function resetStickKnob(id) {
    const el = elements.get(id);
    const knob = el && el.querySelector('.tc-knob');
    if (knob) knob.style.transform = '';
  }

  function updateDpad(p, c, x, y) {
    const dx = x - c.x * window.innerWidth;
    const dy = y - c.y * window.innerHeight;
    const dead = c.size * unit() * 0.12;
    let dirs = 0;
    if (Math.hypot(dx, dy) > dead) {
      const a = Math.atan2(dy, dx) * 180 / Math.PI; // 0 = right, 90 = down
      if (a > -67.5 && a < 67.5) dirs |= 1 << B.RIGHT;
      if (a > 22.5 && a < 157.5) dirs |= 1 << B.DOWN;
      if (a > 112.5 || a < -112.5) dirs |= 1 << B.LEFT;
      if (a > -157.5 && a < -22.5) dirs |= 1 << B.UP;
    }
    if (dirs !== p.dirs) buzz();
    p.dirs = dirs;
  }

  // --- play mode pointer handling ---
  function onDown(e) {
    if (editing) return editDown(e);
    const c = controlAt(e.clientX, e.clientY, 1.25);
    if (!c) return;
    e.preventDefault();
    try { layer.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const p = { id: c.id };
    pointers.set(e.pointerId, p);
    if (c.type === 'stick') updateStick(p, c, e.clientX, e.clientY);
    else if (c.type === 'dpad') updateDpad(p, c, e.clientX, e.clientY);
    else buzz();
    recompute();
  }

  function onMove(e) {
    if (editing) return editMove(e);
    const p = pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const c = controls.find((cc) => cc.id === p.id);
    if (c.type === 'stick') updateStick(p, c, e.clientX, e.clientY);
    else if (c.type === 'dpad') updateDpad(p, c, e.clientX, e.clientY);
    else {
      // Let a thumb slide across face buttons (e.g. from ✕ onto □).
      const over = controlAt(e.clientX, e.clientY, 1.0);
      if (over && over.type === 'button' && over.id !== p.id) { p.id = over.id; buzz(); }
    }
    recompute();
  }

  function onUp(e) {
    if (editing) return editUp(e);
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    resetStickKnob(p.id);
    recompute();
  }

  // --- edit mode ---
  let drag = null;
  function editDown(e) {
    e.preventDefault();
    const c = controlAt(e.clientX, e.clientY, 1.1);
    selectedId = c ? c.id : null;
    if (c) {
      drag = { pointerId: e.pointerId, id: c.id,
               ox: e.clientX - c.x * window.innerWidth, oy: e.clientY - c.y * window.innerHeight };
      try { layer.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }
    layout();
    if (onSelect) onSelect(selectedId && controls.find((cc) => cc.id === selectedId));
  }
  function editMove(e) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    const c = controls.find((cc) => cc.id === drag.id);
    c.x = Math.min(0.98, Math.max(0.02, (e.clientX - drag.ox) / window.innerWidth));
    c.y = Math.min(0.98, Math.max(0.02, (e.clientY - drag.oy) / window.innerHeight));
    layout();
  }
  function editUp(e) {
    if (drag && drag.pointerId === e.pointerId) { drag = null; save(); }
  }

  let onSelect = null;

  function init(layerEl, translate) {
    layer = layerEl;
    t = translate || t;
    load();
    build();
    layer.addEventListener('pointerdown', onDown, { passive: false });
    layer.addEventListener('pointermove', onMove, { passive: false });
    layer.addEventListener('pointerup', onUp);
    layer.addEventListener('pointercancel', onUp);
    layer.addEventListener('lostpointercapture', onUp);
    // iOS: stop double-tap zoom, long-press callouts and rubber-banding.
    layer.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    layer.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('resize', layout);
  }

  function show(on) {
    shown = !!on;
    layer.classList.toggle('tc-hidden', !shown);
    RechanInput.touch.active = shown;
    if (!shown) { pointers.clear(); recompute(); }
  }

  function setEditing(on, callbacks) {
    editing = !!on;
    selectedId = null;
    pointers.clear();
    recompute();
    layer.classList.toggle('tc-editing', editing);
    if (callbacks) { onSelect = callbacks.onSelect || null; onEditDone = callbacks.onDone || null; }
    if (editing) show(true);
    layout();
  }

  function updateSelected(changes) {
    const c = controls.find((cc) => cc.id === selectedId);
    if (!c) return;
    Object.assign(c, changes);
    save();
    layout();
  }

  function setSetting(key, value) {
    settings[key] = value;
    if (key === 'mode') applyMode();
    save();
    layout();
  }

  function reset() {
    controls = clone(DEFAULT_CONTROLS);
    settings = { ...DEFAULT_SETTINGS };
    applyMode();
    save();
    build();
  }

  function relabel(translate) {
    t = translate;
    build();
  }

  function showAll() {
    for (const c of controls) {
      if (c.id === 'stick' || c.id === 'dpad') continue;
      c.visible = true;
    }
    applyMode();
    save();
    layout();
  }

  return {
    init, show, setEditing, updateSelected, setSetting, reset, relabel, showAll,
    get settings() { return settings; },
    get shown() { return shown; },
    get editing() { return editing; },
    get selected() { return controls.find((c) => c.id === selectedId) || null; },
  };
})();
