#pragma once
#include "gen/common.h"
#include <string>

// AnimWatch — detects humanoids (player and enemies) whose logic has stopped:
// alive, yet the same action state, animation and animation frame for
// kStuckLogicFrames logic ticks. Each new stuck episode is logged once as
// "[AnimWatch] STUCK ..." with everything needed to find the missing state
// transition (action state, anim, loop type, pending anim-end callback).
//
// Always on in the web build and in --autotest runs; costs one pass over the
// humanoid list per logic tick.
void AnimWatch_Step();
void AnimWatch_Reset();
bool AnimWatch_IsEnabled();
s32 AnimWatch_GetStuckCount();          // stuck episodes seen since reset
std::string AnimWatch_Describe();       // one line per live humanoid
