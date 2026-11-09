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

#ifdef RA2_TTF_TEXT_TESTING
/* The harness maps the external edition globals through a callback; the
 * production path below reads them with the real guest-memory macro. */
extern uint32_t text_guest_test_mem32(uint32_t address);
#define TTF_MEM32(address) text_guest_test_mem32(address)
#else
#define TTF_MEM32(address) MEM32(address)
#endif

#ifdef RA2_TARGET_GAME
#define TTF_MEASURE_VA 0x004314B0u
#define TTF_LABEL_VA   0x00431CC0u
#define TTF_PARA_VA    0x00432490u
#define TTF_SETUP_VA   0x004320B0u
#define TTF_RELEASE_VA 0x00432150u
#define TTF_FMT_R_SRC 0x00852FB8u
#define TTF_FMT_R_UP  0x00852FBCu
#define TTF_FMT_G_SRC 0x00852FC8u
#define TTF_FMT_G_UP  0x00852FCCu
#define TTF_FMT_B_SRC 0x00852FC0u
#define TTF_FMT_B_UP  0x00852FC4u
#else
#define TTF_MEASURE_VA 0x00433CF0u
#define TTF_LABEL_VA   0x00434500u
#define TTF_PARA_VA    0x00434CD0u
#define TTF_SETUP_VA   0x004348F0u
#define TTF_RELEASE_VA 0x00434990u
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
    uint32_t src = TTF_MEM32(src_va) & 0xFFu;
    uint32_t up = TTF_MEM32(up_va) & 0xFFu;
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

/* Call a guest function that takes ECX = font and one stack argument and
 * returns with ret 4, as the surface setup and release do. The callee pops
 * its own argument and return address, so both are pushed here. */
static void call_surface(uint32_t va, uint32_t font, uint32_t surface) {
    recomp_func_t fn = recomp_lookup_manual(va);
    if (!fn) fn = recomp_lookup(va);
    uint32_t saved_ecx = g_ecx, saved_func = g_cur_func;
    g_ecx = font;
    g_esp -= 4;
    MEM32(g_esp) = surface;
    g_esp -= 4;
    MEM32(g_esp) = RECOMP_RETADDR;
    fn();
    g_ecx = saved_ecx;
    g_cur_func = saved_func;
}

struct SurfaceCalls {
    uint32_t setup, release;
};

static void setup_surface(uint32_t font, uint32_t surface, void *ctx) {
    call_surface(((struct SurfaceCalls *)ctx)->setup, font, surface);
}

static void release_surface(uint32_t font, uint32_t surface, void *ctx) {
    call_surface(((struct SurfaceCalls *)ctx)->release, font, surface);
}

static int function_present(uint32_t va) {
    return recomp_lookup_manual(va) != NULL || recomp_lookup(va) != NULL;
}

int recomp_ttf_call(uint32_t target) {
    if (target != TTF_MEASURE_VA && target != TTF_LABEL_VA && target != TTF_PARA_VA) return 0;
    if (!text_guest_enabled()) return 0;
    if (!sync_format()) return 0;

    if (target == TTF_PARA_VA) {
        /* Stack: font +4, surface +8, text +12, x +16, y +20, wrap +24,
         * max height +28, align flags +32, reveal +36, reveal range +40. */
        if (!function_present(TTF_SETUP_VA) || !function_present(TTF_RELEASE_VA)) return 0;
        struct SurfaceCalls calls = { TTF_SETUP_VA, TTF_RELEASE_VA };
        uint32_t font = MEM32(g_esp + 4);
        uint32_t surface = MEM32(g_esp + 8);
        uint32_t text = MEM32(g_esp + 12);
        int32_t x = (int32_t)MEM32(g_esp + 16);
        int32_t y = (int32_t)MEM32(g_esp + 20);
        int32_t wrap = (int32_t)MEM32(g_esp + 24);
        int32_t max_height = (int32_t)MEM32(g_esp + 28);
        uint32_t align = MEM32(g_esp + 32);
        int32_t reveal = (int32_t)MEM32(g_esp + 36);
        int32_t reveal_range = (int32_t)MEM32(g_esp + 40);
        if (!text_guest_paragraph(font, surface, text, x, y, wrap, max_height, align, reveal,
                                  reveal_range, setup_surface, release_surface, &calls))
            return 0;
        g_eax = 1; /* bool true, low byte in AL */
        g_esp += 4 + 40;
        return 1;
    }

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
