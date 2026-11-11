#pragma once
#include "gen/common.h"
#include <vector>

// Experimental "media pack" mode (web build only).
//
// ReChan Web can load the game either from the disc image (stable mode) or
// from a ZIP made by tools/media_pack/make_rechan_pack.py (experimental mode).
// In the experimental mode music, speech and movies come from modern files
// (AAC .m4a / H.264 .mp4) decoded and played by the browser, and these hooks
// return true. In the stable mode -- and in every non-web build -- they all
// return false and the original code paths run unchanged.

#if defined(RC_PLATFORM_WEB)
bool WebMedia_IsActive();
// key: "music/china1_s00.m4a", "dialog/c01_d010_v00.m4a". preferredRate: the
// rate the original data plays at (decoding keeps memory use comparable).
bool WebMedia_LoadAudio(const char* key, u32 preferredRate,
                        std::vector<s16>& outPcm, u32& outRate, u32& outChannels);
// movieFile: the engine's name, e.g. "prolog.str". Blocks (yielding to the
// browser) until the movie ends or is skipped. False if there is no MP4.
bool WebMedia_PlayMovie(const char* movieFile, bool skippable);
#else
inline bool WebMedia_IsActive() { return false; }
inline bool WebMedia_LoadAudio(const char*, u32, std::vector<s16>&, u32&, u32&) { return false; }
inline bool WebMedia_PlayMovie(const char*, bool) { return false; }
#endif
