// webdiag.cpp — web build only: dumps the player/engine state as text so a
// user can copy it from the page (☰ → "Copiar diagnóstico") when something
// goes wrong, e.g. the player freezing in place. Read-only; no game effects.
#if defined(RC_PLATFORM_WEB)

#include "gen/common.h"
#include "gen/game.h"
#include "gen/time.h"
#include "gen/director.h"
#include "gen/animstruct.h"
#include "gen/model.h"
#include "ai/player.h"
#include "pc/inputaction.h"
#include "extra/version.h"
#include "pddi/gles/glesweb.h"
#include "pc/animwatch.h"
#include "extra/cheats.h"
#include "extra/fecustommenumgr.h"
#include "gen/world.h"

#include <emscripten.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

extern "C" EMSCRIPTEN_KEEPALIVE char* rcweb_debug_dump() {
    std::string out;
    char line[256];
    auto add = [&](const char* fmt, auto... args) {
        std::snprintf(line, sizeof(line), fmt, args...);
        out += line;
        out += '\n';
    };

    add("ReChan web %s", GAME_VERSION);
    if (g_game) add("game.state=%d", (int)g_game->GetState());
    if (g_time) {
        add("time.frame=%u targetFPS=%d fps=%.1f dt=%.4f logicSteps=%d alpha=%.2f",
            g_time->GetFrameCounter(), g_time->targetFPS, g_time->fps, g_time->deltaTime,
            g_time->GetLogicStepCount(), g_time->GetPlayPresentationAlpha());
    }
    if (g_director) {
        add("director.scriptState=%d enableInput=%d", g_director->scriptState, g_director->enableInput);
    }

    Player* p = Player::s_player;
    if (!p) {
        add("player=null");
    }
    else {
        add("player.actionState=%d flags=0x%08x flags2=0x%08x",
            p->actionState, p->flags, p->flags2);
        add("player.pos=(%d,%d,%d)", (int)p->pos.x, (int)p->pos.y, (int)p->pos.z);
        add("player.debugAnimOverride active=%d paused=%d",
            p->Debug_IsAnimationOverrideActive() ? 1 : 0, p->Debug_IsAnimationPaused() ? 1 : 0);
        Model* m = static_cast<Model*>(p->model);
        AnimStructure* a = m ? static_cast<AnimStructure*>(m->animStructure) : nullptr;
        if (a) {
            add("anim.enum=%d loop=%d speed=%d frame=%d start=%d end=%d tick=%d/%d loops=%d mode=%d",
                a->animEnum, a->loopTypeField, a->speed, a->currentFrame, a->startFrame,
                a->endFrame, a->prevTick, a->currentTick, a->loopCount, a->mode);
        }
        else {
            add("anim=null (model=%p)", (void*)m);
        }
    }

    if (g_actionInput) {
        std::string held;
        for (s32 i = 0; i < ACTION_COUNT; ++i) {
            if (g_actionInput->IsHeld(static_cast<Action>(i))) {
                held += ActionToToken(static_cast<Action>(i));
                held += ' ';
            }
        }
        add("input.held=[%s] gamepadActive=%d", held.c_str(), g_actionInput->IsGamepadActive() ? 1 : 0);
    }

#if NEW_CHEATS
    {
        static const struct { CheatOption opt; const char* name; } kCheats[] = {
            { CheatOption::AllDragons, "AllDragons" }, { CheatOption::AllLevels, "AllLevels" },
            { CheatOption::GodMode, "GodMode" }, { CheatOption::OnePunchMan, "OnePunchMan" },
            { CheatOption::HeavenBound, "HeavenBound" }, { CheatOption::BobbleHead, "BobbleHead" },
            { CheatOption::Stuntquake, "Stuntquake" }, { CheatOption::MirrorWorld, "MirrorWorld" },
            { CheatOption::InfiniteJump, "InfiniteJump" }, { CheatOption::NoClipWalls, "NoClipWalls" },
            { CheatOption::CameraFollow, "CameraFollow" },
        };
        std::string on;
        for (const auto& c : kCheats) {
            if (IsCheatEnabled(c.opt)) { on += c.name; on += ' '; }
        }
        add("cheats.enabled=[%s]", on.c_str());
    }
#endif
    add("animwatch.stuckEpisodes=%d", AnimWatch_GetStuckCount());
    out += "--- humanoids ---\n";
    out += AnimWatch_Describe();

    char* result = static_cast<char*>(std::malloc(out.size() + 1));
    if (result) std::memcpy(result, out.c_str(), out.size() + 1);
    return result;
}

// ---------------------------------------------------------------------------
// Requests from the page (☰ menu). They are queued and handled by the main
// loop between frames (WebDiag_ProcessRequests), never from inside a JS call.

static bool s_exitToMapRequested = false;

static bool CanExitToMap() {
    if (!g_game || !g_game->GetWorld()) return false;
    const GameState st = g_game->GetState();
    if (st != GameState::Play && st != GameState::Menu) return false;
    return g_game->GetWorld()->GetCurLevelID() != 7; // 7 = the level-select map itself
}

// 1 when "Back to map" makes sense right now (inside a level).
extern "C" EMSCRIPTEN_KEEPALIVE int rcweb_can_exit_to_map() {
    return CanExitToMap() ? 1 : 0;
}

extern "C" EMSCRIPTEN_KEEPALIVE void rcweb_request_exit_to_map() {
    s_exitToMapRequested = true;
}

// Direct-attack touch buttons: forward each new press to the fighting code
// before this frame's input is processed (see RequestPlayerDirectMove).
void RequestPlayerDirectMove(s32 index);

void WebDiag_PollInput() {
    static int32_t s_lastDirect = 0;
    const int32_t direct = rcweb_input_state()->directMove;
    if (direct != s_lastDirect && direct >= 1 && direct <= 14) {
        RequestPlayerDirectMove(direct - 1);
    }
    s_lastDirect = direct;
}

void WebDiag_ProcessRequests() {
    if (!s_exitToMapRequested) return;
    s_exitToMapRequested = false;
    if (!CanExitToMap()) return;
    LOG_ALWAYS("[Web] Back to map requested from the page menu");
#if CUSTOM_MENU
    if (g_feCustomMenuMgr && g_feCustomMenuMgr->IsActive()) {
        g_feCustomMenuMgr->Deactivate();
    }
#endif
    // Same transition as the pause menu's "Exit level" -> Yes.
    g_game->SetState(GameState::OpenLocationMenu);
}

#endif // RC_PLATFORM_WEB
