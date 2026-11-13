#include "extra/cheats.h"

#if NEW_CHEATS

#include "ai/player.h"
#include "fe/femenumgr.h"
#include "gen/game.h"
#include "gen/scoremgr.h"
#include "gen/world.h"
#include "gen/ai.h"
#include "gen/blockmgr.h"
#include "gen/charmgr.h"
#include "gen/time.h"
#include "ai/pickup.h"
#include "p3d/p3dmath.h"
#include "pc/log.h"
#include "p3d/context.h"
#include "pddi/pddidev.h"
#include <cstring>

static bool s_allDragons = false;
static bool s_allLevels = false;
static bool s_godMode = false;
static bool s_onePunchMan = false;
static bool s_heavenBound = false;
static bool s_bobbleHead = false;
static bool s_stuntquake = false;
static bool s_mirrorWorld = false;
static bool s_infiniteJump = false;
static bool s_noClipWalls = false;
static bool s_cameraFollow = false;
static bool s_noFallDeath = false;
static bool s_randomWeapon = false;
static bool s_shaolinOutfit = false;
static PetalStats s_dragonSnapshot[21] = {};
static PetalStats s_levelSnapshot[21] = {};
static u8 s_currentGoldSnapshot = 0;
static bool s_dragonSnapshotValid = false;
static bool s_levelSnapshotValid = false;

static bool* GetCheatFlag(CheatOption option) {
    switch (option) {
        case CheatOption::AllDragons: return &s_allDragons;
        case CheatOption::AllLevels: return &s_allLevels;
        case CheatOption::GodMode: return &s_godMode;
        case CheatOption::OnePunchMan: return &s_onePunchMan;
        case CheatOption::HeavenBound: return &s_heavenBound;
        case CheatOption::BobbleHead: return &s_bobbleHead;
        case CheatOption::Stuntquake: return &s_stuntquake;
        case CheatOption::MirrorWorld: return &s_mirrorWorld;
        case CheatOption::InfiniteJump: return &s_infiniteJump;
        case CheatOption::NoClipWalls: return &s_noClipWalls;
        case CheatOption::CameraFollow: return &s_cameraFollow;
        case CheatOption::NoFallDeath: return &s_noFallDeath;
        case CheatOption::RandomWeapon: return &s_randomWeapon;
        case CheatOption::ShaolinOutfit: return &s_shaolinOutfit;
    }
    return nullptr;
}

bool IsCheatEnabled(CheatOption option) {
    const bool* flag = GetCheatFlag(option);
    return flag && *flag;
}

void ApplyProgressCheats() {
    if (g_scoreManager) {
        if (s_allDragons) {
            std::memcpy(s_dragonSnapshot, g_scoreManager->petalStats, sizeof(s_dragonSnapshot));
            s_currentGoldSnapshot = g_scoreManager->currentGoldDragons;
            s_dragonSnapshotValid = true;
            g_scoreManager->GiveAllDragons();
        }
        if (s_allLevels) {
            std::memcpy(s_levelSnapshot, g_scoreManager->petalStats, sizeof(s_levelSnapshot));
            s_levelSnapshotValid = true;
            g_scoreManager->OpenAllLevels();
        }
    }
    World* world = g_game ? g_game->GetWorld() : nullptr;
    if (s_allLevels && g_feMenuMgr && world && world->GetCurLevelID() == 7) {
        g_feMenuMgr->OpenDoors();
    }
    if (s_godMode && Player::s_player) {
        Player::s_player->health = Player::s_player->maxHealth;
    }
}

void SetCheatEnabled(CheatOption option, bool enabled) {
    bool* flag = GetCheatFlag(option);
    if (!flag) return;
    if (*flag == enabled) return;

    if (!enabled && g_scoreManager) {
        if (option == CheatOption::AllDragons && s_dragonSnapshotValid) {
            for (s32 i = 0; i < 21; ++i) {
                g_scoreManager->petalStats[i].collectCount = s_dragonSnapshot[i].collectCount;
                g_scoreManager->petalStats[i].goldDragons = s_dragonSnapshot[i].goldDragons;
            }
            g_scoreManager->currentGoldDragons = s_currentGoldSnapshot;
            s_dragonSnapshotValid = false;
        }
        else if (option == CheatOption::AllLevels && s_levelSnapshotValid) {
            for (s32 i = 0; i < 21; ++i) {
                g_scoreManager->petalStats[i].fightScore = s_levelSnapshot[i].fightScore;
            }
            s_levelSnapshotValid = false;
        }
    }

    *flag = enabled;

    if (option == CheatOption::MirrorWorld && p3d::context) {
        p3d::context->SetWorldMirror(enabled);
    }

    // Swap Jackie's textures right away (the suit only changes textures).
    if (option == CheatOption::ShaolinOutfit && g_characterManager
        && g_characterManager->IsCharacterLoaded((u32)AITypes::TT_PLAYER)) {
        g_characterManager->LoadCharTexture((u32)AITypes::TT_PLAYER);
    }

    if (!enabled) return;

    if (g_scoreManager && option == CheatOption::AllDragons) {
        std::memcpy(s_dragonSnapshot, g_scoreManager->petalStats, sizeof(s_dragonSnapshot));
        s_currentGoldSnapshot = g_scoreManager->currentGoldDragons;
        s_dragonSnapshotValid = true;
        g_scoreManager->GiveAllDragons();
    }
    else if (g_scoreManager && option == CheatOption::AllLevels) {
        std::memcpy(s_levelSnapshot, g_scoreManager->petalStats, sizeof(s_levelSnapshot));
        s_levelSnapshotValid = true;
        g_scoreManager->OpenAllLevels();
        World* world = g_game ? g_game->GetWorld() : nullptr;
        if (g_feMenuMgr && world && world->GetCurLevelID() == 7) g_feMenuMgr->OpenDoors();
    }
    else if (option == CheatOption::GodMode && Player::s_player) {
        Player::s_player->health = Player::s_player->maxHealth;
    }
}

void ResetCheats() {
    SetCheatEnabled(CheatOption::AllDragons, false);
    SetCheatEnabled(CheatOption::AllLevels, false);
    SetCheatEnabled(CheatOption::GodMode, false);
    SetCheatEnabled(CheatOption::OnePunchMan, false);
    SetCheatEnabled(CheatOption::HeavenBound, false);
    SetCheatEnabled(CheatOption::BobbleHead, false);
    SetCheatEnabled(CheatOption::Stuntquake, false);
    SetCheatEnabled(CheatOption::MirrorWorld, false);
    SetCheatEnabled(CheatOption::InfiniteJump, false);
    SetCheatEnabled(CheatOption::NoClipWalls, false);
    SetCheatEnabled(CheatOption::CameraFollow, false);
    SetCheatEnabled(CheatOption::NoFallDeath, false);
    SetCheatEnabled(CheatOption::RandomWeapon, false);
    SetCheatEnabled(CheatOption::ShaolinOutfit, false);
}

// ---------------------------------------------------------------------------
// Mod "Random weapon (Select)". Weapon models live in each level's data, so
// only the weapons of the current level can be created: every weapon pickup
// the level spawns is remembered here (model, type, collision points and
// fighting tree), and Select drops a copy of a random one above Jackie.
struct WeaponTemplate {
    u16 type = 0;
    char model[32] = {};
    s32 collisionPointCount = 0;
    LVector collisionPoints[3] = {};
    u32 fightingSystemRoot = 0;
    u16 collisionRadius = 0;
    s32 field332 = 0;
    LVector orientation = {};   // resting pose as placed in the level
};
static WeaponTemplate s_weaponTemplates[16];
static s32 s_weaponTemplateCount = 0;

void ModClearWeaponTemplates() {
    s_weaponTemplateCount = 0;
}

void ModRememberWeaponTemplate(Pickup* pickup, const char* modelName) {
    if (!pickup || !modelName || !*modelName) return;
    const u16 type = pickup->thingType;
    if (type < 301 || type > 328) return;            // weapons only (not collectibles)
    for (s32 i = 0; i < s_weaponTemplateCount; ++i) {
        if (std::strncmp(s_weaponTemplates[i].model, modelName, sizeof(s_weaponTemplates[i].model) - 1) == 0) return;
    }
    if (s_weaponTemplateCount >= (s32)(sizeof(s_weaponTemplates) / sizeof(s_weaponTemplates[0]))) return;
    WeaponTemplate& t = s_weaponTemplates[s_weaponTemplateCount++];
    t.type = type;
    std::strncpy(t.model, modelName, sizeof(t.model) - 1);
    t.collisionPointCount = pickup->collisionPointCount;
    for (s32 i = 0; i < 3; ++i) t.collisionPoints[i] = pickup->collisionPoints[i];
    t.fightingSystemRoot = pickup->fightingSystemRoot;
    t.collisionRadius = pickup->collisionRadius;
    t.field332 = pickup->field332;
    t.orientation = pickup->orientation;
}

// ---------------------------------------------------------------------------
// Mod "No fall deaths".
static LVector s_safeGround = {};
static bool s_safeGroundValid = false;
static u32 s_safeGroundLevel = 0xFFFFFFFFu;

static u32 CurrentLevelKey() {
    World* world = g_game ? g_game->GetWorld() : nullptr;
    return world ? ((u32)world->GetCurLevelID() << 8) | world->GetCurrentPetalIndex() : 0u;
}

// Recent safe positions, one every 10 frames; the rescue uses the oldest
// (~1 s back), away from the edge Jackie just walked off.
static LVector s_safeHistory[4] = {};
static s32 s_safeHistoryCount = 0;
static s32 s_safeTick = 0;

void ModNoteSafeGround(const LVector& pos) {
    const u32 level = CurrentLevelKey();
    if (level != s_safeGroundLevel) { s_safeHistoryCount = 0; s_safeTick = 0; }
    s_safeGroundLevel = level;
    if ((s_safeTick++ % 10) == 0) {
        if (s_safeHistoryCount < 4) s_safeHistory[s_safeHistoryCount++] = pos;
        else { for (s32 i = 0; i < 3; ++i) s_safeHistory[i] = s_safeHistory[i + 1]; s_safeHistory[3] = pos; }
    }
    s_safeGround = s_safeHistory[0];
    s_safeGroundValid = s_safeHistoryCount > 0;
}

bool ModReturnToSafeGround() {
    Player* player = Player::s_player;
    if (!player || !s_safeGroundValid || s_safeGroundLevel != CurrentLevelKey()) return false;
    player->pos = s_safeGround;
    player->pos.y += 64;                 // just above the floor
    player->homePos = player->pos;
    player->velocity = {};
    player->force = {};
    player->contactForce = {};
    player->SetActionState(AS_FALL, 0);
    LOG_ALWAYS("[Mod] No fall deaths: back to safe ground (%d,%d,%d)", s_safeGround.x, s_safeGround.y, s_safeGround.z);
    return true;
}

s32 CollectFightingTreeAnims(u32 rootAddress, s32* out, s32 maxOut);  // humanoid.cpp

static bool s_selectPressed = false;
void ModNoteSelectPress() { s_selectPressed = true; }
bool ModTakeSelectPress() {
    const bool pressed = s_selectPressed;
    s_selectPressed = false;
    return pressed;
}

bool ModDropRandomWeapon() {
    Player* player = Player::s_player;
    if (!g_ai || !player) return false;
    if (s_weaponTemplateCount == 0) {
        LOG_ALWAYS("[Mod] Random weapon: this level has no weapons");
        return false;
    }
    static u32 s_seed = 0x2545F491u;
    s_seed = s_seed * 1664525u + 1013904223u + (u32)(g_time ? g_time->GetFrameCounter() : 0u);
    const WeaponTemplate& t = s_weaponTemplates[(s_seed >> 8) % (u32)s_weaponTemplateCount];

    // A little in front of Jackie and well above his head; gravity does the rest.
    LVector pos = player->pos;
    pos.x += (s32)(((s64)rmSin16(player->faceAngle) * 300) >> 16);
    pos.z += (s32)(((s64)rmSin16(player->faceAngle + 0x4000) * 300) >> 16);
    pos.y += 1400;
    // The weapon's own animations (swings, idle) are loaded per zone by the
    // level; load their groups here so it can be used anywhere.
    if (g_characterManager) {
        s32 anims[48];
        s32 n = CollectFightingTreeAnims(t.fightingSystemRoot, anims, 48);
        for (s32 i = 0; i < n; ++i) {
            if (anims[i] >= 0x7C) g_characterManager->LoadAnimationGroupContaining((u32)AITypes::TT_PLAYER, anims[i]);
        }
    }
    Thing* thing = g_ai->AddThingNoTagList(nullptr, t.type, &pos, nullptr, t.model, nullptr);
    Pickup* pickup = static_cast<Pickup*>(thing);
    if (!pickup) return false;
    pickup->pos = pos;
    pickup->collisionPointCount = t.collisionPointCount;
    for (s32 i = 0; i < 3; ++i) pickup->collisionPoints[i] = t.collisionPoints[i];
    pickup->fightingSystemRoot = t.fightingSystemRoot;
    pickup->collisionRadius = t.collisionRadius;
    pickup->field332 = t.field332;
    pickup->orientation = t.orientation;
    if (g_characterManager && pickup->idleAnim >= 0x7C) {
        g_characterManager->LoadAnimationGroupContaining((u32)AITypes::TT_PLAYER, pickup->idleAnim);
    }
    pickup->homePos = pos;
    if (g_blockManager) pickup->blockNum = (u16)g_blockManager->GetBlockNumber(pos);
    // Awake and airborne: AI thinks only activated things, and a resting
    // pickup is moved to the "on the floor" list where Jackie can grab it.
    pickup->flags |= TF_ACTIVATED;
    pickup->flags &= ~TF_ON_GROUND;
    pickup->velocity = {};
    LOG_ALWAYS("[Mod] Random weapon: dropped %s (type %u, %d kinds in this level)", t.model, (u32)t.type, s_weaponTemplateCount);
    return true;
}

#endif
