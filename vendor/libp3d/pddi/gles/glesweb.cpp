// glesweb.cpp — WebGL2 display + Gamepad for the Emscripten build.
//
// The renderer itself is the shared GLES 3.0 backend in glesrender.cpp
// (WebGL2 == GLES 3.0 / GLSL ES 3.00). This file only replaces the two pieces
// that were Switch-specific: the window/context (EGL + NWindow there, a
// <canvas> WebGL2 context here) and the pad (libnx HID there, the browser
// Gamepad API merged with the on-screen touch controls here).
#if defined(RC_PLATFORM_WEB)

#include "pddi/gles/glesrender.h"
#include "pddi/gles/glesweb.h"

#include <GLES3/gl3.h>
#include <emscripten.h>
#include <emscripten/html5.h>
#include <cstdio>
#include <cstring>

extern char s_glesInitError[160];

static RcWebInput s_webInput = {};

extern "C" EMSCRIPTEN_KEEPALIVE RcWebInput* rcweb_input_state() {
    return &s_webInput;
}

// Yields to the browser until the next display refresh. The whole engine runs
// on the main thread with Asyncify, so this is where the frame is presented
// and where DOM events / audio callbacks get a chance to run.
EM_ASYNC_JS(void, rcweb_wait_frame, (), {
    await new Promise(function(resolve) {
        if (document.hidden) { setTimeout(resolve, 100); return; }
        requestAnimationFrame(function() { resolve(); });
    });
});

EM_JS(void, rcweb_set_title, (const char* title), {
    if (Module.rcSetTitle) Module.rcSetTitle(UTF8ToString(title));
});

EM_JS(void, rcweb_set_pointer_lock, (int want), {
    if (Module.rcSetPointerLock) Module.rcSetPointerLock(!!want);
});

EM_JS(void, rcweb_set_cursor_visible, (int visible), {
    if (Module.canvas) Module.canvas.style.cursor = visible ? 'default' : 'none';
});

EM_JS(void, rcweb_set_fullscreen, (int want), {
    if (Module.rcSetFullscreen) Module.rcSetFullscreen(!!want);
});

EM_JS(int, rcweb_is_fullscreen, (), {
    return (document.fullscreenElement || document.webkitFullscreenElement) ? 1 : 0;
});

EM_JS(void, rcweb_display_ready, (), {
    if (Module.rcOnDisplayReady) Module.rcOnDisplayReady();
});

glesDisplay::glesDisplay() = default;

glesDisplay::~glesDisplay() {
    if (webContext_) {
        emscripten_webgl_destroy_context((EMSCRIPTEN_WEBGL_CONTEXT_HANDLE)webContext_);
        webContext_ = 0;
    }
}

bool glesDisplay::InitDisplay(const pddiDisplayInit& init) {
    s_glesInitError[0] = '\0';

    EmscriptenWebGLContextAttributes attr;
    emscripten_webgl_init_context_attributes(&attr);
    attr.majorVersion = 2;
    attr.minorVersion = 0;
    attr.alpha = EM_FALSE;
    attr.depth = EM_TRUE;
    attr.stencil = EM_TRUE;
    attr.antialias = EM_FALSE;
    attr.premultipliedAlpha = EM_FALSE;
    attr.preserveDrawingBuffer = EM_FALSE;
    attr.powerPreference = EM_WEBGL_POWER_PREFERENCE_HIGH_PERFORMANCE;
    attr.enableExtensionsByDefault = EM_TRUE;

    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx = emscripten_webgl_create_context("#canvas", &attr);
    if (ctx <= 0) {
        std::snprintf(s_glesInitError, sizeof(s_glesInitError),
                      "WebGL2 is not available (error %d)", (int)ctx);
        return false;
    }
    emscripten_webgl_make_context_current(ctx);
    // Half-float / float colour targets (post-processing) need these on WebGL2.
    emscripten_webgl_enable_extension(ctx, "EXT_color_buffer_float");
    emscripten_webgl_enable_extension(ctx, "EXT_color_buffer_half_float");
    emscripten_webgl_enable_extension(ctx, "OES_texture_float_linear");
    webContext_ = (int)ctx;
    {
        GLint maxSamples = 0;
        glGetIntegerv(GL_MAX_SAMPLES, &maxSamples);
        maxMsaaSamples = maxSamples;
    }
    SetMSAA(init.msaa);

    width = s_webInput.canvasW > 0 ? s_webInput.canvasW : init.xSize;
    height = s_webInput.canvasH > 0 ? s_webInput.canvasH : init.ySize;
    lastFocused_ = true;
    rcweb_display_ready();
    return true;
}

// The menu offers 0/2/4/8/16; WebGL2 usually allows 4 (Safari, most phones)
// or 8. Keep the highest allowed value not above the request.
void glesDisplay::SetMSAA(int samples) {
    static const int kAllowed[] = { 16, 8, 4, 2 };
    int chosen = 0;
    if (samples > 0) {
        for (int v : kAllowed) {
            if (v <= samples && (maxMsaaSamples <= 0 || v <= maxMsaaSamples)) { chosen = v; break; }
        }
    }
    msaaSamples = chosen;
}

void glesDisplay::SwapBuffers() {
    rcweb_wait_frame();
}

void glesDisplay::SetVSync(bool) {
    // Presentation is always paced by requestAnimationFrame.
}

void glesDisplay::DispatchWebEvents() {
    const RcWebInput& in = s_webInput;

    if (in.canvasW > 0 && in.canvasH > 0 && (in.canvasW != width || in.canvasH != height)) {
        width = in.canvasW;
        height = in.canvasH;
        if (wndProc) {
            pddiWndMessage msg;
            msg.event = PDDI_WND_RESIZE;
            msg.param1 = width;
            msg.param2 = height;
            wndProc(msg);
        }
    }

    const bool focused = in.focused != 0;
    if (focused != lastFocused_) {
        lastFocused_ = focused;
        if (wndProc) {
            pddiWndMessage msg;
            msg.event = PDDI_WND_FOCUS;
            msg.param1 = focused ? 1 : 0;
            wndProc(msg);
        }
    }

    for (int i = 0; i < 8; ++i) {
        const bool down = in.mouse[i] != 0;
        if (down != lastMouse_[i]) {
            lastMouse_[i] = down;
            if (wndProc) {
                pddiWndMessage msg;
                msg.event = PDDI_WND_MOUSEBUTTON;
                msg.param1 = i;
                msg.param2 = down ? 1 : 0;
                wndProc(msg);
            }
        }
    }

    const float scroll = in.scrollY;
    if (scroll != lastScroll_) {
        const float delta = scroll - lastScroll_;
        lastScroll_ = scroll;
        if (wndProc) {
            pddiWndMessage msg;
            msg.event = PDDI_WND_SCROLL;
            msg.fparam1 = 0.0;
            msg.fparam2 = delta;
            wndProc(msg);
        }
    }
}

void glesDisplay::PollEvents() {
    DispatchWebEvents();
}

bool glesDisplay::ShouldClose() {
    return shouldClose;
}

bool glesDisplay::IsKeyDown(int key) {
    if (key < 0 || key >= 512) return false;
    return s_webInput.keys[key] != 0;
}

bool glesDisplay::IsMouseButtonDown(int button) {
    if (button < 0 || button >= 8) return false;
    return s_webInput.mouse[button] != 0;
}

void glesDisplay::GetMousePosition(double& x, double& y) {
    x = s_webInput.mouseX;
    y = s_webInput.mouseY;
}

void glesDisplay::SetFullscreen(bool fullscreen) {
    rcweb_set_fullscreen(fullscreen ? 1 : 0);
}

bool glesDisplay::IsFullscreen() {
    return rcweb_is_fullscreen() != 0;
}

void glesDisplay::SetTitle(const char* title) {
    rcweb_set_title(title ? title : "");
}

void glesDisplay::ShowCursor(bool visible) {
    rcweb_set_cursor_visible(visible ? 1 : 0);
}

void glesDisplay::ClipCursor(bool clip) {
    rcweb_set_pointer_lock(clip ? 1 : 0);
}

// glesGamepad — browser Gamepad API ("standard" mapping) merged by the page
// with the configurable on-screen touch controls.

glesGamepad::glesGamepad() = default;

void glesGamepad::Poll() {
    connected = s_webInput.padConnected != 0;
    heldButtons = s_webInput.padButtons;
    for (int i = 0; i < GamepadAxis::COUNT; ++i) {
        axes[i] = s_webInput.padAxes[i];
    }
}

bool glesGamepad::IsButtonDown(int button) const {
    if (button < 0 || button >= GamepadButton::COUNT) return false;
    return (heldButtons & (1ull << button)) != 0;
}

float glesGamepad::GetAxis(int axis) const {
    if (axis < 0 || axis >= GamepadAxis::COUNT) {
        return 0.0f;
    }
    return axes[axis];
}

#endif // RC_PLATFORM_WEB
