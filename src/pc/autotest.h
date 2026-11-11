#pragma once
#include "gen/common.h"

enum class GameState : s32;

// rechan --autotest <levelIndex> [--level-id N] [--petal N] [--frames N] [--fps N]
//        [--hold up,cross,...] [--screenshot out.png]
//        [--warp-generator N] [--kill-interval N] [--trace-spawns]
//        [--fight] [--tour N] [--dump-interval N] [--cheat NAME]... [--jump-spam]
// --fight cycles the attack buttons; --tour N warps to the next enemy
// generator every N gameplay frames. AnimWatch (pc/animwatch.h) runs during
// autotests and flags humanoids whose animation/state stops advancing.
// Exit code: 0 finished, 10 game data missing, 11 never reached gameplay,
// 12 screenshot failed, 20 a humanoid got stuck, 21 game over.
void AutoTest_ParseArgs(int argc, char** argv);
bool AutoTest_IsEnabled();

s32 AutoTest_GetLevelIndex();
s32 AutoTest_GetPetalIndex();
bool AutoTest_TraceSpawns();
s32 AutoTest_GetFps();
f32 AutoTest_GetFixedDeltaTime();
u32 AutoTest_GetHeldButtons();

void AutoTest_Fail(int exitCode, const char* reason);

// Returns false when the run is over.
bool AutoTest_Step(GameState state);
int AutoTest_GetExitCode();
