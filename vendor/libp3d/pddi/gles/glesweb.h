// glesweb.h — shared input block between the web page (JS) and the engine.
//
// The page owns all DOM listeners (keyboard, mouse, Gamepad API and the touch
// overlay) and writes their current state straight into this struct in wasm
// memory; the engine only reads it once per frame. That keeps per-frame input
// polling free of JS<->wasm calls. Field offsets are mirrored in
// web/rechan_web.pre.js (RC_INPUT_LAYOUT) -- keep both in sync.
#pragma once

#if defined(RC_PLATFORM_WEB)

#include <cstddef>
#include <cstdint>

struct RcWebInput {
    uint8_t  keys[512];      //   0: GLFW-compatible key codes (see p3d/keycode.h)
    uint8_t  mouse[8];       // 512: mouse buttons (0=left, 1=right, 2=middle)
    float    mouseX;         // 520: canvas pixels; unbounded while pointer-locked
    float    mouseY;         // 524
    float    scrollY;        // 528: accumulated wheel ticks (+ = up)
    uint32_t padButtons;     // 532: bit N = GamepadButton N (physical pad | touch)
    float    padAxes[6];     // 536: GamepadAxis order, already merged
    uint8_t  padConnected;   // 560: any pad or the touch overlay is active
    uint8_t  focused;        // 561: page visible and focused
    uint8_t  pointerLocked;  // 562
    uint8_t  touchActive;    // 563: touch overlay currently shown
    int32_t  canvasW;        // 564: drawing-buffer size in pixels
    int32_t  canvasH;        // 568
    int32_t  directMove;     // 572: touch "direct attack" pressed: 1-7 punch, 8-14 kick, 0 none
};

static_assert(offsetof(RcWebInput, mouse) == 512, "RcWebInput layout");
static_assert(offsetof(RcWebInput, mouseX) == 520, "RcWebInput layout");
static_assert(offsetof(RcWebInput, scrollY) == 528, "RcWebInput layout");
static_assert(offsetof(RcWebInput, padButtons) == 532, "RcWebInput layout");
static_assert(offsetof(RcWebInput, padAxes) == 536, "RcWebInput layout");
static_assert(offsetof(RcWebInput, padConnected) == 560, "RcWebInput layout");
static_assert(offsetof(RcWebInput, canvasW) == 564, "RcWebInput layout");
static_assert(offsetof(RcWebInput, directMove) == 572, "RcWebInput layout");
static_assert(sizeof(RcWebInput) == 576, "RcWebInput layout");

extern "C" RcWebInput* rcweb_input_state();

#endif // RC_PLATFORM_WEB
