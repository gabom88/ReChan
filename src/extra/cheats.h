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
    CameraFollow,   // the rail camera keeps the player centred (no follow clamps)
    NoFallDeath,    // death volumes / endless falls put the player back on safe ground
    RandomWeapon,   // Select drops a random weapon of the current level from the sky
    ShaolinOutfit,  // Jackie always wears the alternate (Drunken Master) outfit
};

// Mod helpers (see player.cpp / ai.cpp).
void ModRememberWeaponTemplate(class Pickup* pickup, const char* modelName);
void ModClearWeaponTemplates();
bool ModDropRandomWeapon();
void ModNoteSelectPress();     // host input: Select was just pressed
bool ModTakeSelectPress();
void ModNoteSafeGround(const struct LVector& pos);
bool ModReturnToSafeGround();

bool IsCheatEnabled(CheatOption option);
void SetCheatEnabled(CheatOption option, bool enabled);
void ApplyProgressCheats();
void ResetCheats();

#endif
