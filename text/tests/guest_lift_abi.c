/* Executes the production lifted adapter against the real Rust layout engine.
 * Guest memory/registers are real 32-bit addresses; only surface setup/release
 * dispatch targets are stand-ins for the external lifted functions. */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "recomp_types.h"
#include "recomp_funcs.h"
#include "recomp_target.h"
#include "thai_font.h"
#include "text_guest.h"

#ifdef RA2_TARGET_GAME
#define MEASURE_VA 0x004314B0u
#define LABEL_VA   0x00431CC0u
#define PARA_VA    0x00432490u
#define SETUP_VA   0x004320B0u
#define RELEASE_VA 0x00432150u
#define FMT_R_SRC  0x00852FB8u
#define FMT_R_UP   0x00852FBCu
#define FMT_G_SRC  0x00852FC8u
#define FMT_G_UP   0x00852FCCu
#define FMT_B_SRC  0x00852FC0u
#define FMT_B_UP   0x00852FC4u
#else
#define MEASURE_VA 0x00433CF0u
#define LABEL_VA   0x00434500u
#define PARA_VA    0x00434CD0u
#define SETUP_VA   0x004348F0u
#define RELEASE_VA 0x00434990u
#define FMT_R_SRC  0x008A0DD0u
#define FMT_R_UP   0x008A0DD4u
#define FMT_G_SRC  0x008A0DE0u
#define FMT_G_UP   0x008A0DE4u
#define FMT_B_SRC  0x008A0DD8u
#define FMT_B_UP   0x008A0DDCu
#endif

uint32_t g_eax, g_ecx, g_edx, g_esp;
uint32_t g_ebx, g_esi, g_edi, g_ebp;
uint32_t g_cur_func;
uint32_t g_icall_trace[ICALL_TRACE_SIZE], g_icall_from[ICALL_TRACE_SIZE];
uint32_t g_icall_trace_idx, g_icall_count;

enum { FONT_SIZE = 0x80, PITCH = 176, WIDTH = 160, HEIGHT = 40, GUARD = 64 };
static uint8_t *g_pixels;
static uint8_t *g_allocation;
static uint8_t *g_font;
static unsigned g_setups, g_releases;
static unsigned g_original_calls;
static struct { uint32_t address, value; } g_format_globals[6];
static unsigned g_format_global_count;
static void fake_original(void);

static uint32_t va(const void *p) { return (uint32_t)(uintptr_t)p; }
static void put32(void *p, uint32_t value) { memcpy(p, &value, sizeof value); }
static uint32_t get32(const void *p) { uint32_t v; memcpy(&v, p, sizeof v); return v; }
static void set_global(uint32_t address, uint32_t value) {
    for (unsigned i = 0; i < g_format_global_count; ++i)
        if (g_format_globals[i].address == address) { g_format_globals[i].value = value; return; }
    assert(g_format_global_count < 6);
    g_format_globals[g_format_global_count].address = address;
    g_format_globals[g_format_global_count++].value = value;
}

uint32_t text_guest_test_mem32(uint32_t address) {
    for (unsigned i = 0; i < g_format_global_count; ++i)
        if (g_format_globals[i].address == address) return g_format_globals[i].value;
    fprintf(stderr, "unexpected edition global read 0x%08X\n", address);
    abort();
}

static void set_format_565(void) {
    set_global(FMT_R_SRC, 11); set_global(FMT_R_UP, 3);
    set_global(FMT_G_SRC, 5);  set_global(FMT_G_UP, 2);
    set_global(FMT_B_SRC, 0);  set_global(FMT_B_UP, 3);
}

static void set_format_555(void) {
    set_global(FMT_R_SRC, 10); set_global(FMT_R_UP, 3);
    set_global(FMT_G_SRC, 5);  set_global(FMT_G_UP, 3);
    set_global(FMT_B_SRC, 0);  set_global(FMT_B_UP, 3);
}

static void fake_setup(void) {
    uint32_t surface = MEM32(g_esp + 4);
    uint8_t *font = (uint8_t *)(uintptr_t)g_ecx;
    put32(font + 0x0C, surface);
    put32(font + 0x10, PITCH);
    int32_t clip[4] = { 0, 0, WIDTH - 1, HEIGHT - 1 };
    memcpy(font + 0x30, clip, sizeof clip);
    font[0x41] = 1;
    ++g_setups;
    g_eax = 0x12345678; /* caller-saved; adapter must set the final bool */
    g_esp += 8; /* ret 4 */
}

static void fake_release(void) {
    uint8_t *font = (uint8_t *)(uintptr_t)g_ecx;
    put32(font + 0x0C, 0);
    put32(font + 0x10, 0);
    ++g_releases;
    g_esp += 8;
}

recomp_func_t recomp_lookup_manual(uint32_t address) {
    if (address == SETUP_VA) return fake_setup;
    if (address == RELEASE_VA) return fake_release;
    if (address == MEASURE_VA || address == LABEL_VA || address == PARA_VA) return fake_original;
    return NULL;
}
recomp_func_t recomp_lookup(uint32_t address) { return recomp_lookup_manual(address); }
recomp_func_t recomp_lookup_import(uint32_t address) { (void)address; return NULL; }

static void fake_original(void) { ++g_original_calls; }

static void fixture_init(uint16_t foreground) {
    g_allocation = (uint8_t *)malloc((size_t)PITCH * HEIGHT * 2 + 2 * GUARD);
    g_font = (uint8_t *)calloc(1, FONT_SIZE);
    assert(g_allocation && g_font);
    memset(g_allocation, 0xA5, (size_t)PITCH * HEIGHT * 2 + 2 * GUARD);
    g_pixels = g_allocation + GUARD;
    memset(g_pixels, 0, (size_t)PITCH * HEIGHT * 2);
    put32(g_font + 0x0C, va(g_pixels));
    put32(g_font + 0x10, PITCH);
    put32(g_font + 0x1C, 16);
    memcpy(g_font + 0x24, &foreground, sizeof foreground);
    int32_t clip[4] = { 0, 0, WIDTH - 1, HEIGHT - 1 };
    memcpy(g_font + 0x30, clip, sizeof clip);
    g_font[0x41] = 1;
}

static void fixture_clear(void) {
    free(g_allocation); free(g_font);
    g_allocation = g_font = g_pixels = NULL;
}

static int ink_count(void) {
    int count = 0;
    for (uint32_t y = 0; y < HEIGHT; ++y)
        for (uint32_t x = 0; x < WIDTH; ++x) {
            uint16_t pixel;
            memcpy(&pixel, g_pixels + ((size_t)y * PITCH + x) * 2, 2);
            count += pixel != 0;
        }
    return count;
}

static void assert_padding_and_guards(void) {
    for (uint32_t y = 0; y < HEIGHT; ++y)
        for (uint32_t x = WIDTH; x < PITCH; ++x) {
            uint16_t px;
            memcpy(&px, g_pixels + ((size_t)y * PITCH + x) * 2, 2);
            assert(px == 0);
        }
    for (int i = 0; i < GUARD; ++i) {
        assert(g_allocation[i] == 0xA5);
        assert(g_allocation[GUARD + (size_t)PITCH * HEIGHT * 2 + i] == 0xA5);
    }
}

int main(void) {
    text_guest_set_enabled(1);
    text_guest_set_all(1);
    assert(RECOMP_THAI_TARGET(MEASURE_VA));
    assert(RECOMP_THAI_TARGET(LABEL_VA));
    assert(RECOMP_THAI_TARGET(PARA_VA));

    /* Both packed layouts come from the selected edition's absolute globals. */
    fixture_init(0xFFFF);
    set_format_565();
    uint16_t text[] = { 'R', 'A', '2', 0 };
    int32_t width = -1, height = -1;
    uint32_t measure_stack[5] = { RECOMP_RETADDR, va(text), va(&width), va(&height), 0 };
    uint32_t saved_esp = va(measure_stack);
    g_esp = saved_esp; g_ecx = va(g_font); g_eax = 0x89ABCDEF; g_cur_func = 0x12345678;
    g_ebx = 0x11; g_esi = 0x22; g_edi = 0x33; g_ebp = 0x44;
    assert(recomp_ttf_call(MEASURE_VA) == 1);
    assert(g_eax == 1 && g_esp == saved_esp + 20);
    assert(width > 0 && height > 0);
    assert(g_ecx == va(g_font) && g_cur_func == 0x12345678);
    assert(g_ebx == 0x11 && g_esi == 0x22 && g_edi == 0x33 && g_ebp == 0x44);

    uint32_t label_stack[6] = { RECOMP_RETADDR, va(text), 8, 2, 0, 1 };
    saved_esp = va(label_stack);
    g_esp = saved_esp; g_ecx = va(g_font); g_eax = 0;
    unsigned originals_before = g_original_calls;
    recomp_thai_call(LABEL_VA, fake_original);
    assert((int32_t)g_eax == 8 + width && g_esp == saved_esp + 24);
    assert(g_original_calls == originals_before);
    assert(ink_count() > 0);
    assert_padding_and_guards();

    /* A decline leaves every guest register, stack slot, and destination byte
     * untouched so recomp_thai_call can take its original path. */
    memset(g_pixels, 0, (size_t)PITCH * HEIGHT * 2);
    uint16_t control[] = { 'A', 0x0A, 'B', 0 };
    uint32_t decline_stack[5] = { RECOMP_RETADDR, va(control), 0, 0, 0 };
    saved_esp = va(decline_stack);
    g_esp = saved_esp; g_ecx = va(g_font); g_eax = 0x76543210; g_edx = 0x56;
    g_ebx = 0x11; g_esi = 0x22; g_edi = 0x33; g_ebp = 0x44; g_cur_func = 0x12345678;
    assert(recomp_ttf_call(MEASURE_VA) == 0);
    assert(g_eax == 0x76543210 && g_edx == 0x56 && g_esp == saved_esp);
    assert(g_ecx == va(g_font) && g_cur_func == 0x12345678);
    assert(g_ebx == 0x11 && g_esi == 0x22 && g_edi == 0x33 && g_ebp == 0x44);
    assert(ink_count() == 0);
    recomp_thai_call(MEASURE_VA, fake_original);
    assert(g_original_calls == 1);
    assert(g_eax == 0x76543210 && g_edx == 0x56 && g_esp == saved_esp);
    assert(g_ecx == va(g_font) && g_cur_func == 0x12345678);
    assert(g_ebx == 0x11 && g_esi == 0x22 && g_edi == 0x33 && g_ebp == 0x44);
    assert(ink_count() == 0);

    /* Paragraph handling crosses only the external setup/release dispatch
     * boundary; layout, blending, registers and cleanup are production code. */
    set_format_555();
    uint16_t paragraph[] = { 'P', 'A', 'R', 'A', 'G', 'R', 'A', 'P', 'H', 0 };
    uint32_t *para_storage = (uint32_t *)calloc(16, sizeof(uint32_t));
    assert(para_storage != NULL);
    uint32_t *para_stack = para_storage + 4; /* space below ESP for setup/release calls */
    uint32_t para_args[11] = { RECOMP_RETADDR, va(g_font), va(g_pixels), va(paragraph), 4, 2,
                               150, 0, 1, 0, 0 };
    memcpy(para_stack, para_args, sizeof para_args);
    saved_esp = va(para_stack);
    g_esp = saved_esp; g_ecx = 0; g_eax = 0; g_cur_func = 0x2468ACE0;
    g_ebx = 0x55; g_esi = 0x66; g_edi = 0x77; g_ebp = 0x88;
    originals_before = g_original_calls;
    recomp_thai_indirect_call(PARA_VA);
    assert(g_original_calls == originals_before);
    assert(g_eax == 1 && g_esp == saved_esp + 44);
    assert(g_setups == 1 && g_releases == 1);
    assert(get32(g_font + 0x0C) == 0 && get32(g_font + 0x10) == 0);
    assert(g_cur_func == 0x2468ACE0);
    assert(g_ebx == 0x55 && g_esi == 0x66 && g_edi == 0x77 && g_ebp == 0x88);
    assert(ink_count() > 0);
    for (uint32_t y = 0; y < HEIGHT; ++y)
        for (uint32_t x = 0; x < WIDTH; ++x) {
            uint16_t px;
            memcpy(&px, g_pixels + ((size_t)y * PITCH + x) * 2, 2);
            assert((px & 0x8000u) == 0); /* RGB555 has no high red bit. */
        }
    assert_padding_and_guards();

    free(para_storage);
    fixture_clear();
    puts("lifted TTF guest ABI harness: pass");
    return 0;
}
