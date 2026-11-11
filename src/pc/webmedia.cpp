// webmedia.cpp — experimental media-pack mode for the web build (see webmedia.h).
#if defined(RC_PLATFORM_WEB)

#include "pc/webmedia.h"
#include <emscripten.h>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <string>

EM_JS(int, rcweb_media_active, (), {
    return (Module.rcMedia && Module.rcMedia.active) ? 1 : 0;
});

EM_JS(int, rcweb_media_has, (const char* key), {
    return (Module.rcMedia && Module.rcMedia.has(UTF8ToString(key))) ? 1 : 0;
});

// Returns a malloc'd interleaved s16 buffer (caller frees) or 0.
EM_ASYNC_JS(int16_t*, rcweb_media_decode, (const char* key, int preferredRate, int* outRate, int* outChannels, int* outFrames), {
    if (!Module.rcMedia) return 0;
    let decoded = null;
    try { decoded = await Module.rcMedia.decodeAudio(UTF8ToString(key), preferredRate); }
    catch (e) { console.warn('[ReChan] media decode failed', UTF8ToString(key), e); return 0; }
    if (!decoded) return 0;
    const bytes = decoded.pcm.length * 2;
    const ptr = _malloc(bytes);
    if (!ptr) return 0;
    HEAP16.set(decoded.pcm, ptr >> 1);
    HEAP32[outRate >> 2] = decoded.rate;
    HEAP32[outChannels >> 2] = decoded.channels;
    HEAP32[outFrames >> 2] = decoded.frames;
    return ptr;
});

EM_ASYNC_JS(int, rcweb_media_play_movie, (const char* key, int skippable), {
    if (!Module.rcMedia) return 0;
    try { return (await Module.rcMedia.playMovie(UTF8ToString(key), !!skippable)) ? 1 : 0; }
    catch (e) { console.warn('[ReChan] movie failed', e); return 0; }
});

bool WebMedia_IsActive() {
    return rcweb_media_active() != 0;
}

bool WebMedia_LoadAudio(const char* key, u32 preferredRate,
                        std::vector<s16>& outPcm, u32& outRate, u32& outChannels) {
    if (!key || !WebMedia_IsActive() || !rcweb_media_has(key)) return false;
    int rate = 0, channels = 0, frames = 0;
    int16_t* pcm = rcweb_media_decode(key, (int)preferredRate, &rate, &channels, &frames);
    if (!pcm) return false;
    if (rate <= 0 || channels <= 0 || frames <= 0) {
        std::free(pcm);
        return false;
    }
    outPcm.assign(pcm, pcm + (size_t)frames * (size_t)channels);
    std::free(pcm);
    outRate = (u32)rate;
    outChannels = (u32)channels;
    LOG("[WebMedia] %s: %d frames, %d ch @ %d Hz", key, frames, channels, rate);
    return true;
}

bool WebMedia_PlayMovie(const char* movieFile, bool skippable) {
    if (!movieFile || !WebMedia_IsActive()) return false;
    std::string stem = movieFile;
    const size_t slash = stem.find_last_of("/\\");
    if (slash != std::string::npos) stem.erase(0, slash + 1);
    const size_t dot = stem.rfind('.');
    if (dot != std::string::npos) stem.erase(dot);
    for (char& c : stem) c = (char)std::tolower((unsigned char)c);
    const std::string key = "movies/" + stem + ".mp4";
    if (!rcweb_media_has(key.c_str())) return false;
    LOG("[WebMedia] playing %s", key.c_str());
    return rcweb_media_play_movie(key.c_str(), skippable ? 1 : 0) != 0;
}

#endif // RC_PLATFORM_WEB
