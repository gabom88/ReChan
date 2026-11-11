// input.js — keyboard, mouse, physical gamepads and the touch overlay,
// written straight into the engine's RcWebInput block (see
// vendor/libp3d/pddi/gles/glesweb.h for the layout).
'use strict';

const RechanInput = (() => {
  const OFF = {
    keys: 0, mouse: 512, mouseX: 520, mouseY: 524, scrollY: 528,
    padButtons: 532, padAxes: 536, padConnected: 560, focused: 561,
    pointerLocked: 562, touchActive: 563, canvasW: 564, canvasH: 568, directMove: 572,
  };

  // KeyboardEvent.code -> GLFW key code (p3d/keycode.h)
  const KEYMAP = {
    Space: 32, Quote: 39, Comma: 44, Minus: 45, Period: 46, Slash: 47,
    Semicolon: 59, Equal: 61, BracketLeft: 91, Backslash: 92, BracketRight: 93,
    Backquote: 96, IntlBackslash: 162,
    Escape: 256, Enter: 257, Tab: 258, Backspace: 259, Insert: 260, Delete: 261,
    ArrowRight: 262, ArrowLeft: 263, ArrowDown: 264, ArrowUp: 265,
    PageUp: 266, PageDown: 267, Home: 268, End: 269,
    CapsLock: 280, ScrollLock: 281, NumLock: 282, PrintScreen: 283, Pause: 284,
    NumpadDecimal: 330, NumpadDivide: 331, NumpadMultiply: 332,
    NumpadSubtract: 333, NumpadAdd: 334, NumpadEnter: 335, NumpadEqual: 336,
    ShiftLeft: 340, ControlLeft: 341, AltLeft: 342, MetaLeft: 343,
    ShiftRight: 344, ControlRight: 345, AltRight: 346, MetaRight: 347, ContextMenu: 348,
  };
  for (let i = 0; i < 26; i++) KEYMAP['Key' + String.fromCharCode(65 + i)] = 65 + i;
  for (let i = 0; i < 10; i++) { KEYMAP['Digit' + i] = 48 + i; KEYMAP['Numpad' + i] = 320 + i; }
  for (let i = 1; i <= 12; i++) KEYMAP['F' + i] = 289 + i;

  // Engine gamepad button indices (pddidev.h GamepadButton)
  const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, BACK: 6, START: 7, GUIDE: 8,
                L3: 9, R3: 10, UP: 11, RIGHT: 12, DOWN: 13, LEFT: 14 };
  // W3C "standard" gamepad mapping -> engine button
  const STD_TO_BTN = { 0: BTN.A, 1: BTN.B, 2: BTN.X, 3: BTN.Y, 4: BTN.LB, 5: BTN.RB,
                       8: BTN.BACK, 9: BTN.START, 10: BTN.L3, 11: BTN.R3,
                       12: BTN.UP, 13: BTN.DOWN, 14: BTN.LEFT, 15: BTN.RIGHT, 16: BTN.GUIDE };

  const keys = new Uint8Array(512);
  const mouse = new Uint8Array(8);
  let mouseX = 0, mouseY = 0, scrollY = 0;
  let pointerLocked = false;
  let wantPointerLock = false;
  let canvas = null;
  let canvasW = 0, canvasH = 0;
  let renderScale = 1;

  // Touch overlay state (filled by touch.js)
  const touch = { buttons: 0, axes: [0, 0, 0, 0, 0, 0], active: false, directMove: 0 };

  let lastPhysicalPadAt = 0;
  let lastKeyboardAt = 0;
  const listeners = { physicalInput: [] };

  function heap() { return Module.HEAPU8; }

  function write() {
    const ptr = Module.rcInputPtr;
    if (!ptr) return;
    const h = heap();
    const dv = new DataView(h.buffer, ptr, 576);
    h.set(keys, ptr + OFF.keys);
    h.set(mouse, ptr + OFF.mouse);
    dv.setFloat32(OFF.mouseX, mouseX, true);
    dv.setFloat32(OFF.mouseY, mouseY, true);
    dv.setFloat32(OFF.scrollY, scrollY, true);

    // Merge physical pads with the touch overlay.
    let buttons = touch.active ? touch.buttons : 0;
    const axes = touch.active ? touch.axes.slice() : [0, 0, 0, 0, 0, 0];
    let connected = touch.active;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      connected = true;
      let any = false;
      pad.buttons.forEach((b, i) => {
        const pressed = b && (b.pressed || b.value > 0.5);
        if (pressed && STD_TO_BTN[i] !== undefined) { buttons |= (1 << STD_TO_BTN[i]); any = true; }
      });
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      axes[4] = Math.max(axes[4], lt);
      axes[5] = Math.max(axes[5], rt);
      for (let a = 0; a < 4 && a < pad.axes.length; a++) {
        const v = pad.axes[a];
        if (Math.abs(v) > Math.abs(axes[a])) axes[a] = v;
        if (Math.abs(v) > 0.35) any = true;
      }
      if (lt > 0.3 || rt > 0.3) any = true;
      if (any) {
        lastPhysicalPadAt = performance.now();
        listeners.physicalInput.forEach((fn) => fn('gamepad'));
      }
    }
    dv.setUint32(OFF.padButtons, buttons >>> 0, true);
    for (let i = 0; i < 6; i++) dv.setFloat32(OFF.padAxes + i * 4, axes[i], true);
    dv.setUint8(OFF.padConnected, connected ? 1 : 0);
    dv.setUint8(OFF.focused, (document.visibilityState === 'visible') ? 1 : 0);
    dv.setUint8(OFF.pointerLocked, pointerLocked ? 1 : 0);
    dv.setUint8(OFF.touchActive, touch.active ? 1 : 0);
    dv.setInt32(OFF.canvasW, canvasW, true);
    dv.setInt32(OFF.canvasH, canvasH, true);
    dv.setInt32(OFF.directMove, touch.active ? (touch.directMove | 0) : 0, true);
  }

  function resizeCanvas() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr * renderScale));
    const h = Math.max(1, Math.round(rect.height * dpr * renderScale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    canvasW = w;
    canvasH = h;
  }

  function toCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return [
      (e.clientX - rect.left) * (canvas.width / Math.max(rect.width, 1)),
      (e.clientY - rect.top) * (canvas.height / Math.max(rect.height, 1)),
    ];
  }

  function isTypingTarget(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  }

  function attach(cnv) {
    canvas = cnv;
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 250));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeCanvas);

    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      const k = KEYMAP[e.code];
      if (k !== undefined) {
        keys[k] = 1;
        lastKeyboardAt = performance.now();
        listeners.physicalInput.forEach((fn) => fn('keyboard'));
        // Keep the browser from scrolling / tabbing away while playing.
        if (k >= 256 || k === 32) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (k !== undefined) keys[k] = 0;
    });
    window.addEventListener('blur', () => { keys.fill(0); mouse.fill(0); });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button < 8) mouse[e.button] = 1;
      if (wantPointerLock && !pointerLocked && canvas.requestPointerLock) {
        try { canvas.requestPointerLock(); } catch (_) { /* ignore */ }
      }
    });
    window.addEventListener('mouseup', (e) => { if (e.button < 8) mouse[e.button] = 0; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (pointerLocked) {
        mouseX += e.movementX || 0;
        mouseY += e.movementY || 0;
      } else if (e.target === canvas) {
        [mouseX, mouseY] = toCanvas(e);
      }
    });
    canvas.addEventListener('wheel', (e) => {
      scrollY += e.deltaY < 0 ? 1 : -1;
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      pointerLocked = document.pointerLockElement === canvas;
    });
  }

  function setPointerLock(want) {
    wantPointerLock = want;
    if (!want && document.pointerLockElement) document.exitPointerLock();
  }

  function frame() {
    write();
    requestAnimationFrame(frame);
  }

  function start() {
    requestAnimationFrame(frame);
  }

  return {
    BTN, touch, attach, start, setPointerLock, resizeCanvas,
    setRenderScale(s) { renderScale = s; resizeCanvas(); },
    onPhysicalInput(fn) { listeners.physicalInput.push(fn); },
    get lastPhysicalPadAt() { return lastPhysicalPadAt; },
    get lastKeyboardAt() { return lastKeyboardAt; },
  };
})();
