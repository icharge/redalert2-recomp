#pragma once

#include <stdint.h>
#include "recomp_types.h"
#include "recomp_target.h"

void thai_font_set_enabled(int enabled);
void recomp_thai_call(uint32_t target, recomp_func_t original);
void recomp_thai_indirect_call(uint32_t target);

#ifdef RA2_TARGET_GAME
#define RECOMP_THAI_TARGET(va) ((va) == 0x00432490u || (va) == 0x004318E0u || (va) == 0x00431CC0u)
#else
#define RECOMP_THAI_TARGET(va) ((va) == 0x00434CD0u || (va) == 0x00434120u || (va) == 0x00434500u)
#endif

#ifdef RA2_NO_THAI_HOOK
/* Measurement switch (web Task 2c): with this defined, the font entry points
 * are plain lifted calls with no wrapper, so the wrapper's cost can be timed
 * A/B. Not for the shipped build; leave it undefined. */
#define RECOMP_THAI_CALL(va, fn) RECOMP_CALL(fn)
#define RECOMP_THAI_ICALL(target_va) RECOMP_ICALL(target_va)
#else
/* Preserve the lifted call boundary, while letting the host adjust the font
 * and glyph metrics around the original function. */
#define RECOMP_THAI_CALL(va, fn) do { \
    uint32_t _caller = g_cur_func; \
    PUSH32(esp, RECOMP_RETADDR); \
    RECOMP_FLAGS_OUT(); \
    RECOMP_REGS_OUT(); \
    recomp_thai_call((uint32_t)(va), (fn)); \
    RECOMP_REGS_IN(); \
    g_cur_func = _caller; \
} while (0)

/* Some text rendering paths dispatch the glyph renderer through a vtable.
 * Keep ordinary indirect calls on the fast path, but route font entry points
 * through the shaper when the fix is enabled. */
#define RECOMP_THAI_ICALL(target_va) do { \
    uint32_t _thai_va = (uint32_t)(target_va); \
    if (!RECOMP_THAI_TARGET(_thai_va)) { \
        RECOMP_ICALL(_thai_va); \
    } else { \
        uint32_t _caller = g_cur_func; \
        PUSH32(esp, RECOMP_RETADDR); \
        RECOMP_FLAGS_OUT(); \
        RECOMP_REGS_OUT(); \
        recomp_thai_indirect_call(_thai_va); \
        RECOMP_REGS_IN(); \
        g_cur_func = _caller; \
    } \
} while (0)
#endif
