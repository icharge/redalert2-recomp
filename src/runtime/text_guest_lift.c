/*
 * Lifted-call side of the TTF text adapter.
 *
 * recomp_thai_call routes measure and label entry points here first. This
 * file reads the guest registers and stack for each edition, derives the
 * surface channel layout from the game's own globals, and calls the adapter
 * (text_guest.c). A return of 0 means "not handled": the caller then runs
 * the original renderer, unchanged.
 *
 * Calling convention (proven in the YR/RA2 assembly notes):
 *   measure: ECX font; stack +4 text, +8 widthOut, +12 heightOut, +16 wrap;
 *            callee cleans 16 bytes; result bool in AL.
 *   label:   ECX font; stack +4 text, +8 x, +12 y, +16 maxUnits, +20 reveal;
 *            callee cleans 20 bytes; result x in EAX.
 * The return address sits at g_esp, so cleanup is 4 + the argument bytes.
 */
#include <stdint.h>

#include "recomp_types.h"
#include "recomp_target.h"
#include "recomp_funcs.h"
#include "thai_font.h"
#include "text_guest.h"

#ifdef RA2_TARGET_GAME
#define TTF_MEASURE_VA 0x004314B0u
#define TTF_LABEL_VA   0x00431CC0u
#define TTF_FMT_R_SRC 0x00852FB8u
#define TTF_FMT_R_UP  0x00852FBCu
#define TTF_FMT_G_SRC 0x00852FC8u
#define TTF_FMT_G_UP  0x00852FCCu
#define TTF_FMT_B_SRC 0x00852FC0u
#define TTF_FMT_B_UP  0x00852FC4u
#else
#define TTF_MEASURE_VA 0x00433CF0u
#define TTF_LABEL_VA   0x00434500u
#define TTF_FMT_R_SRC 0x008A0DD0u
#define TTF_FMT_R_UP  0x008A0DD4u
#define TTF_FMT_G_SRC 0x008A0DE0u
#define TTF_FMT_G_UP  0x008A0DE4u
#define TTF_FMT_B_SRC 0x008A0DD8u
#define TTF_FMT_B_UP  0x008A0DDCu
#endif

/* Read the channel layout the game itself uses for packed 16-bit colours:
 * (pixel >> src) << up gives the 8-bit channel, so the channel's bit position
 * is src and its width is 8 - up. Returns 0 if the globals are not a valid
 * layout for a 16-bit surface. */
static int read_channel(uint32_t src_va, uint32_t up_va, uint8_t *shift, uint8_t *bits) {
    uint32_t src = MEM32(src_va) & 0xFFu;
    uint32_t up = MEM32(up_va) & 0xFFu;
    if (up > 7 || src > 15) return 0;
    uint32_t width = 8u - up;
    if (src + width > 16) return 0;
    *shift = (uint8_t)src;
    *bits = (uint8_t)width;
    return 1;
}

static int sync_format(void) {
    TextGuestPixelFormat fmt;
    if (!read_channel(TTF_FMT_R_SRC, TTF_FMT_R_UP, &fmt.r_shift, &fmt.r_bits)) return 0;
    if (!read_channel(TTF_FMT_G_SRC, TTF_FMT_G_UP, &fmt.g_shift, &fmt.g_bits)) return 0;
    if (!read_channel(TTF_FMT_B_SRC, TTF_FMT_B_UP, &fmt.b_shift, &fmt.b_bits)) return 0;
    text_guest_set_pixel_format(&fmt);
    return 1;
}

int recomp_ttf_call(uint32_t target) {
    if (target != TTF_MEASURE_VA && target != TTF_LABEL_VA) return 0;
    if (!text_guest_enabled()) return 0;
    if (!sync_format()) return 0;

    if (target == TTF_MEASURE_VA) {
        uint32_t font = g_ecx;
        uint32_t text = MEM32(g_esp + 4);
        uint32_t width_out = MEM32(g_esp + 8);
        uint32_t height_out = MEM32(g_esp + 12);
        int32_t wrap = (int32_t)MEM32(g_esp + 16);
        int32_t width = 0, height = 0;
        if (!text_guest_measure(font, text, wrap, &width, &height)) return 0;
        if (width_out) MEM32(width_out) = (uint32_t)width;
        if (height_out) MEM32(height_out) = (uint32_t)height;
        g_eax = 1; /* bool true, low byte in AL */
        g_esp += 4 + 16;
        return 1;
    }

    uint32_t font = g_ecx;
    uint32_t text = MEM32(g_esp + 4);
    int32_t x = (int32_t)MEM32(g_esp + 8);
    int32_t y = (int32_t)MEM32(g_esp + 12);
    uint32_t max_units = MEM32(g_esp + 16);
    int32_t reveal = (int32_t)MEM32(g_esp + 20);
    int32_t final_x = x;
    if (!text_guest_label(font, text, x, y, max_units, reveal, &final_x)) return 0;
    g_eax = (uint32_t)final_x;
    g_esp += 4 + 20;
    return 1;
}
