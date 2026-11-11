#pragma once
#include "gen/config.h"

#if NEW_CHEATS

enum class CheatOption {
    AllDragons,
    AllLevels,
    GodMode,
    OnePunchMan,
    HeavenBound,
    BobbleHead,
    Stuntquake,
    MirrorWorld,
    // Gameplay mods (Pause -> Options -> Mods)
    InfiniteJump,   // jump again while airborne on every jump press
    NoClipWalls,    // the player ignores wall collision (floor and boxes still apply)
};

bool IsCheatEnabled(CheatOption option);
void SetCheatEnabled(CheatOption option, bool enabled);
void ApplyProgressCheats();
void ResetCheats();

#endif
