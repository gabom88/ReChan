# ReChan - WebAssembly (Emscripten) build
#
#   source /path/to/emsdk/emsdk_env.sh
#   make -C web -j$(nproc)
#
# Output goes to web/dist/ (static files ready for GitHub Pages).
# Single-threaded build: no pthreads, no SharedArrayBuffer, so it runs on any
# static host (GitHub Pages cannot send COOP/COEP headers) and on iOS Safari.

ROOT      := ..
BUILD     ?= build
DIST      ?= dist
DEBUG     ?= 0

CXX       := em++
CC        := emcc

SRC_DIRS  := $(ROOT)/src/ai $(ROOT)/src/gen $(ROOT)/src/fe $(ROOT)/src/snd \
             $(ROOT)/src/xclib $(ROOT)/src/extra $(ROOT)/src/pc \
             $(ROOT)/src/radlib $(ROOT)/src/radmovie \
             $(ROOT)/vendor/libp3d/p3d $(ROOT)/vendor/libp3d/pddi/gles \
             $(ROOT)/vendor/libp3d/vendor/imgui

CPP_SRCS  := $(foreach d,$(SRC_DIRS),$(wildcard $(d)/*.cpp))
OBJS      := $(patsubst $(ROOT)/%.cpp,$(BUILD)/%.o,$(CPP_SRCS))
DEPS      := $(OBJS:.o=.d)

INCLUDES  := -I$(ROOT)/src -I$(ROOT)/vendor/libp3d \
             -I$(ROOT)/vendor/libp3d/vendor/imgui \
             -I$(ROOT)/vendor/miniaudio -I$(ROOT)/vendor/cgltf

DEFINES   := -DRC_PLATFORM_WEB -DIMGUI_DISABLE_DEFAULT_SHELL_FUNCTIONS

ifeq ($(DEBUG),1)
  OPT     := -O1 -g -DDEBUG
else
  OPT     := -O3 -DNDEBUG
endif

# -fno-strict-aliasing / -fwrapv: ReChan is developed against MSVC, which never
# applies type-based alias analysis or signed-overflow assumptions. The
# reimplemented PSX code type-puns freely (s32 <-> u32/s16 views, fixed-point
# shifts), so clang -O3 must not either, or logic breaks in rare, hard-to-see
# ways (e.g. the player freezing mid-level).
CXXFLAGS  := -std=gnu++20 $(OPT) $(DEFINES) $(INCLUDES) -MMD -MP \
             -fno-strict-aliasing -fwrapv \
             -Wno-deprecated-declarations -Wno-nontrivial-memaccess

# EXTRA_LDFLAGS=--profiling-funcs keeps function names for readable call stacks.
LDFLAGS   := $(OPT) $(EXTRA_LDFLAGS) \
             -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=262144 \
             -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 \
             -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456 \
             -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=8388608 \
             -sENVIRONMENT=web -sEXIT_RUNTIME=0 \
             -sFORCE_FILESYSTEM=1 -lidbfs.js \
             -sEXPORTED_RUNTIME_METHODS=FS,IDBFS,HEAPU8,HEAPF32,addRunDependency,removeRunDependency,UTF8ToString,stringToNewUTF8 \
             -sEXPORTED_FUNCTIONS=_main,_malloc,_free,_rcweb_input_state,_rcweb_debug_dump \
             --pre-js rechan_web.pre.js \
             --preload-file $(ROOT)/res/pc@/rechan/pc

.PHONY: all clean dist

all: dist

$(BUILD)/%.o: $(ROOT)/%.cpp Makefile
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(DIST)/rechan.js: $(OBJS) rechan_web.pre.js
	@mkdir -p $(DIST)
	$(CXX) $(OBJS) $(LDFLAGS) -o $@

# Stamp the service worker with a build id so installed PWAs pick up updates.
BUILD_ID  ?= $(shell date +%Y%m%d%H%M%S)

dist: $(DIST)/rechan.js
	cp -r shell/. $(DIST)/
	sed -i 's/__RECHAN_BUILD__/$(BUILD_ID)/' $(DIST)/sw.js
	touch $(DIST)/.nojekyll

clean:
	rm -rf $(BUILD) $(DIST)

-include $(DEPS)
