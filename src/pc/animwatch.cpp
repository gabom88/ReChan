#include "pc/animwatch.h"
#include "pc/autotest.h"
#include "ai/humanoid.h"
#include "ai/player.h"
#include "gen/ai.h"
#include "gen/animstruct.h"
#include "gen/model.h"
#include "gen/time.h"

#include <cstdio>
#if defined(RC_PLATFORM_WEB)
#include <emscripten.h>
#endif

namespace {
    // 5 s at the 30 Hz logic rate. Nothing in the game legitimately holds a
    // living humanoid on one exact animation frame that long (knock-downs get
    // up, stuns expire, NIS scripts keep animating).
    constexpr s32 kStuckLogicFrames = 150;
    constexpr s32 kMaxTracked = 64;

    struct Track {
        const Humanoid* who = nullptr;
        s32 actionState = -1;
        s32 animEnum = -1;
        s32 frame = -1;
        s32 sameFrames = 0;
        bool reported = false;
    };

    Track s_tracks[kMaxTracked];
    const void* s_traceTarget = nullptr;
    s32 s_traceBudget = 0;
    u32 s_lastLogicFrame = 0xFFFFFFFFu;
    s32 s_stuckCount = 0;

    Track* FindTrack(const Humanoid* h) {
        Track* freeSlot = nullptr;
        for (Track& t : s_tracks) {
            if (t.who == h) return &t;
            if (!freeSlot && !t.who) freeSlot = &t;
        }
        if (freeSlot) {
            *freeSlot = Track{};
            freeSlot->who = h;
        }
        return freeSlot;
    }

    const AnimStructure* AnimOf(const Humanoid* h) {
        const Model* m = static_cast<const Model*>(h->model);
        return m ? static_cast<const AnimStructure*>(m->animStructure) : nullptr;
    }

    void Format(char* buf, size_t len, const Humanoid* h, const AnimStructure* a) {
        std::snprintf(buf, len,
            "%s type=%u action=%d flags=0x%08x pos=(%d,%d,%d) anim=%d loop=%d speed=%d frame=%d/%d cb=(hi=%d lo=%d fn=%p)",
            h == Player::s_player ? "PLAYER" : "enemy", (u32)h->thingType, h->actionState, h->flags,
            (int)h->pos.x, (int)h->pos.y, (int)h->pos.z,
            a ? a->animEnum : -1, a ? a->loopTypeField : -1, a ? a->speed : 0,
            a ? (a->currentFrame >> 16) : -1, a ? (a->endFrame >> 16) : -1,
            a ? (int)a->humanoidCB.offsetHi : 0, a ? (int)a->humanoidCB.offsetLo : 0,
            a ? a->humanoidCB.funcPtr : nullptr);
    }
}

bool AnimWatch_IsEnabled() {
#if defined(RC_PLATFORM_WEB)
    return true;
#else
    return AutoTest_IsEnabled();
#endif
}

void AnimWatch_Reset() {
    for (Track& t : s_tracks) t = Track{};
    s_lastLogicFrame = 0xFFFFFFFFu;
    s_stuckCount = 0;
}

s32 AnimWatch_GetStuckCount() {
    return s_stuckCount;
}

void AnimWatch_Step() {
    if (!AnimWatch_IsEnabled() || !g_ai || !g_time) return;

    // Only count logic ticks (frames can be presented without one).
    const u32 logicFrame = g_time->GetFrameCounter();
    if (logicFrame == s_lastLogicFrame) return;
    s_lastLogicFrame = logicFrame;

    // Forget humanoids that left the list (deleted / level change).
    for (Track& t : s_tracks) {
        if (!t.who) continue;
        bool present = false;
        for (ccMinNode* n = g_ai->humanoidList.head; n; n = n->next) {
            if (static_cast<const Humanoid*>(static_cast<Thing*>(n)) == t.who) { present = true; break; }
        }
        if (!present) t = Track{};
    }

    for (ccMinNode* n = g_ai->humanoidList.head; n; n = n->next) {
        const Humanoid* h = static_cast<const Humanoid*>(static_cast<Thing*>(n));
        // Enemies driven by the AI do not necessarily carry TF_ACTIVATED, so
        // watch every living humanoid that currently has an animation.
        if (h->flags & TF_DEAD) continue;
        const AnimStructure* a = AnimOf(h);
        if (!a) continue;

        Track* t = FindTrack(h);
        if (!t) continue;

        if (t->actionState == h->actionState && t->animEnum == a->animEnum && t->frame == a->currentFrame) {
            ++t->sameFrames;
        }
        else {
            t->actionState = h->actionState;
            t->animEnum = a->animEnum;
            t->frame = a->currentFrame;
            t->sameFrames = 0;
            t->reported = false;
        }

        if (t->sameFrames >= kStuckLogicFrames && !t->reported) {
            t->reported = true;
            ++s_stuckCount;
            char buf[320];
            Format(buf, sizeof(buf), h, a);
            LOG_ALWAYS("[AnimWatch] STUCK %d frames: %s", t->sameFrames, buf);
            s_traceTarget = static_cast<const Thing*>(h);
            s_traceBudget = 3;
        }
    }
}

void AnimWatch_OnAnimRestart(const void* ownerThing, s32 animEnum) {
    if (!ownerThing || ownerThing != s_traceTarget || s_traceBudget <= 0) {
        return;
    }
    --s_traceBudget;
    LOG_ALWAYS("[AnimWatch] restart of anim %d on stuck humanoid %p (frame %u)", animEnum, ownerThing,
               g_time ? g_time->GetFrameCounter() : 0u);
#if defined(RC_PLATFORM_WEB)
    char stack[4096];
    emscripten_get_callstack(EM_LOG_C_STACK, stack, sizeof(stack));
    LOG_ALWAYS("%s", stack);
#endif
}

std::string AnimWatch_Describe() {
    std::string out;
    if (!g_ai) return out;
    for (ccMinNode* n = g_ai->humanoidList.head; n; n = n->next) {
        const Humanoid* h = static_cast<const Humanoid*>(static_cast<Thing*>(n));
        char buf[320];
        Format(buf, sizeof(buf), h, AnimOf(h));
        s32 same = 0;
        for (const Track& t : s_tracks) if (t.who == h) same = t.sameFrames;
        out += buf;
        char tail[48];
        std::snprintf(tail, sizeof(tail), " still=%d%s\n", same, (h->flags & TF_DEAD) ? " DEAD" : "");
        out += tail;
    }
    return out;
}
