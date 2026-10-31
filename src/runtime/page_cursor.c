/* The game's in-match software cursor, captured for the page (docs/web/cursor-layer.md).
 *
 * Where it comes from (Yuri's Revenge gamemd.exe and Red Alert 2 game.exe, the
 * same classes from wwmous.cpp):
 *
 *   MouseClass::Set_Cursor(id, frame)      0x005BDC80 / 0x005B4600...
 *     picks a frame of MOUSE.SHA and calls
 *   WWMouseClass::Set_Cursor(hotspot, shape, frame)   0x007B8A00 / 0x00771B20...
 *     which saves the screen under the new cursor position, and calls
 *   WWMouseClass::Draw_Cursor(surface, x, y)          0x007B93F0 / 0x00772740
 *     which blits the shape frame, through the screen's palette converter.
 *
 * run_lift.py patches the blit call inside Draw_Cursor: ra2_page_cursor_suppress
 * can skip it, and ra2_page_cursor_drawn runs after it. The WWMouse object is
 * the function's `this`; its layout (both editions) is:
 *
 *   +0x04  ShapeClass*  the loaded MOUSE.SHA
 *   +0x08  frame index
 *   +0x14  cursor x, +0x18 y (screen)
 *   +0x24  DSurface*    the primary
 *   +0x3C  hot spot x, +0x40 y
 *   +0x44  the saved background: {vtable,w,h,pitch,bpp[+0x10],pixels[+0x14]}
 *   +0x48  drawn x, +0x4C y (client, the cursor's top-left)
 *   +0x50  frame width, +0x54 height
 *
 * The pixels are taken from the screen itself: right after the blit the
 * primary holds the cursor over the background the same routine saved in
 * +0x44, so every pixel that differs is a cursor pixel, in the screen's own
 * colour. That needs no SHP decoder and no palette: the page sees exactly what
 * the game drew. A pixel whose cursor colour happens to equal the background
 * is missed in that update and filled in the next one (the cursor moves over a
 * changing map), so the sprite is accumulated across draws.
 *
 * This file reads the game's memory directly, like src/runtime/hdvox.c; the
 * hosts never see the guest layout.
 */
#ifdef _WIN32
#include <windows.h>
#include <ddraw.h>
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

/* WWMouseClass, the fields above. */
#define WW_SHAPE   0x04u
#define WW_FRAME   0x08u
#define WW_SURFACE 0x24u
#define WW_HOT_X   0x3Cu
#define WW_HOT_Y   0x40u
#define WW_BACK    0x44u
#define WW_DRAW_X  0x48u
#define WW_DRAW_Y  0x4Cu
#define WW_W       0x50u
#define WW_H       0x54u
/* The saved-background buffer: a blit source/destination over plain memory. */
#define BUF_BPP    0x10u
#define BUF_PITCH  0x0Cu
#define BUF_PIXELS 0x14u
/* The game's DSurface wrapper. */
#define DS_DD      0x1Cu
#define DS_LOCKED  0x0Cu
#define DS_BPP     0x10u
#define DS_PIXELS  0x14u

/* How long after its last draw the cursor counts as gone: the mouse thread
 * redraws it many times a second while the game shows it, and stops entirely
 * in movies and after a match. */
#define STALE_MS 500u

#define PC_MAX RA2_PAGE_CURSOR_PX

static uint8_t g_sprite[PC_MAX * PC_MAX * 4];    /* what has been learnt */
static uint8_t g_publish[PC_MAX * PC_MAX * 4];   /* what the host may read */
static ra2_page_cursor_t g_state = { .rgba = g_publish };
static uint32_t g_shape, g_frame;                /* the sprite's shape and frame */
static volatile int g_on, g_request;
static volatile uint32_t g_last_draw;
static volatile int g_trace = -1;

static int trace(void) {
    if (g_trace < 0) g_trace = getenv("RA2_PAGE_CURSOR_DEBUG") != NULL;
    return g_trace;
}

/* 32-bit words shared with the host's presenter: plain x86 loads and stores are
 * atomic, and a compiler barrier keeps their order. MSVC has no __atomic
 * builtins; the increment only has to be one instruction there. */
#if defined(_MSC_VER)
#include <intrin.h>
static uint32_t atomic_add(uint32_t *p) { return (uint32_t)_InterlockedIncrement((volatile long *)p); }
#define atomic_load(p) (*(volatile uint32_t *)(p))
#define atomic_store(p, v) (*(volatile uint32_t *)(p) = (uint32_t)(v))
#else
static uint32_t atomic_add(uint32_t *p) { return __atomic_add_fetch(p, 1u, __ATOMIC_RELEASE); }
#define atomic_load(p) __atomic_load_n((p), __ATOMIC_ACQUIRE)
#define atomic_store(p, v) __atomic_store_n((p), (uint32_t)(v), __ATOMIC_RELEASE)
#endif

static uint32_t now_ms(void) {
#ifdef _WIN32
    return GetTickCount();
#else
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint32_t)((uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u);
#endif
}

static void state_begin(void) { atomic_add(&g_state.seq); }
static void state_end(void) { atomic_add(&g_state.seq); }

/* Show or hide the sprite; the sequence follows so the page repaints. */
static void set_visible(int visible) {
    if (g_state.visible == visible) return;
    state_begin();
    g_state.visible = visible != 0;
    state_end();
}

/* ---- reading the game's pixels ---------------------------------------------- */

/* Copy w x h pixels at (x, y) of the game's DSurface to RGBA. 0 if the surface
 * cannot be read (not a surface, out of bounds, an 8-bit mode). */
static int read_surface(uint32_t ds, int x, int y, int w, int h, uint32_t *out) {
    uint8_t *px = 0;
    int sw = 0, sh = 0, pitch = 0, bpp = 0;
    if (!ds || w <= 0 || h <= 0) return 0;
#if defined(_WIN32) && !defined(__EMSCRIPTEN__)
    {
        /* The native host's DirectDraw is real: lock the surface. The game
         * holds it locked only while it paints, and the cursor is drawn when
         * it does not, but a lock the game already has is read through its
         * own pointer (as hdvox.c does). */
        IDirectDrawSurface *dd = (IDirectDrawSurface *)(uintptr_t)G32(ds + DS_DD);
        uint32_t locked = G32(ds + DS_LOCKED), locked_px = G32(ds + DS_PIXELS);
        DDSURFACEDESC d;
        int unlocked = 0;
        memset(&d, 0, sizeof d);
        d.dwSize = sizeof d;
        if (locked && locked_px && G32(ds + DS_BPP) >= 2) {
            if (!dd || dd->lpVtbl->GetSurfaceDesc(dd, &d) != DD_OK) return 0;
            px = (uint8_t *)(uintptr_t)locked_px, pitch = (int)d.lPitch;
            bpp = (int)d.ddpfPixelFormat.dwRGBBitCount;
        } else {
            if (!dd || dd->lpVtbl->Lock(dd, NULL, &d, DDLOCK_WAIT | DDLOCK_READONLY, NULL) != DD_OK)
                return 0;
            unlocked = 1;
            px = (uint8_t *)d.lpSurface, pitch = (int)d.lPitch;
            bpp = (int)d.ddpfPixelFormat.dwRGBBitCount;
        }
        sw = (int)d.dwWidth, sh = (int)d.dwHeight;
        int ok = (bpp == 16 || bpp == 32) && x >= 0 && y >= 0 && x + w <= sw && y + h <= sh;
        if (ok) {
            for (int j = 0; j < h; j++) {
                const uint8_t *row = px + (size_t)(y + j) * pitch + (size_t)x * (bpp / 8);
                uint32_t *o = out + (size_t)j * w;
                if (bpp == 16)
                    for (int i = 0; i < w; i++) {
                        uint32_t p = ((const uint16_t *)row)[i];
                        uint32_t r = (p >> 11) & 31, g = (p >> 5) & 63, b = p & 31;
                        o[i] = 0xFF000000u | ((r << 3 | r >> 2) << 16) | ((g << 2 | g >> 4) << 8) | (b << 3 | b >> 2);
                    }
                else
                    for (int i = 0; i < w; i++) {
                        uint32_t v = ((const uint32_t *)row)[i];
                        o[i] = 0xFF000000u | (v & 0xFF) << 16 | (v & 0xFF00) | (v >> 16 & 0xFF);
                    }
            }
        }
        if (unlocked) dd->lpVtbl->Unlock(dd, NULL);
        return ok;
    }
#else
    if (!hle_dd_surface_pixels(G32(ds + DS_DD), &px, &sw, &sh, &pitch, &bpp)) return 0;
    if (bpp != 16 && bpp != 32) return 0;
    if (x < 0 || y < 0 || x + w > sw || y + h > sh) return 0;
    for (int j = 0; j < h; j++) {
        const uint8_t *row = px + (size_t)(y + j) * pitch + (size_t)x * (bpp / 8);
        uint32_t *o = out + (size_t)j * w;
        if (bpp == 16)
            for (int i = 0; i < w; i++) {
                uint32_t p = ((const uint16_t *)row)[i];
                uint32_t r = (p >> 11) & 31, g = (p >> 5) & 63, b = p & 31;
                o[i] = 0xFF000000u | ((r << 3 | r >> 2) << 16) | ((g << 2 | g >> 4) << 8) | (b << 3 | b >> 2);
            }
        else
            for (int i = 0; i < w; i++) {
                uint32_t v = ((const uint32_t *)row)[i];
                o[i] = 0xFF000000u | (v & 0xFF) << 16 | (v & 0xFF00) | (v >> 16 & 0xFF);
            }
    }
    return 1;
#endif
}

/* The saved background, straight out of the buffer the mouse class owns: it is
 * plain memory, w * h * bpp bytes (its pitch is 0: the pixels are tight). */
static int read_background(uint32_t buf, int w, int h, int bpp, uint32_t *out) {
    const uint8_t *px;
    int bw, bh, pitch;
    if (!buf || bpp < 2) return 0;
    bw = (int)G32(buf + 0x04), bh = (int)G32(buf + 0x08);
    pitch = (int)G32(buf + BUF_PITCH);
    px = (const uint8_t *)(uintptr_t)G32(buf + BUF_PIXELS);
    if (!px || bw < w || bh < h) return 0;
    if (pitch < w * bpp) pitch = w * bpp;         /* 0: the pixels are tight */
    for (int j = 0; j < h; j++) {
        const uint8_t *row = px + (size_t)j * (size_t)pitch;
        uint32_t *o = out + (size_t)j * w;
        if (bpp == 2)
            for (int i = 0; i < w; i++) {
                uint32_t p = ((const uint16_t *)row)[i];
                uint32_t r = (p >> 11) & 31, g = (p >> 5) & 63, b = p & 31;
                o[i] = 0xFF000000u | ((r << 3 | r >> 2) << 16) | ((g << 2 | g >> 4) << 8) | (b << 3 | b >> 2);
            }
        else
            for (int i = 0; i < w; i++) {
                uint32_t v = ((const uint32_t *)row)[i];
                o[i] = 0xFF000000u | (v & 0xFF) << 16 | (v & 0xFF00) | (v >> 16 & 0xFF);
            }
    }
    return 1;
}

/* The buffer's own bytes per pixel, from the primary's format. */
static int buffer_bpp(uint32_t buf) { return (int)G32(buf + BUF_BPP); }

/* ---- the hook --------------------------------------------------------------- */

void ra2_page_cursor_on(int on) {
    g_on = on != 0;
    if (!on) set_visible(0);
}

int ra2_page_cursor_enabled(void) { return g_on != 0; }

void ra2_page_cursor_request(int on) { g_request = on != 0; }

int ra2_page_cursor_requested(void) { return g_request != 0; }

int ra2_page_cursor_suppress(void) {
    /* Only once the sprite is known: before that the game draws it and this
     * module learns it, so there is never a frame with no cursor at all. */
    return g_on && g_request && g_state.visible;
}

void ra2_page_cursor_drawn(uint32_t mouse) {
    static uint32_t last_log;
    static int seen;
    int trace_here = trace() && seen < 8;
    if (!g_on || !mouse) return;
    uint32_t now = now_ms();
    atomic_store(&g_last_draw, now);

    uint32_t shape = G32(mouse + WW_SHAPE);
    uint32_t frame = G32(mouse + WW_FRAME);
    uint32_t back = G32(mouse + WW_BACK);
    uint32_t ds = G32(mouse + WW_SURFACE);
    int w = (int)G32(mouse + WW_W), h = (int)G32(mouse + WW_H);
    int x = (int32_t)G32(mouse + WW_DRAW_X), y = (int32_t)G32(mouse + WW_DRAW_Y);
    int bpp = buffer_bpp(back);
    if (trace_here)
        fprintf(stderr,
                "[cursor] draw #%d this=0x%08X shape=0x%08X frame=%u back=0x%08X ds=0x%08X w=%d h=%d bpp=%d at=%d,%d\n",
                seen++, mouse, shape, frame, back, ds, w, h, bpp, x, y);
    if (!shape || !back || !ds || w <= 0 || h <= 0 || w > PC_MAX || h > PC_MAX || bpp < 2 || bpp > 4) {
        if (trace_here) fprintf(stderr, "[cursor]   refused: shape/back/ds/size/bpp\n");
        set_visible(0);
        return;
    }

    if (shape != g_shape || frame != g_frame) {
        /* A new cursor (or its next frame): start the sprite again. The blit
         * run_lift.py may have skipped was this one, so draw the game's cursor
         * again until the new sprite has pixels. */
        state_begin();
        g_state.w = w, g_state.h = h;
        g_state.hot_x = (int32_t)G32(mouse + WW_HOT_X);
        g_state.hot_y = (int32_t)G32(mouse + WW_HOT_Y);
        g_state.visible = 0;
        memset(g_sprite, 0, sizeof g_sprite);
        memset(g_publish, 0, sizeof g_publish);
        g_shape = shape, g_frame = frame;
        state_end();
    }

    /* While the page draws the cursor, the primary has none: no diff to read. */
    if (g_request && g_state.visible) return;

    static uint32_t front[PC_MAX * PC_MAX], behind[PC_MAX * PC_MAX];
    if (!read_surface(ds, x, y, w, h, front)) {
        if (trace_here) fprintf(stderr, "[cursor]   read_surface(%u, %d, %d, %d, %d) failed\n", ds, x, y, w, h);
        return;
    }
    if (!read_background(back, w, h, bpp, behind)) {
        if (trace_here)
            fprintf(stderr, "[cursor]   read_background(%u, %d, %d, %d) failed: bw=%d bh=%d pitch=%d px=0x%08X\n", back,
                    w, h, bpp, (int)G32(back + 0x04), (int)G32(back + 0x08), (int)G32(back + BUF_PITCH),
                    (uint32_t)G32(back + BUF_PIXELS));
        return;
    }

    int changed = 0;
    for (int i = 0; i < w * h; i++) {
        if (front[i] == behind[i]) continue;      /* unchanged: not the cursor */
        if (g_sprite[i * 4 + 3] == 255 && g_sprite[i * 4] == (front[i] & 0xFF) &&
            g_sprite[i * 4 + 1] == (front[i] >> 8 & 0xFF) && g_sprite[i * 4 + 2] == (front[i] >> 16 & 0xFF))
            continue;                             /* already known */
        g_sprite[i * 4] = (uint8_t)(front[i] & 0xFF);
        g_sprite[i * 4 + 1] = (uint8_t)(front[i] >> 8 & 0xFF);
        g_sprite[i * 4 + 2] = (uint8_t)(front[i] >> 16 & 0xFF);
        g_sprite[i * 4 + 3] = 255;
        changed = 1;
    }
    if (changed) {
        state_begin();
        memcpy(g_publish, g_sprite, (size_t)w * h * 4);
        g_state.visible = 1;
        state_end();
        if (trace() && now - last_log > 2000) {
            last_log = now;
            fprintf(stderr, "[cursor] sprite %dx%d shape 0x%08X frame %u hot %d,%d\n", w, h, shape, frame,
                    g_state.hot_x, g_state.hot_y);
        }
    }
}

void ra2_page_cursor_tick(void) {
    if (!g_on) return;
    uint32_t last = atomic_load(&g_last_draw);
    if (g_state.visible && (last == 0 || now_ms() - last > STALE_MS)) set_visible(0);
}

const ra2_page_cursor_t *ra2_page_cursor_state(void) {
    g_state.rgba = g_publish;
    return &g_state;
}

void ra2_page_cursor_log(const char *why) {
    if (!g_on) return;
    fprintf(stderr, "[cursor] %s: %dx%d at %d,%d, visible %d, seq %u\n", why ? why : "page cursor", g_state.w,
            g_state.h, g_state.hot_x, g_state.hot_y, g_state.visible, g_state.seq);
}
