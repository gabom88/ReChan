// touch.js — configurable on-screen controller for phones and tablets.
//
// Landscape and portrait each have their own layout (in portrait the game
// sits at the top and the controls below it, handheld-style). Every control
// can be moved, resized or hidden from the in-app editor; layouts, opacity
// and the d-pad/stick choice are saved in localStorage. Pressed state is
// merged with physical gamepads by input.js, so the engine just sees a
// standard pad (no engine changes needed for touch).
//
// The d-pad is GBoy-JS's 3D "model B" cross (js/dpad-gemuboy.js). Action
// buttons are neutral round buttons showing what they do (fist = punch,
// foot = kick, ...) instead of PlayStation symbols.
'use strict';

const RechanTouch = (() => {
  const STORAGE_KEY = 'rechan.touch.v2';
  const B = RechanInput.BTN;

  // 24x24 line icons (stroke = currentColor).
  const ICONS = {
    jump: '<path d="M12 3.5 6.5 10h3.5v5h4v-5h3.5z" fill="currentColor" stroke="none"/><path d="M5 20.5h14"/><path d="M8 17.5h8" opacity=".6"/>',
    punch: '<path d="M7 10.5V7.8a1.8 1.8 0 0 1 3.6 0v2.4M10.6 10.2V6.6a1.8 1.8 0 0 1 3.6 0v3.6M14.2 10.2V7.6a1.8 1.8 0 0 1 3.6 0v4.6"/><path d="M7 10.5c-1.4 0-2.4 1-2.4 2.4v1.6c0 3.3 2.7 6 6 6h2.8c2.4 0 4.4-2 4.4-4.4v-4"/><path d="M7 13.4h4.2a1.6 1.6 0 0 0 0-3.2H7"/>',
    kick: '<path d="M7.5 2.8h5.2v8.7l6.1 2.6c.9.4 1.5 1.3 1.5 2.3v2.1H7.5z"/><path d="M7.5 18.5h12.8"/><path d="M12.7 7.5h-2.6" opacity=".6"/>',
    grab: '<path d="M7.3 12.2V6.3a1.5 1.5 0 0 1 3 0v5.2M10.3 11V4.6a1.5 1.5 0 0 1 3 0V11M13.3 11V5.6a1.5 1.5 0 0 1 3 0v6"/><path d="M16.3 11.6V8.3a1.5 1.5 0 0 1 3 0v5.9a7 7 0 0 1-7 7h-.8a6 6 0 0 1-5.1-2.8l-2.6-4.2a1.5 1.5 0 0 1 2.5-1.6l1 1.5"/>',
    counter: '<path d="M12 3 19 6v5.2c0 4.6-3 8-7 9.8-4-1.8-7-5.2-7-9.8V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    roll: '<path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7"/><path d="M19.8 3.8v5h-5"/>',
    status: '<path d="M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4C19 15.6 12 20 12 20z"/>',
    strafe: '<path d="M3.5 12h17M7.5 8 3.5 12l4 4M16.5 8l4 4-4 4"/>',
    start: '<path d="M9 7v10M15 7v10" stroke-width="2.6"/>',
    select: '<path d="M5 8h14M5 12h14M5 16h14"/>',
  };

  function iconSvg(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  // x/y: centre as a fraction of the viewport; size: fraction of the
  // viewport's shorter side. bind: engine button index, or 'LT'/'RT' axes.
  const CONTROL_DEFS = [
    { id: 'dpad',   type: 'dpad' },
    { id: 'stick',  type: 'stick' },
    { id: 'jump',   type: 'button', bind: B.A,    icon: 'jump',    label: 'jump' },
    { id: 'grab',   type: 'button', bind: B.B,    icon: 'grab',    label: 'grab' },
    { id: 'punch',  type: 'button', bind: B.X,    icon: 'punch',   label: 'punch', group: 'normal' },
    { id: 'kick',   type: 'button', bind: B.Y,    icon: 'kick',    label: 'kick',  group: 'normal' },
    { id: 'l1',     type: 'button', bind: B.LB,   icon: 'counter', label: 'counter', minor: true },
    { id: 'r1',     type: 'button', bind: B.RB,   icon: 'roll',    label: 'roll',    minor: true },
    { id: 'l2',     type: 'button', bind: 'LT',   icon: 'status',  label: 'status',  minor: true },
    { id: 'r2',     type: 'button', bind: 'RT',   icon: 'strafe',  label: 'strafe',  minor: true },
    { id: 'select', type: 'button', bind: B.BACK, icon: 'select',  label: 'select',  small: true },
    { id: 'start',  type: 'button', bind: B.START, icon: 'start',  label: 'start',   small: true },
  ];
  // "Direct attacks" control mode: one button per move of the combo tree
  // (punches 1-7, kicks 1-7). Each press also presses punch/kick, and tells
  // the engine which move to use (RcWebInput.directMove, 1-14).
  for (let i = 1; i <= 7; i++) {
    CONTROL_DEFS.push({ id: 'p' + i, type: 'button', bind: B.X, icon: 'punch', label: 'punch', num: i, direct: i, group: 'direct' });
  }
  for (let i = 1; i <= 7; i++) {
    CONTROL_DEFS.push({ id: 'k' + i, type: 'button', bind: B.Y, icon: 'kick', label: 'kick', num: i, direct: 7 + i, group: 'direct' });
  }
  // Specials (third row): back punch, heavy punch, special, back kick, heavy kick.
  const SPECIALS = [
    { id: 'sbp', bind: B.X, icon: 'punch', label: 'backPunch',  badge: '↺', direct: 15 },
    { id: 'shp', bind: B.X, icon: 'punch', label: 'heavyPunch', badge: '!', direct: 16 },
    { id: 'ssp', bind: B.X, icon: 'punch', label: 'special',    badge: '★', direct: 17 },
    { id: 'sbk', bind: B.Y, icon: 'kick',  label: 'backKick',   badge: '↺', direct: 18 },
    { id: 'shk', bind: B.Y, icon: 'kick',  label: 'heavyKick',  badge: '!', direct: 19 },
    { id: 'srk', bind: B.Y, icon: 'kick',  label: 'rollKick',   badge: '⟳', direct: 20 },
    { id: 'sgk', bind: B.Y, icon: 'kick',  label: 'rollKickOnly', badge: '↯', direct: 21 },
  ];
  for (const sp of SPECIALS) CONTROL_DEFS.push(Object.assign({ type: 'button', group: 'direct', num: sp.badge }, sp));

  const DEFAULT_LAYOUTS = {
    landscape: {
      dpad:   { x: 0.15, y: 0.67, size: 0.40, visible: true },
      stick:  { x: 0.15, y: 0.67, size: 0.40, visible: false },
      jump:   { x: 0.86, y: 0.83, size: 0.16, visible: true },
      grab:   { x: 0.95, y: 0.64, size: 0.16, visible: true },
      punch:  { x: 0.77, y: 0.64, size: 0.16, visible: true },
      kick:   { x: 0.86, y: 0.45, size: 0.16, visible: true },
      l1:     { x: 0.06, y: 0.31, size: 0.12, visible: true },
      r1:     { x: 0.94, y: 0.27, size: 0.12, visible: true },
      l2:     { x: 0.06, y: 0.12, size: 0.12, visible: true },
      r2:     { x: 0.94, y: 0.11, size: 0.12, visible: true },
      select: { x: 0.40, y: 0.09, size: 0.10, visible: true },
      start:  { x: 0.60, y: 0.09, size: 0.10, visible: true },
    },
    // The game occupies the top 4:3 band (see .portrait-play in app.css).
    portrait: {
      dpad:   { x: 0.26, y: 0.72, size: 0.44, visible: true },
      stick:  { x: 0.26, y: 0.72, size: 0.44, visible: false },
      jump:   { x: 0.75, y: 0.81, size: 0.19, visible: true },
      grab:   { x: 0.90, y: 0.71, size: 0.19, visible: true },
      punch:  { x: 0.60, y: 0.71, size: 0.19, visible: true },
      kick:   { x: 0.75, y: 0.61, size: 0.19, visible: true },
      l1:     { x: 0.30, y: 0.50, size: 0.15, visible: true },
      r1:     { x: 0.70, y: 0.50, size: 0.15, visible: true },
      l2:     { x: 0.10, y: 0.50, size: 0.15, visible: true },
      r2:     { x: 0.90, y: 0.50, size: 0.15, visible: true },
      select: { x: 0.40, y: 0.93, size: 0.12, visible: true },
      start:  { x: 0.60, y: 0.93, size: 0.12, visible: true },
    },
  };
  // Direct-attack rows: punches on top, kicks below.
  for (let i = 0; i < 7; i++) {
    // Landscape: between the d-pad and the jump/grab buttons, lower half.
    DEFAULT_LAYOUTS.landscape['p' + (i + 1)] = { x: 0.33 + i * 0.058, y: 0.70, size: 0.115, visible: true };
    DEFAULT_LAYOUTS.landscape['k' + (i + 1)] = { x: 0.33 + i * 0.058, y: 0.88, size: 0.115, visible: true };
    // Portrait: two full-width rows under the shoulder buttons.
    DEFAULT_LAYOUTS.portrait['p' + (i + 1)] = { x: 0.08 + i * 0.14, y: 0.585, size: 0.125, visible: true };
    DEFAULT_LAYOUTS.portrait['k' + (i + 1)] = { x: 0.08 + i * 0.14, y: 0.655, size: 0.125, visible: true };
  }
  ['sbp', 'shp', 'ssp', 'sbk', 'shk', 'srk', 'sgk'].forEach((id, i) => {
    DEFAULT_LAYOUTS.landscape[id] = { x: 0.384 + i * 0.058, y: 0.24, size: 0.105, visible: true };
    DEFAULT_LAYOUTS.portrait[id] = { x: 0.08 + i * 0.14, y: 0.725, size: 0.125, visible: true };
  });
  // In direct mode the portrait d-pad and jump/grab move down to make room.
  const DIRECT_OVERRIDES = {
    portrait: {
      dpad:  { x: 0.22, y: 0.865, size: 0.30 },
      stick: { x: 0.22, y: 0.865, size: 0.30 },
      jump:  { x: 0.66, y: 0.875, size: 0.17 },
      grab:  { x: 0.86, y: 0.835, size: 0.17 },
      select: { x: 0.43, y: 0.965, size: 0.08 },
      start:  { x: 0.57, y: 0.965, size: 0.08 },
    },
    landscape: {},
  };

  const DEFAULT_SETTINGS = { opacity: 0.7, mode: 'dpad', haptics: true, attacks: 'normal' };

  let layouts = {};
  let settings = {};
  let layer = null;
  let editing = false;
  let selectedId = null;
  let shown = false;
  let t = (k) => k;
  const elements = new Map();
  const pointers = new Map(); // pointerId -> { id, ... }
  let onSelect = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Orientation comes from the screen, not from the layer's size: on iOS a
  // layout that overflowed during a rotation could widen the layout viewport
  // (and the fixed layer with it), which then kept selecting the landscape
  // layout in portrait with oversized controls.
  const portraitQuery = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  function orientation() {
    if (portraitQuery) return portraitQuery.matches ? 'portrait' : 'landscape';
    return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
  }

  // Whether the current attack mode uses this control at all.
  function inMode(c) {
    if (c.group === 'normal') return settings.attacks !== 'direct';
    if (c.group === 'direct') return settings.attacks === 'direct';
    return true;
  }

  // Control definition merged with the current orientation's placement.
  // Direct mode keeps its own layout (key prefix "d:") so moving a control
  // in one mode does not disturb the other.
  function controls() {
    const o = orientation();
    const layout = layouts[o];
    const direct = settings.attacks === 'direct';
    return CONTROL_DEFS.map((d) => {
      const place = Object.assign({}, layout[d.id]);
      if (direct && DIRECT_OVERRIDES[o][d.id]) Object.assign(place, DIRECT_OVERRIDES[o][d.id], layout['d:' + d.id] || {});
      const c = Object.assign({}, d, place);
      c.active = c.visible && inMode(c);
      return c;
    });
  }
  function placeKey(id) {
    const o = orientation();
    return (settings.attacks === 'direct' && DIRECT_OVERRIDES[o][id]) ? 'd:' + id : id;
  }
  function find(id) { return controls().find((c) => c.id === id) || null; }

  function load() {
    layouts = clone(DEFAULT_LAYOUTS);
    settings = { ...DEFAULT_SETTINGS };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) {
        Object.assign(settings, saved.settings || {});
        for (const o of ['landscape', 'portrait']) {
          const so = (saved.layouts || {})[o] || {};
          for (const id in so) {
            if (layouts[o][id]) Object.assign(layouts[o][id], so[id]);
            else if (id.startsWith('d:')) layouts[o][id] = so[id];
          }
        }
      }
    } catch (_) { /* corrupt or blocked storage: use defaults */ }
    applyMode();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, layouts })); } catch (_) { /* ignore */ }
  }

  function applyMode() {
    for (const o of ['landscape', 'portrait']) {
      layouts[o].dpad.visible = settings.mode !== 'stick';
      layouts[o].stick.visible = settings.mode === 'stick';
    }
  }

  // All geometry is relative to the touch layer itself, never to the window:
  // on iOS Safari the fixed layer can be offset from / sized differently to
  // window.inner* (toolbars, standalone status bar), which shifted the touch
  // areas away from the drawn buttons.
  function layerRect() {
    return layer ? layer.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }
  function W() { return (layer && layer.clientWidth) || layerRect().width || window.innerWidth; }
  function H() { return (layer && layer.clientHeight) || layerRect().height || window.innerHeight; }
  function lx(e) { return e.clientX - layerRect().left; }
  function ly(e) { return e.clientY - layerRect().top; }

  function unit() { return Math.min(W(), H()); }

  function build() {
    layer.innerHTML = '';
    elements.clear();
    for (const c of CONTROL_DEFS) {
      const el = document.createElement('div');
      el.className = 'tc tc-' + c.type + (c.minor ? ' tc-minor' : '') + (c.small ? ' tc-small' : '');
      el.dataset.id = c.id;
      if (c.type === 'stick') {
        el.innerHTML = '<div class="tc-knob"></div>';
      } else if (c.type === 'dpad') {
        el.classList.add('ctrl-dpad');
        el.dataset.st = 'rest';
        el.innerHTML = (typeof DpadModelB !== 'undefined') ? DpadModelB.markup() : '';
      } else {
        // Icon only; the action name stays available to screen readers.
        if (c.num) {
          el.classList.add('tc-direct');
          el.innerHTML = `<span class="tc-icon">${iconSvg(c.icon)}</span><span class="tc-num">${c.num}</span>`;
          el.setAttribute('aria-label', typeof c.num === 'number' ? t('touch.' + c.label) + ' ' + c.num : t('touch.' + c.label));
        } else {
          el.innerHTML = `<span class="tc-icon">${iconSvg(c.icon)}</span>`;
          el.setAttribute('aria-label', t('touch.' + c.label));
        }
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
    for (const c of controls()) {
      const el = elements.get(c.id);
      if (!el) continue;
      const s = c.size * u;
      el.style.width = s + 'px';
      el.style.height = s + 'px';
      // Keep every control fully inside the layer so nothing can overflow
      // (and widen the page) while a rotation is in progress.
      const w = W(), hgt = H();
      el.style.left = Math.max(0, Math.min(w - s, c.x * w - s / 2)) + 'px';
      el.style.top = Math.max(0, Math.min(hgt - s, c.y * hgt - s / 2)) + 'px';
      el.style.fontSize = (s * 0.2) + 'px';
      el.style.display = c.active ? '' : 'none';
      el.classList.toggle('tc-selected', editing && c.id === selectedId);
    }
  }

  function controlAt(x, y, slop) {
    const u = unit();
    let best = null;
    let bestD = Infinity;
    for (const c of controls()) {
      if (!c.active) continue;
      const r = c.size * u / 2 * slop;
      const dx = (x - c.x * W()) / r;
      const dy = (y - c.y * H()) / r;
      const d = dx * dx + dy * dy;
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
    let dpadDirs = 0;
    let direct = 0;
    for (const p of pointers.values()) {
      const c = find(p.id);
      if (!c) continue;
      if (c.type === 'button') {
        if (c.bind === 'LT') axes[4] = 1;
        else if (c.bind === 'RT') axes[5] = 1;
        else if (c.direct) direct = c.direct; // punch/kick pulse added by input.js
        else buttons |= (1 << c.bind);
      } else if (c.type === 'stick') {
        axes[0] = p.ax || 0;
        axes[1] = p.ay || 0;
      } else if (c.type === 'dpad') {
        dpadDirs |= p.dirs || 0;
      }
    }
    buttons |= dpadDirs;
    RechanInput.touch.buttons = buttons;
    RechanInput.touch.axes = axes;
    if (direct !== RechanInput.touch.directMove) RechanInput.touch.directSince = performance.now();
    RechanInput.touch.directMove = direct;
    for (const [id, el] of elements) {
      let pressed = false;
      for (const p of pointers.values()) if (p.id === id) pressed = true;
      el.classList.toggle('tc-pressed', pressed);
    }
    const dpadEl = elements.get('dpad');
    if (dpadEl) {
      const st = {
        up: !!(dpadDirs & (1 << B.UP)), down: !!(dpadDirs & (1 << B.DOWN)),
        left: !!(dpadDirs & (1 << B.LEFT)), right: !!(dpadDirs & (1 << B.RIGHT)),
      };
      dpadEl.dataset.st = (typeof DpadModelB !== 'undefined') ? DpadModelB.key(st) : 'rest';
    }
  }

  function updateStick(p, c, x, y) {
    const r = c.size * unit() / 2;
    let dx = (x - c.x * W()) / r;
    let dy = (y - c.y * H()) / r;
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
    const dx = x - c.x * W();
    const dy = y - c.y * H();
    const dead = c.size * unit() * 0.1;
    let dirs = 0;
    if (Math.hypot(dx, dy) > dead) {
      const a = Math.atan2(dy, dx) * 180 / Math.PI; // 0 = right, 90 = down
      if (a > -67.5 && a < 67.5) dirs |= 1 << B.RIGHT;
      if (a > 22.5 && a < 157.5) dirs |= 1 << B.DOWN;
      if (a > 112.5 || a < -112.5) dirs |= 1 << B.LEFT;
      if (a > -157.5 && a < -22.5) dirs |= 1 << B.UP;
    }
    if (dirs !== p.dirs && dirs) buzz();
    p.dirs = dirs;
  }

  // --- play mode pointer handling ---
  function onDown(e) {
    if (editing) return editDown(e);
    const c = controlAt(lx(e), ly(e), 1.2);
    if (!c) return;
    e.preventDefault();
    try { layer.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const p = { id: c.id };
    pointers.set(e.pointerId, p);
    if (c.type === 'stick') updateStick(p, c, lx(e), ly(e));
    else if (c.type === 'dpad') updateDpad(p, c, lx(e), ly(e));
    else buzz();
    recompute();
  }

  function onMove(e) {
    if (editing) return editMove(e);
    const p = pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const c = find(p.id);
    if (!c) return;
    if (c.type === 'stick') updateStick(p, c, lx(e), ly(e));
    else if (c.type === 'dpad') updateDpad(p, c, lx(e), ly(e));
    else {
      // Let a thumb slide across the action buttons (e.g. punch -> kick).
      // Direct-attack buttons never slide: each one is a deliberate press.
      const over = controlAt(lx(e), ly(e), 1.0);
      if (over && over.type === 'button' && over.id !== p.id && !over.direct && !c.direct) { p.id = over.id; buzz(); }
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
    const c = controlAt(lx(e), ly(e), 1.1);
    selectedId = c ? c.id : null;
    if (c) {
      drag = { pointerId: e.pointerId, id: c.id,
               ox: lx(e) - c.x * W(), oy: ly(e) - c.y * H() };
      try { layer.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }
    layout();
    if (onSelect) onSelect(selectedId ? find(selectedId) : null);
  }
  function editMove(e) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    const o = orientation();
    const key = placeKey(drag.id);
    if (!layouts[o][key]) { const f = find(drag.id); layouts[o][key] = { x: f.x, y: f.y, size: f.size, visible: f.visible }; }
    const place = layouts[o][key];
    place.x = Math.min(0.98, Math.max(0.02, (lx(e) - drag.ox) / W()));
    place.y = Math.min(0.98, Math.max(0.02, (ly(e) - drag.oy) / H()));
    layout();
  }
  function editUp(e) {
    if (drag && drag.pointerId === e.pointerId) { drag = null; save(); }
  }

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
    // Re-layout whenever the layer's real size changes. iOS fires "resize"
    // (and "orientationchange") before the rotation has settled, so layout
    // computed then used the old size/orientation and stayed wrong; a
    // ResizeObserver fires once the new size is actually applied.
    let lastOrientation = orientation();
    const relayout = () => {
      const o = orientation();
      if (o !== lastOrientation) {
        // Orientation flips swap layouts: drop presses that belonged to the old one.
        lastOrientation = o;
        pointers.clear();
        recompute();
      }
      layout();
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(relayout).observe(layer);
    const settle = () => { relayout(); setTimeout(relayout, 250); setTimeout(relayout, 600); };
    window.addEventListener('resize', settle);
    window.addEventListener('orientationchange', settle);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', settle);
    if (portraitQuery && portraitQuery.addEventListener) portraitQuery.addEventListener('change', settle);
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
    if (callbacks) onSelect = callbacks.onSelect || null;
    if (editing) show(true);
    layout();
  }

  function updateSelected(changes) {
    if (!selectedId) return;
    const o = orientation();
    const key = placeKey(selectedId);
    if (!layouts[o][key]) { const f = find(selectedId); layouts[o][key] = { x: f.x, y: f.y, size: f.size, visible: f.visible }; }
    Object.assign(layouts[o][key], changes);
    save();
    layout();
  }

  function setSetting(key, value) {
    settings[key] = value;
    if (key === 'mode') applyMode();
    save();
    layout();
  }

  // Resets the layout of the current orientation (and the shared settings).
  function reset() {
    const o = orientation();
    layouts[o] = clone(DEFAULT_LAYOUTS[o]);
    const attacks = settings.attacks;
    settings = { ...DEFAULT_SETTINGS, attacks };
    applyMode();
    save();
    build();
  }

  function showAll() {
    const layout_ = layouts[orientation()];
    for (const id in layout_) {
      if (id === 'stick' || id === 'dpad') continue;
      layout_[id].visible = true;
    }
    applyMode();
    save();
    layout();
  }

  function relabel(translate) {
    t = translate;
    build();
  }

  return {
    init, show, setEditing, updateSelected, setSetting, reset, relabel, showAll, orientation,
    get settings() { return settings; },
    get shown() { return shown; },
    get editing() { return editing; },
    get selected() { return selectedId ? find(selectedId) : null; },
  };
})();
