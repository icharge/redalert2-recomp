/*
 * The browser's screen, mouse, keyboard and event channel (docs/web).
 *
 * There is no SDL window here. win32hle's screen.c runs headless (it builds
 * the frame from the primary surface and calls hle_screen_frame_hook); this
 * file turns that frame into RGBA in shared memory, which the page draws on a
 * canvas, and takes the page's mouse and keys back through a ring. The game's
 * thread never waits for the page and the page never waits for the game.
 *
 * Threads: the page calls the ra2_* exports on the main thread; everything
 * else here runs on the game's thread: input and the cursor from its pump, the
 * picture from the pump and from the primary's Unlock (a loading screen draws
 * for many seconds without pumping messages). The only data that crosses is
 * the ring (one producer, one consumer) and ra2_shared_t, which the page reads.
 */
#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

#include "win32hle.h"
#include "host.h"
#include "recomp_target.h"
#include "web_api.h"
#include "hdvox.h"
#include "mods.h"

#define WM_CLOSE        0x0010u
#define WM_CHAR         0x0102u
#define WM_ACTIVATEAPP  0x001Cu
#define WM_MOUSEMOVE    0x0200u
#define WM_LBUTTONDOWN  0x0201u
#define WM_LBUTTONUP    0x0202u
#define WM_RBUTTONDOWN  0x0204u
#define WM_RBUTTONUP    0x0205u
#define WM_MBUTTONDOWN  0x0207u
#define WM_MBUTTONUP    0x0208u

/* ---- events ---------------------------------------------------------------- */

void web_event_json(const char *json) {
    printf("@ra2 %s\n", json);
    fflush(stdout);
}

void web_json_escape(char *out, size_t n, const char *s) {
    size_t k = 0;
    for (; *s && k + 7 < n; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') out[k++] = '\\', out[k++] = (char)c;
        else if (c < 0x20) k += (size_t)snprintf(out + k, n - k, "\\u%04x", c);
        else out[k++] = (char)c;
    }
    out[k] = 0;
}

void web_event_boot(const char *title, const char *exe, uint32_t stamp) {
    char t[160], e[160], line[512];
    web_json_escape(t, sizeof t, title), web_json_escape(e, sizeof e, exe);
    snprintf(line, sizeof line, "{\"e\":\"boot\",\"protocol\":%d,\"title\":\"%s\",\"exe\":\"%s\",\"stamp\":%u}",
             RA2_WEB_PROTOCOL, t, e, stamp);
    web_event_json(line);
}
volatile int web_menu_seen;      /* the main menu has opened once (web_api.h) */
void web_event_menu(void) { web_menu_seen = 1; web_event_json("{\"e\":\"menu\"}"); }
void web_event_error(const char *message) {
    char m[512], line[640];
    web_json_escape(m, sizeof m, message);
    snprintf(line, sizeof line, "{\"e\":\"error\",\"message\":\"%s\"}", m);
    web_event_json(line);
}
void web_event_exit(int code) {
    char line[64];
    snprintf(line, sizeof line, "{\"e\":\"exit\",\"code\":%d}", code);
    web_event_json(line);
}

/* ---- the picture ------------------------------------------------------------- */

static ra2_shared_t g_sh = { .protocol = RA2_WEB_PROTOCOL };
/* Pacing, for the overlay: how long each publish took, and how evenly the game's frames come. */
static double g_pub_ms, g_worst_gap, g_frame_at;
static unsigned g_pub_n, g_late, g_frame_seen;

static uint32_t *g_buf[2];
static size_t g_cap[2];
static int g_front;
static uint32_t g_pause_dialog;
static int g_republish;                                  /* set by the game's thread when the page returns */
static void present_now(void);

EMSCRIPTEN_KEEPALIVE ra2_shared_t *ra2_shared(void) { return &g_sh; }

/* The primary surface as RGBA bytes (R lowest) in the buffer the page is not reading. */
static void publish(const uint8_t *px, int w, int h, int pitch, int bpp, const uint32_t *pal) {
    static uint32_t last_w, last_h;
    double began = emscripten_get_now();
    int game_w = w, game_h = h;
    int hd = bpp == 16 && ra2_vox_hd_on;
    if (hd) { w *= 2; h *= 2; }
    size_t n = (size_t)w * (size_t)h;
    int back = g_front ^ 1;
    if (g_cap[back] < n) {
        g_buf[back] = (uint32_t *)malloc(n * 4);          /* the old one is left: the page may be reading it */
        g_cap[back] = g_buf[back] ? n : 0;
        if (!g_buf[back]) return;
    }
    uint32_t *out = g_buf[back];
    if (hd) {
        hdvox_compose(px, pitch, game_w, game_h, out);    /* compositor returns XRGB */
        for (size_t i = 0; i < n; i++) {
            uint32_t v = out[i];
            out[i] = 0xFF000000u | (v & 0xFF) << 16 | (v & 0xFF00) | (v >> 16 & 0xFF);
        }
    } else if (bpp == 16) {                              /* RGB565 */
        for (int y = 0; y < h; y++) {
            const uint16_t *s = (const uint16_t *)(px + (size_t)y * (size_t)pitch);
            uint32_t *d = out + (size_t)y * (size_t)w;
            for (int x = 0; x < w; x++) {
                uint32_t p = s[x], r = p >> 11, g = (p >> 5) & 63, b = p & 31;
                d[x] = 0xFF000000u | (b << 3 | b >> 2) << 16 | (g << 2 | g >> 4) << 8 | (r << 3 | r >> 2);
            }
        }
    } else if (bpp == 8) {                               /* palette entries are r | g << 8 | b << 16 */
        if (!pal) return;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++) out[(size_t)y * (size_t)w + x] = 0xFF000000u | pal[px[(size_t)y * (size_t)pitch + x]];
    } else {                                             /* 32-bit: B, G, R, X in memory */
        for (int y = 0; y < h; y++) {
            const uint32_t *s = (const uint32_t *)(px + (size_t)y * (size_t)pitch);
            uint32_t *d = out + (size_t)y * (size_t)w;
            for (int x = 0; x < w; x++) {
                uint32_t v = s[x];
                d[x] = 0xFF000000u | (v & 0xFF) << 16 | (v & 0xFF00) | (v >> 16 & 0xFF);
            }
        }
    }
    g_sh.frame_w = (uint32_t)w, g_sh.frame_h = (uint32_t)h;
    g_sh.game_w = (uint32_t)game_w, g_sh.game_h = (uint32_t)game_h;
    g_sh.frame_ptr = (uint32_t)(uintptr_t)out;
    g_front = back;
    __atomic_add_fetch(&g_sh.frame_seq, 1, __ATOMIC_RELEASE);
    g_pub_ms += emscripten_get_now() - began, g_pub_n++;
    if ((uint32_t)game_w != last_w || (uint32_t)game_h != last_h) {
        char line[64];
        last_w = (uint32_t)game_w, last_h = (uint32_t)game_h;
        snprintf(line, sizeof line, "{\"e\":\"mode\",\"w\":%d,\"h\":%d}", game_w, game_h);
        web_event_json(line);
    }
}

/* Resource 0xB5 is the in-game pause menu. */
void web_presenter_dialog_created(uint32_t hwnd, uint32_t resource_id) {
    if (resource_id == 0xB5u) g_pause_dialog = hwnd;
}

static int pause_dialog_visible(void) {
    return g_pause_dialog && hle_is_window(g_pause_dialog) &&
           (hle_window_style(g_pause_dialog) & 0x10000000u);
}

/* A match is being played: the game's frame count moved in the last second (it stands still in menus,
 * lobbies and movies), the game draws its own cursor and its pause menu is not already up. */
static int match_running(void) {
    return g_frame_at && emscripten_get_now() - g_frame_at < 1000.0 &&
           g_sh.cursor_kind == RA2_CURSOR_NONE && !pause_dialog_visible();
}

/* Open the game's menu, as Escape does, if a match is running: the page lost the player's attention
 * (focus left the window or the game area, Settings opened). Asked again within a moment (the
 * menu takes a frame to show) it does nothing, or the second Escape would close it. */
void web_presenter_pause(void) {
    static double asked;
    double now = emscripten_get_now();
    if (now - asked < 1500.0 || !match_running()) return;
    asked = now;
    hle_input_key(1, 0x1b, 1);
    hle_input_key(0, 0x1b, 1);
}

/* What the game's own Focus_Restore ends with: GScreenClass::Flag_To_Redraw(2), a complete redraw
 * of the screen (the game's screen object, its redraw state, the counter its draw loop watches).
 * Done here by hand, as the lifted function is thiscall; the addresses are of each binary. */
#if defined(RA2_TARGET_GAME)
#define SCREEN_OBJECT_PTR 0x0083996Cu                    /* a pointer to the object with the dirty byte at +0xD7D */
#define SCREEN_CLASS      0x008324E0u
#define SCREEN_COUNTER    0x1154u
#else
#define SCREEN_OBJECT_PTR 0x00887324u
#define SCREEN_CLASS      0x0087F7E8u
#define SCREEN_COUNTER    0x1158u
#endif
static void redraw_whole_screen(void) {
    uint32_t object = MEM32(SCREEN_OBJECT_PTR);
    if (object) MEM8(object + 0xD7Du) = 1;
    MEM32(SCREEN_CLASS + 0xCu) = 2;                      /* redraw everything */
    MEM8(SCREEN_CLASS + SCREEN_COUNTER) = (uint8_t)(MEM8(SCREEN_CLASS + SCREEN_COUNTER) + 1);
}

/* The primary as it is now, if it changed (or a quarter second has gone) and the last frame is not
 * newer than 15 ms: from the pump, and from the primary's Unlock. On the game's thread. */
static void present_now(void) {
    static unsigned shown_seq = ~0u;
    static uint32_t last;
    const uint8_t *px;
    const uint32_t *pal;
    int w, h, pitch, bpp;
    unsigned seq;
    if (!hle_dd_frame(&px, &w, &h, &pitch, &bpp, &pal, &seq)) return;
    uint32_t now = hle_ticks_ms();
    if (g_republish) g_republish = 0, shown_seq = ~0u, last = now - 15;   /* the page came back: a new picture now */
    if (now - last < 15 || (seq == shown_seq && now - last < 250)) return;
    shown_seq = seq, last = now;
    publish(px, w, h, pitch, bpp, pal);
}
static void on_frame(const uint8_t *px, int w, int h, int pitch, int bpp) {
    (void)px, (void)w, (void)h, (void)pitch, (void)bpp;
    present_now();
}

/* ---- the cursor ------------------------------------------------------------ */

static int (*g_menus_cursor)(void);

/* The game's Windows cursor, from its resources: 32x32, AND and XOR masks,
 * rows top-down, the leftmost pixel the top bit. AND 0 is opaque (XOR picks
 * black or white); AND 1 is transparent (and XOR 1 would invert, which a
 * page cannot do: transparent too). */
static void update_cursor(void) {
    static int was_kind = -1;
    static uint32_t was_handle;
    int pause = pause_dialog_visible();
    int show = pause || (g_menus_cursor && g_menus_cursor());
    uint32_t handle = hle_current_cursor();
    if (!show) {
        if (was_kind == RA2_CURSOR_NONE) return;
        g_sh.cursor_kind = RA2_CURSOR_NONE, was_kind = RA2_CURSOR_NONE;
        __atomic_add_fetch(&g_sh.cursor_seq, 1, __ATOMIC_RELEASE);
        return;
    }
    const hle_cursor_image_t *img = hle_cursor_image(handle);
    if (!img) {
        int kind = pause ? RA2_CURSOR_OVERLAY : RA2_CURSOR_ARROW;
        if (was_kind == kind && handle == was_handle) return;
        if (pause) {
            /* Pause dialogs can clear the game's cursor handle. Keep drawing
             * a visible pointer in the page overlay so it remains above the
             * sidebar as well as the map. */
            memset(g_sh.cursor_rgba, 0, sizeof g_sh.cursor_rgba);
            for (int y = 0; y < 20; y++) {
                int edge = y < 14 ? (y + 1) / 2 : 7 + (y - 14) / 2;
                for (int x = 0; x <= edge && x < 12; x++) {
                    int border = x == 0 || x == edge || (y >= 14 && x == edge);
                    uint8_t *p = &g_sh.cursor_rgba[(y * RA2_CURSOR_PX + x) * 4];
                    p[0] = p[1] = p[2] = border ? 0 : 255;
                    p[3] = 255;
                }
            }
            g_sh.cursor_hot_x = 0, g_sh.cursor_hot_y = 0;
        }
        g_sh.cursor_kind = (uint32_t)kind, was_kind = kind;
    } else {
        int kind = pause ? RA2_CURSOR_OVERLAY : RA2_CURSOR_IMAGE;
        if (was_kind == kind && handle == was_handle) return;
        for (int y = 0; y < RA2_CURSOR_PX; y++)
            for (int x = 0; x < RA2_CURSOR_PX; x++) {
                int bit = 7 - (x & 7), at = y * 4 + (x >> 3);
                int and_ = img->and_mask[at] >> bit & 1, xor_ = img->xor_mask[at] >> bit & 1;
                uint8_t *p = g_sh.cursor_rgba + (y * RA2_CURSOR_PX + x) * 4;
                uint8_t c = xor_ ? 255 : 0;
                p[0] = p[1] = p[2] = c, p[3] = and_ ? 0 : 255;
            }
        g_sh.cursor_hot_x = img->hot_x, g_sh.cursor_hot_y = img->hot_y;
        g_sh.cursor_kind = (uint32_t)kind, was_kind = kind;
    }
    was_handle = handle;
    __atomic_add_fetch(&g_sh.cursor_seq, 1, __ATOMIC_RELEASE);
}

/* ---- input: the page's side, then the game's ------------------------------- */

enum { IN_MOVE, IN_DOWN, IN_UP, IN_KEYDOWN, IN_KEYUP, IN_CHAR, IN_QUIT, IN_FOCUS, IN_SETTING };
typedef struct { uint32_t kind, a, b, c; } input_t;
#define RING 512
static input_t g_ring[RING];
static uint32_t g_head, g_tail;                          /* the page writes head, the game tail */

static void push(uint32_t kind, uint32_t a, uint32_t b, uint32_t c) {
    uint32_t h = __atomic_load_n(&g_head, __ATOMIC_RELAXED), t = __atomic_load_n(&g_tail, __ATOMIC_ACQUIRE);
    if (h - t >= RING) return;                           /* the game is not listening: drop it */
    input_t e = { kind, a, b, c };
    g_ring[h % RING] = e;
    __atomic_store_n(&g_head, h + 1, __ATOMIC_RELEASE);
}

/* kind: 0 move, 1 down, 2 up; x and y in game pixels; button as the DOM
 * numbers it (0 left, 1 middle, 2 right) */
EMSCRIPTEN_KEEPALIVE void ra2_input_pointer(int kind, int x, int y, int button) {
    __atomic_store_n(&g_sh.pointer_x, x, __ATOMIC_RELAXED);
    __atomic_store_n(&g_sh.pointer_y, y, __ATOMIC_RELAXED);
    if (kind == 0) push(IN_MOVE, (uint32_t)x, (uint32_t)y, 0);
    else push(kind == 1 ? IN_DOWN : IN_UP, (uint32_t)x, (uint32_t)y, (uint32_t)button);
}
/* vk is a Windows virtual key and scan the set-1 scan code, as the page's key table gives them */
EMSCRIPTEN_KEEPALIVE void ra2_input_key(int down, int vk, int scan) { push(down ? IN_KEYDOWN : IN_KEYUP, (uint32_t)vk, (uint32_t)scan, 0); }
/* Browser text input arrives as UTF-8; the game's ANSI edit controls and Thai
 * FNT use Windows-874 bytes. Unsupported characters become '?' rather than
 * being misdecoded as UTF-8 bytes. */
static uint8_t cp874_character(uint32_t codepoint) {
    if (codepoint == '\b') return 8;
    if (codepoint == '\r' || codepoint == '\n') return 13;
    if (codepoint >= 0x20 && codepoint <= 0x7e) return (uint8_t)codepoint;
    if (codepoint == 0x00a0) return 0xa0;
    if (codepoint == 0x20ac) return 0x80;
    if (codepoint >= 0x0e01 && codepoint <= 0x0e3a) return (uint8_t)(codepoint - 0x0d60);
    if (codepoint == 0x0e3f) return 0xdf;
    if (codepoint >= 0x0e40 && codepoint <= 0x0e5b) return (uint8_t)(codepoint - 0x0d60);
    return '?';
}

EMSCRIPTEN_KEEPALIVE void ra2_input_text(const char *text) {
    const uint8_t *p = (const uint8_t *)text;
    if (!p) return;
    while (*p) {
        uint32_t codepoint;
        size_t length;
        if (*p < 0x80) codepoint = *p, length = 1;
        else if (*p >= 0xc2 && *p <= 0xdf && p[1])
            codepoint = ((uint32_t)(p[0] & 0x1f) << 6) | (p[1] & 0x3f), length = 2;
        else if (*p >= 0xe0 && *p <= 0xef && p[1] && p[2])
            codepoint = ((uint32_t)(p[0] & 0x0f) << 12) | ((uint32_t)(p[1] & 0x3f) << 6) | (p[2] & 0x3f), length = 3;
        else if (*p >= 0xf0 && *p <= 0xf4 && p[1] && p[2] && p[3])
            codepoint = ((uint32_t)(p[0] & 0x07) << 18) | ((uint32_t)(p[1] & 0x3f) << 12) |
                        ((uint32_t)(p[2] & 0x3f) << 6) | (p[3] & 0x3f), length = 4;
        else codepoint = '?', length = 1;
        p += length;
        push(IN_CHAR, cp874_character(codepoint), 0, 0);
    }
}
EMSCRIPTEN_KEEPALIVE void ra2_quit(void) { push(IN_QUIT, 0, 0, 0); }
EMSCRIPTEN_KEEPALIVE void ra2_focus(int focused) { push(IN_FOCUS, (uint32_t)(focused != 0), 0, 0); }
EMSCRIPTEN_KEEPALIVE void ra2_setting(int key, int value, int extra) { push(IN_SETTING, (uint32_t)key, (uint32_t)value, (uint32_t)extra); }
EMSCRIPTEN_KEEPALIVE void ra2_set_volume(float v) { hle_dsound_set_master(v < 0 ? 0 : v > 1 ? 1 : v); }
/* The sound ring (win32hle.h, hle_audio_ring_t): the page's audio worklet reads it while ra2_audio_live(1) holds. */
EMSCRIPTEN_KEEPALIVE void *ra2_audio(void) { return hle_audio_ring(); }
EMSCRIPTEN_KEEPALIVE void ra2_audio_live(int live) { hle_audio_live(live); }
EMSCRIPTEN_KEEPALIVE void ra2_resize(int w, int h, float dpr) {
    g_sh.view_w = (uint32_t)(w > 0 ? w : 0), g_sh.view_h = (uint32_t)(h > 0 ? h : 0), g_sh.view_dpr = dpr;
}

static void drain_input(void) {
    uint32_t t = __atomic_load_n(&g_tail, __ATOMIC_RELAXED);
    while (t != __atomic_load_n(&g_head, __ATOMIC_ACQUIRE)) {
        input_t e = g_ring[t % RING];
        t++;
        switch (e.kind) {
        case IN_MOVE:
            web_modern_pointer(WM_MOUSEMOVE, (int)e.a, (int)e.b);
            hle_input_mouse(WM_MOUSEMOVE, (int)e.a, (int)e.b); break;
        case IN_DOWN: case IN_UP: {
            int down = e.kind == IN_DOWN;
            uint32_t m = e.c == 2 ? (down ? WM_RBUTTONDOWN : WM_RBUTTONUP)
                       : e.c == 1 ? (down ? WM_MBUTTONDOWN : WM_MBUTTONUP)
                       : (down ? WM_LBUTTONDOWN : WM_LBUTTONUP);
            web_modern_pointer(m, (int)e.a, (int)e.b);
            hle_input_mouse(m, (int)e.a, (int)e.b);
            break;
        }
        case IN_KEYDOWN: case IN_KEYUP:
            if (e.a == 0x79) { if (e.kind == IN_KEYDOWN) web_settings_command(RA2_SETTING_MENU, -1, 0); break; }
            if (mods_handle_key((int)e.a, e.kind == IN_KEYDOWN)) break;
            web_modern_key(e.kind == IN_KEYDOWN, e.a);
            hle_input_key(e.kind == IN_KEYDOWN, e.a, e.b); break;
        case IN_CHAR: {
            uint32_t target = hle_focus_window();
            if (target) hle_post_message(target, WM_CHAR, e.a, 0);
            break;
        }
        case IN_SETTING: web_settings_command((int)e.a, (int)e.b, (int)e.c); break;
        case IN_QUIT: {
            uint32_t h = hle_first_hwnd();
            if (h) hle_post_message(h, WM_CLOSE, 0, 0); else hle_exit(0);
            break;
        }
        case IN_FOCUS: {
            uint32_t h = hle_first_hwnd();
            /* The game is always the active application, as in the native build (host.c, bringup.md 7).
             * Told it lost the focus it idles its main loop and pauses its movie, and its Focus_Restore
             * repaints only part of a screen: no surface here is ever lost, so there is nothing to
             * restore, and the page keeps showing a frozen or half-drawn picture. The page's own
             * blur still lets go of keys, buttons and the pointer (input.ts). Coming back, every
             * showing window paints in full and a new picture goes out at once. */
            if (h) hle_post_message(h, WM_ACTIVATEAPP, 1, 0);
            if (e.a) redraw_whole_screen(), hle_invalidate_all(), g_republish = 1;
            else web_presenter_pause();                      /* leaving a match: it is paused when they come back */
            break;
        }
        }
        __atomic_store_n(&g_tail, t, __ATOMIC_RELEASE);
    }
}

/* ---- the game's thread ------------------------------------------------------- */

static void warp_cursor(int x, int y) {
    g_sh.warp_x = x; g_sh.warp_y = y;
    __atomic_store_n(&g_sh.pointer_x, x, __ATOMIC_RELAXED);
    __atomic_store_n(&g_sh.pointer_y, y, __ATOMIC_RELAXED);
    __atomic_add_fetch(&g_sh.warp_seq, 1, __ATOMIC_RELEASE);
}

void web_presenter_start(int (*menus_use_windows_cursor)(void)) {
    g_menus_cursor = menus_use_windows_cursor;
    hle_screen_frame_hook = on_frame;
    hle_dd_unlock_hook = present_now;
    hle_cursor_hook = warp_cursor;
}

void web_presenter_pump(void) {
    static uint32_t next_fps, last_frames;
    drain_input();
    update_cursor();
    /* Dialog paints can finish without a primary Unlock. Sample the game's
     * presented surface at its regular pump boundary as well. */
    present_now();
    uint32_t now = hle_ticks_ms();
    uint32_t seen = MEM32(RA2_GAME_FRAME_VA);
    if (seen != g_frame_seen) {                          /* a game frame came: how long since the last */
        double at = emscripten_get_now();
        if (g_frame_seen && g_frame_at) {
            double gap = at - g_frame_at;
            if (gap > g_worst_gap) g_worst_gap = gap;
            if (gap > 25.0) g_late++;
        }
        g_frame_at = at, g_frame_seen = seen;
    }
    if ((int32_t)(now - next_fps) >= 0) {
        uint32_t frames = MEM32(RA2_GAME_FRAME_VA);
        if (next_fps) {
            uint32_t dt = now - (next_fps - 1000), fps = dt ? (frames - last_frames) * 1000u / dt : 0;
            char line[96];
            snprintf(line, sizeof line,
                     "{\"e\":\"fps\",\"fps\":%u,\"ms\":%u,\"worst\":%u,\"late\":%u,\"pub\":%u,\"pubms\":%.2f}", fps,
                     fps ? 1000u / fps : 0, (unsigned)(g_worst_gap + 0.5), g_late, g_pub_n, g_pub_n ? g_pub_ms / g_pub_n : 0.0);
            web_event_json(line);
            g_worst_gap = 0, g_late = 0, g_pub_ms = 0, g_pub_n = 0;
        }
        last_frames = frames;
        next_fps = now + 1000;
    }
}
