/* The game's in-match cursor, read from the game's own loaded resources
 * (docs/web/cursor-layer.md).
 *
 * Where the art is: WWMouseClass keeps the MOUSE.SHA file it loaded at boot at
 * +0x04, and the frame it is showing at +0x08. The file is a Westwood SHP —
 * u16 reserved, u16 width, u16 height, u16 frames, then per frame a 24-byte
 * entry {i16 x, i16 y, i16 w, i16 h, u8 compression, u8 x3, u32, u32,
 * u32 data offset} — the layout ra2web's src/data/ShpFile.ts parses too. The
 * pixels are palette indices into MOUSEPAL.PAL, which the game loads once while
 * setting the video mode and builds its cursor converter from; index 0 is
 * transparent.
 *
 * What this module does, and nothing else:
 *   1. copies those 768 palette bytes when the game loads them (the lift's
 *      page_cursor_palette_patches);
 *   2. when the cursor changes shape or frame, decodes that frame to indices and
 *      publishes it with the hot spot and the frame's place in the sheet;
 *   3. lets the page say it draws the cursor itself, in which case the lift
 *      skips the game's blit.
 *
 * It never reads the screen and never locks a surface: the first version did
 * (a diff against the saved background on the primary) and froze the game, see
 * docs/web/cursor-layer.md. Nothing here runs per frame — only when the cursor
 * changes.
 */
#ifdef _WIN32
#include <windows.h>
#else
#define _GNU_SOURCE
#include <pthread.h>
#include <time.h>
#include "win32hle.h"
#endif
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "page_cursor.h"

/* Guest memory at its own addresses (the recomp keeps the game's image where
 * it was linked; on Emscripten GLOBAL_BASE leaves it clear). */
#define G32(a) (*(const volatile uint32_t *)(uintptr_t)(a))
#define G16(a) (*(const volatile uint16_t *)(uintptr_t)(a))
#define G8(a) (*(const volatile uint8_t *)(uintptr_t)(a))

/* WWMouseClass (both editions), as the game itself uses it. */
#define WW_SHAPE 0x04u
#define WW_FRAME 0x08u
#define WW_HOT_X 0x3Cu
#define WW_HOT_Y 0x40u

/* SHP header and frame entries. */
#define SHP_W 2
#define SHP_H 4
#define SHP_FRAMES 6
#define SHP_ENTRY 8
#define SHP_ENTRY_SIZE 24
#define SHP_FRAME_X 0
#define SHP_FRAME_Y 2
#define SHP_FRAME_W 4
#define SHP_FRAME_H 6
#define SHP_COMPRESSION 8
#define SHP_DATA 0x14

/* How long after its last draw the cursor counts as gone: the mouse thread
 * redraws it many times a second while the game shows it, and stops entirely
 * in movies and after a match. */
#define STALE_MS 500u
/* A last frame's data has no next offset to bound it; the game's own thumbnail
 * frames are far smaller than this. */
#define MAX_FRAME_BYTES (64u * 1024u)

#define PC_MAX RA2_PAGE_CURSOR_PX

static uint8_t g_palette[RA2_PALETTE_BYTES];
static uint8_t g_frame[PC_MAX * PC_MAX];     /* the decode's working copy */
static uint8_t g_publish[PC_MAX * PC_MAX];   /* what the host may read (seqlock) */
static ra2_page_cursor_t g_state = { .indices = g_publish, .palette = g_palette };

static uint32_t g_shape, g_frame_index;      /* what g_publish holds */
static volatile uint32_t g_last_draw;
static volatile uint32_t g_mouse;            /* the object Draw_Cursor is on */
static volatile int g_on, g_request;
static volatile int g_trace = -1;
static int g_palette_seen;

static int trace(void) {
    if (g_trace < 0) g_trace = getenv("RA2_PAGE_CURSOR_DEBUG") != NULL;
    return g_trace;
}

static uint32_t now_ms(void) {
#ifdef _WIN32
    return GetTickCount();
#else
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint32_t)((uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u);
#endif
}

/* A 32-bit word shared with the presenter: plain x86 loads/stores are atomic,
 * and MSVC has no __atomic builtins. */
#if defined(_MSC_VER)
#include <intrin.h>
static void state_begin(void) { _InterlockedIncrement((volatile long *)&g_state.seq); }
static void state_end(void) { _InterlockedIncrement((volatile long *)&g_state.seq); }
static void palette_begin(void) { _InterlockedIncrement((volatile long *)&g_state.palette_seq); }
static void palette_end(void) { _InterlockedIncrement((volatile long *)&g_state.palette_seq); }
#define load_word(p) (*(volatile uint32_t *)(p))
#define store_word(p, v) (*(volatile uint32_t *)(p) = (uint32_t)(v))
#else
static void state_begin(void) { __atomic_add_fetch(&g_state.seq, 1u, __ATOMIC_RELEASE); }
static void state_end(void) { __atomic_add_fetch(&g_state.seq, 1u, __ATOMIC_RELEASE); }
static void palette_begin(void) { __atomic_add_fetch(&g_state.palette_seq, 1u, __ATOMIC_RELEASE); }
static void palette_end(void) { __atomic_add_fetch(&g_state.palette_seq, 1u, __ATOMIC_RELEASE); }
#define load_word(p) __atomic_load_n((p), __ATOMIC_ACQUIRE)
#define store_word(p, v) __atomic_store_n((p), (uint32_t)(v), __ATOMIC_RELEASE)
#endif

/* ---- the frame decoders ------------------------------------------------------ */

/* Format 3 (RA2/TD compressed SHP): per scanline a u16 length, then bytes where
 * a non-zero value is one index and a zero value starts a run of transparent
 * pixels. The same rule ra2web's src/data/encoding/Format3.ts implements. */
static int decode_format3(const uint8_t *src, uint32_t limit, int w, int h, uint8_t *out) {
    uint32_t in = 0;
    for (int y = 0; y < h; y++) {
        int x = 0;
        uint8_t *row = out + (size_t)y * w;
        if (in + 2 > limit) return 0;
        int length = (int)(src[in] | (uint32_t)src[in + 1] << 8) - 2;
        in += 2;
        if (length < 0) return 0;
        while (length > 0) {
            if (in >= limit) return 0;
            uint8_t value = src[in++];
            length--;
            if (value) {
                if (x < w) row[x] = value;
                x++;
            } else {
                if (in >= limit) return 0;
                int run = src[in++];
                length--;
                for (int k = 0; k < run && x < w; k++) row[x++] = 0;
            }
        }
    }
    return 1;
}

/* Format 2: per scanline a u16 length, then that many raw indices. */
static int decode_lines(const uint8_t *src, uint32_t limit, int w, int h, uint8_t *out) {
    uint32_t in = 0;
    for (int y = 0; y < h; y++) {
        if (in + 2 > limit) return 0;
        int length = (int)(src[in] | (uint32_t)src[in + 1] << 8) - 2;
        in += 2;
        if (length < 0 || in + (uint32_t)length > limit) return 0;
        for (int x = 0; x < length && x < w; x++) out[(size_t)y * w + x] = src[in + (uint32_t)x];
        in += (uint32_t)length;
    }
    return 1;
}

/* Decode frame `index` of the SHP at `shape` into `out` (w*h indices). */
static int decode_frame(uint32_t shape, uint32_t index, uint8_t *out, int *sheet_w, int *sheet_h, int *x, int *y,
                        int *w, int *h) {
    int sw = (int)G16(shape + SHP_W), sh = (int)G16(shape + SHP_H), frames = (int)G16(shape + SHP_FRAMES);
    uint32_t entry, offset, next = 0;
    int fw, fh;
    if (sw <= 0 || sh <= 0 || frames <= 0 || index >= (uint32_t)frames) return 0;
    entry = shape + SHP_ENTRY + index * SHP_ENTRY_SIZE;
    *x = (int)(int16_t)G16(entry + SHP_FRAME_X), *y = (int)(int16_t)G16(entry + SHP_FRAME_Y);
    fw = (int)G16(entry + SHP_FRAME_W), fh = (int)G16(entry + SHP_FRAME_H);
    offset = G32(entry + SHP_DATA);
    if (fw <= 0 || fh <= 0 || fw > PC_MAX || fh > PC_MAX || !offset) return 0;
    if (index + 1u < (uint32_t)frames) {
        uint32_t next_offset = G32(entry + SHP_ENTRY_SIZE + SHP_DATA);
        if (next_offset > offset) next = next_offset - offset;
    }
    if (!next) next = MAX_FRAME_BYTES;
    memset(out, 0, (size_t)fw * fh);
    switch (G8(entry + SHP_COMPRESSION)) {
    case 0: case 1:                                  /* uncompressed indices */
        if (next < (uint32_t)fw * (uint32_t)fh) return 0;
        memcpy(out, (const void *)(uintptr_t)(shape + offset), (size_t)fw * fh);
        break;
    case 2:
        if (!decode_lines((const uint8_t *)(uintptr_t)(shape + offset), next, fw, fh, out)) return 0;
        break;
    case 3:
        if (!decode_format3((const uint8_t *)(uintptr_t)(shape + offset), next, fw, fh, out)) return 0;
        break;
    default:
        return 0;
    }
    *sheet_w = sw, *sheet_h = sh, *w = fw, *h = fh;
    return 1;
}

/* ---- a synthetic SHP, so the decoders are checked on every run ------------- */

#define W16(a, v) (*(uint16_t *)(uintptr_t)(a) = (uint16_t)(v))
#define W32(a, v) (*(uint32_t *)(uintptr_t)(a) = (uint32_t)(v))

/* Build a tiny SHP in host memory (guest addresses are host addresses here)
 * with one raw frame and one Format 3 frame, decode both, and say whether the
 * indices came back as written. RA2_PAGE_CURSOR_SELFTEST=1 runs it at start. */
static int selftest(void) {
    static uint32_t words[128];
    uint8_t *shp = (uint8_t *)words;
    int x = 0, y = 0, w = 0, h = 0, sw = 0, sh = 0, ok = 1;
    uint32_t base = (uint32_t)(uintptr_t)shp;
    memset(shp, 0, sizeof words);
    W16(base + SHP_W, 8), W16(base + SHP_H, 4), W16(base + SHP_FRAMES, 2);
    /* frame 0: 4x2, uncompressed, data at 0x40 */
    W16(base + SHP_ENTRY + 4, 4), W16(base + SHP_ENTRY + 6, 2);
    shp[SHP_ENTRY + SHP_COMPRESSION] = 1;
    W32(base + SHP_ENTRY + SHP_DATA, 0x40);
    /* frame 1: 4x2, Format 3, data at 0x60 */
    W16(base + SHP_ENTRY + SHP_ENTRY_SIZE + 4, 4), W16(base + SHP_ENTRY + SHP_ENTRY_SIZE + 6, 2);
    shp[SHP_ENTRY + SHP_ENTRY_SIZE + SHP_COMPRESSION] = 3;
    W32(base + SHP_ENTRY + SHP_ENTRY_SIZE + SHP_DATA, 0x60);
    for (int i = 0; i < 8; i++) shp[0x40 + i] = (uint8_t)(i + 1);
    for (int row = 0; row < 2; row++) {              /* u16 length 6, rows of 1,2,3,4 */
        uint32_t at = 0x60 + (uint32_t)row * 6;
        W16(base + at, 6);
        shp[at + 2] = 1, shp[at + 3] = 2, shp[at + 4] = 3, shp[at + 5] = 4;
    }

    if (!decode_frame(base, 0, g_frame, &sw, &sh, &x, &y, &w, &h) || w != 4 || h != 2 || sw != 8 || sh != 4)
        ok = 0;
    else
        for (int i = 0; i < 8; i++)
            if (g_frame[i] != (uint8_t)(i + 1)) ok = 0;
    if (!decode_frame(base, 1, g_frame, &sw, &sh, &x, &y, &w, &h) || w != 4 || h != 2) ok = 0;
    else
        for (int i = 0; i < 8; i++)
            if (g_frame[i] != (uint8_t)(i % 4 + 1)) ok = 0;
    return ok;
}

/* ---- the hook --------------------------------------------------------------- */

void ra2_page_cursor_on(int on) {
    g_on = on != 0;
    if (g_on && getenv("RA2_PAGE_CURSOR_SELFTEST"))
        fprintf(stderr, "[cursor] decoder selftest: %s\n", selftest() ? "ok" : "FAILED");
}

int ra2_page_cursor_enabled(void) { return g_on != 0; }

void ra2_page_cursor_request(int on) { g_request = on != 0; }

int ra2_page_cursor_requested(void) { return g_request != 0; }

int ra2_page_cursor_suppress(void) {
    /* RA2_PAGE_CURSOR_NOSUPPRESS keeps the game's blit: a diagnostic that tells
     * a decode problem from a suppression one. */
    static int no_suppress = -1;
    if (no_suppress < 0) no_suppress = getenv("RA2_PAGE_CURSOR_NOSUPPRESS") != NULL;
    if (no_suppress) return 0;
    /* Only once a frame is published: the first draws teach us the cursor while
     * the game draws it, so there is never a moment with no cursor at all. */
    return g_on && g_request && g_state.visible;
}

/* From the palette load (run_lift.py page_cursor_palette_patches): the game has
 * just read MOUSEPAL.PAL, 768 bytes of r,g,b with each component 0..63. */
void ra2_page_cursor_palette(uint32_t bytes) {
    if (!bytes) return;
    palette_begin();
    memcpy(g_palette, (const void *)(uintptr_t)bytes, sizeof g_palette);
    palette_end();
    if (!g_palette_seen && trace()) {
        g_palette_seen = 1;
        fprintf(stderr, "[cursor] palette: %02X %02X %02X | %02X %02X %02X\n", g_palette[0], g_palette[1],
                g_palette[2], g_palette[3], g_palette[4], g_palette[5]);
    }
}

/* WWMouseClass::Draw_Cursor entry: record the object (the blit site's stack slot
 * reads 0, so it cannot be taken from there). */
void ra2_page_cursor_this(uint32_t mouse) { g_mouse = mouse; }

/* After the blit: if the cursor changed shape or frame, decode and publish it. */
void ra2_page_cursor_drawn(void) {
    uint32_t mouse = g_mouse;                    /* consumed: never read a freed object */
    uint32_t shape, frame;
    int sheet_w = 0, sheet_h = 0, x = 0, y = 0, w = 0, h = 0;
    g_mouse = 0;
    if (!g_on || !mouse) return;
    store_word(&g_last_draw, now_ms());
    shape = G32(mouse + WW_SHAPE);
    frame = G32(mouse + WW_FRAME);
    if (!shape) {
        if (g_state.visible) {
            state_begin();
            g_state.visible = 0;
            state_end();
        }
        return;
    }
    if (shape == g_shape && frame == g_frame_index) return;   /* the common case: nothing to do */
    if (!decode_frame(shape, frame, g_frame, &sheet_w, &sheet_h, &x, &y, &w, &h)) {
        if (trace()) fprintf(stderr, "[cursor] frame %u of 0x%08X did not decode\n", frame, shape);
        state_begin();
        g_state.visible = 0;
        state_end();
        g_shape = shape, g_frame_index = frame;
        return;
    }
    state_begin();
    g_state.sheet_w = sheet_w, g_state.sheet_h = sheet_h;
    g_state.x = x, g_state.y = y, g_state.w = w, g_state.h = h;
    g_state.hot_x = (int32_t)G32(mouse + WW_HOT_X);
    g_state.hot_y = (int32_t)G32(mouse + WW_HOT_Y);
    memcpy(g_publish, g_frame, (size_t)w * h);
    g_state.visible = 1;
    state_end();
    g_shape = shape, g_frame_index = frame;
    if (trace())
        fprintf(stderr, "[cursor] frame %u: %dx%d at %d,%d in %dx%d, hot %d,%d\n", frame, w, h, x, y, sheet_w,
                sheet_h, g_state.hot_x, g_state.hot_y);
}

void ra2_page_cursor_tick(void) {
    if (!g_on || !g_state.visible) return;
    if (now_ms() - load_word(&g_last_draw) > STALE_MS) {
        state_begin();
        g_state.visible = 0;
        state_end();
    }
}

const ra2_page_cursor_t *ra2_page_cursor_state(void) { return &g_state; }

void ra2_page_cursor_log(const char *why) {
    if (!g_on) return;
    fprintf(stderr, "[cursor] %s: %dx%d in %dx%d at %d,%d, hot %d,%d, visible %d, seq %u\n",
            why ? why : "page cursor", g_state.w, g_state.h, g_state.sheet_w, g_state.sheet_h, g_state.x,
            g_state.y, g_state.hot_x, g_state.hot_y, g_state.visible, g_state.seq);
}
