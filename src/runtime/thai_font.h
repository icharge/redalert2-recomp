#pragma once

#include <stdint.h>
#include "recomp_types.h"
#include "recomp_target.h"

void thai_font_set_enabled(int enabled);
void recomp_thai_call(uint32_t target, recomp_func_t original);
/* With the fix on, the entry function for a Thai font entry point (a static
 * function that calls recomp_thai_call with the original found by the lookup
 * chain); NULL when the original does not resolve. */
recomp_func_t recomp_thai_trampoline(uint32_t va);

#ifdef RA2_TARGET_GAME
#define RECOMP_THAI_TARGET(va) ((va) == 0x00432490u || (va) == 0x004318E0u || (va) == 0x00431CC0u)
#else
#define RECOMP_THAI_TARGET(va) ((va) == 0x00434CD0u || (va) == 0x00434120u || (va) == 0x00434500u)
#endif

/* Set once at startup by thai_font_set_enabled (src/web/main.c). While it is
 * 0 the font entry points are plain lifted calls: the macros below test it
 * inline, so the off path is exactly RECOMP_CALL / RECOMP_ICALL. */
extern int g_thai_font_on;

/* Preserve the lifted call boundary, while letting the host adjust the font
 * and glyph metrics around the original function. */
#define RECOMP_THAI_CALL(va, fn) do { \
    if (!g_thai_font_on) { \
        RECOMP_CALL(fn); \
    } else { \
        uint32_t _caller = g_cur_func; \
        PUSH32(esp, RECOMP_RETADDR); \
        RECOMP_FLAGS_OUT(); \
        RECOMP_REGS_OUT(); \
        recomp_thai_call((uint32_t)(va), (fn)); \
        RECOMP_REGS_IN(); \
        g_cur_func = _caller; \
    } \
} while (0)

/* Every indirect call in the lifted game is RECOMP_THAI_ICALL (54,638 sites),
 * so this body mirrors pcrecomp's RECOMP_ICALL (runtime/recomp32/recomp_types.h)
 * and adds one step after the lookup. It keeps one call sequence per site: an
 * earlier version carried a second, Thai-only sequence at every site and ran the
 * busy save at 23 to 24 fps, where build B (one sequence per site, no Thai check)
 * ran it at 62 (Task 2c; Task 2d's record in the plan's Results).
 * With the fix off (g_thai_font_on == 0) the step is one load and a branch, and
 * the call is exactly RECOMP_ICALL's. With the fix on, a Thai font entry point
 * is replaced by the trampoline that runs the shaper around the original. */
#define RECOMP_THAI_ICALL(target_va) do { \
    uint32_t _va = (uint32_t)(target_va); \
    g_icall_trace[g_icall_trace_idx & (ICALL_TRACE_SIZE-1)] = _va; \
    g_icall_from[g_icall_trace_idx & (ICALL_TRACE_SIZE-1)] = g_cur_func; \
    g_icall_trace_idx++; \
    g_icall_count++; \
    recomp_func_t _fn = recomp_lookup_manual(_va); \
    if (!_fn) _fn = recomp_lookup(_va); \
    if (!_fn) _fn = recomp_lookup_import(_va); \
    if (g_thai_font_on && RECOMP_THAI_TARGET(_va)) _fn = recomp_thai_trampoline(_va); \
    if (_fn) { \
        uint32_t _caller = g_cur_func; \
        PUSH32(esp, RECOMP_RETADDR); \
        RECOMP_FLAGS_OUT(); \
        RECOMP_REGS_OUT(); \
        _fn(); \
        RECOMP_REGS_IN(); \
        g_cur_func = _caller; \
    } else { \
        /* As RECOMP_ICALL: nothing was pushed on this path. */ \
        fprintf(stderr, "ICALL: unresolved VA 0x%08X from 0x%08X\n", _va, g_cur_func); \
        eax = 0; \
    } \
} while (0)
