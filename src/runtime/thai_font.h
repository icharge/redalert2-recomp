#pragma once

#include <stdint.h>
#include "recomp_types.h"

void thai_font_set_enabled(int enabled);
void recomp_thai_call(uint32_t target, recomp_func_t original);

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
