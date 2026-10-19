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

#define WM_CLOSE        0x0010u
#define WM_ACTIVATEAPP  0x001Cu
#define WM_MOUSEMOVE    0x0200u
#define WM_LBUTTONDOWN  0x0201u
#define WM_LBUTTONUP    0x0202u
#define WM_RBUTTONDOWN  0x0204u
#define WM_RBUTTONUP    0x0205u
#define WM_MBUTTONDOWN  0x0207u
#define WM_MBUTTONUP    0x0208u

/* ---- events ---------------------------------------------------------------- */

static void event_line(const char *json) {
    printf("@ra2 %s\n", json);
    fflush(stdout);
}

static void json_escape(char *out, size_t n, const char *s) {
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
    json_escape(t, sizeof t, title), json_escape(e, sizeof e, exe);
    snprintf(line, sizeof line, "{\"e\":\"boot\",\"protocol\":%d,\"title\":\"%s\",\"exe\":\"%s\",\"stamp\":%u}",
             RA2_WEB_PROTOCOL, t, e, stamp);
    event_line(line);
}
void web_event_menu(void) { event_line("{\"e\":\"menu\"}"); }
void web_event_error(const char *message) {
    char m[512], line[640];
    json_escape(m, sizeof m, message);
    snprintf(line, sizeof line, "{\"e\":\"error\",\"message\":\"%s\"}", m);
    event_line(line);
}
void web_event_exit(int code) {
    char line[64];
    snprintf(line, sizeof line, "{\"e\":\"exit\",\"code\":%d}", code);
    event_line(line);
}

/* ---- the picture ------------------------------------------------------------- */

static ra2_shared_t g_sh = { .protocol = RA2_WEB_PROTOCOL };
/* Pacing, for the overlay: how long each publish took, and how evenly the game's frames come. */
static double g_pub_ms, g_worst_gap, g_frame_at;
static unsigned g_pub_n, g_late, g_frame_seen;

static uint32_t *g_buf[2];
static size_t g_cap[2];
static int g_front;

EMSCRIPTEN_KEEPALIVE ra2_shared_t *ra2_shared(void) { return &g_sh; }

/* The primary surface as RGBA bytes (R lowest) in the buffer the page is not reading. */
static void publish(const uint8_t *px, int w, int h, int pitch, int bpp, const uint32_t *pal) {
    static uint32_t last_w, last_h;
    double began = emscripten_get_now();
    size_t n = (size_t)w * (size_t)h;
    int back = g_front ^ 1;
    if (g_cap[back] < n) {
        g_buf[back] = (uint32_t *)malloc(n * 4);          /* the old one is left: the page may be reading it */
        g_cap[back] = g_buf[back] ? n : 0;
        if (!g_buf[back]) return;
    }
    uint32_t *out = g_buf[back];
    if (bpp == 16) {                                     /* RGB565 */
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
    g_sh.frame_ptr = (uint32_t)(uintptr_t)out;
    g_front = back;
    __atomic_add_fetch(&g_sh.frame_seq, 1, __ATOMIC_RELEASE);
    g_pub_ms += emscripten_get_now() - began, g_pub_n++;
    if ((uint32_t)w != last_w || (uint32_t)h != last_h) {
        char line[64];
        last_w = (uint32_t)w, last_h = (uint32_t)h;
        snprintf(line, sizeof line, "{\"e\":\"mode\",\"w\":%d,\"h\":%d}", w, h);
        event_line(line);
    }
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
    int show = g_menus_cursor && g_menus_cursor();
    uint32_t handle = hle_current_cursor();
    if (!show) {
        if (was_kind == RA2_CURSOR_NONE) return;
        g_sh.cursor_kind = RA2_CURSOR_NONE, was_kind = RA2_CURSOR_NONE;
        __atomic_add_fetch(&g_sh.cursor_seq, 1, __ATOMIC_RELEASE);
        return;
    }
    if (was_kind != RA2_CURSOR_NONE && was_kind != -1 && handle == was_handle) return;
    const hle_cursor_image_t *img = hle_cursor_image(handle);
    was_handle = handle;
    if (!img) {
        g_sh.cursor_kind = RA2_CURSOR_ARROW, was_kind = RA2_CURSOR_ARROW;
    } else {
        for (int y = 0; y < RA2_CURSOR_PX; y++)
            for (int x = 0; x < RA2_CURSOR_PX; x++) {
                int bit = 7 - (x & 7), at = y * 4 + (x >> 3);
                int and_ = img->and_mask[at] >> bit & 1, xor_ = img->xor_mask[at] >> bit & 1;
                uint8_t *p = g_sh.cursor_rgba + (y * RA2_CURSOR_PX + x) * 4;
                uint8_t c = xor_ ? 255 : 0;
                p[0] = p[1] = p[2] = c, p[3] = and_ ? 0 : 255;
            }
        g_sh.cursor_hot_x = img->hot_x, g_sh.cursor_hot_y = img->hot_y;
        g_sh.cursor_kind = RA2_CURSOR_IMAGE, was_kind = RA2_CURSOR_IMAGE;
    }
    __atomic_add_fetch(&g_sh.cursor_seq, 1, __ATOMIC_RELEASE);
}

/* ---- input: the page's side, then the game's ------------------------------- */

enum { IN_MOVE, IN_DOWN, IN_UP, IN_KEYDOWN, IN_KEYUP, IN_QUIT, IN_FOCUS };
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
    if (kind == 0) push(IN_MOVE, (uint32_t)x, (uint32_t)y, 0);
    else push(kind == 1 ? IN_DOWN : IN_UP, (uint32_t)x, (uint32_t)y, (uint32_t)button);
}
/* vk is a Windows virtual key and scan the set-1 scan code, as the page's key table gives them */
EMSCRIPTEN_KEEPALIVE void ra2_input_key(int down, int vk, int scan) { push(down ? IN_KEYDOWN : IN_KEYUP, (uint32_t)vk, (uint32_t)scan, 0); }
EMSCRIPTEN_KEEPALIVE void ra2_quit(void) { push(IN_QUIT, 0, 0, 0); }
EMSCRIPTEN_KEEPALIVE void ra2_focus(int focused) { push(IN_FOCUS, (uint32_t)(focused != 0), 0, 0); }
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
        case IN_MOVE: hle_input_mouse(WM_MOUSEMOVE, (int)e.a, (int)e.b); break;
        case IN_DOWN: case IN_UP: {
            int down = e.kind == IN_DOWN;
            uint32_t m = e.c == 2 ? (down ? WM_RBUTTONDOWN : WM_RBUTTONUP)
                       : e.c == 1 ? (down ? WM_MBUTTONDOWN : WM_MBUTTONUP)
                       : (down ? WM_LBUTTONDOWN : WM_LBUTTONUP);
            hle_input_mouse(m, (int)e.a, (int)e.b);
            break;
        }
        case IN_KEYDOWN: case IN_KEYUP: hle_input_key(e.kind == IN_KEYDOWN, e.a, e.b); break;
        case IN_QUIT: {
            uint32_t h = hle_first_hwnd();
            if (h) hle_post_message(h, WM_CLOSE, 0, 0); else hle_exit(0);
            break;
        }
        case IN_FOCUS: {
            uint32_t h = hle_first_hwnd();
            if (h) hle_post_message(h, WM_ACTIVATEAPP, e.a, 0);
            break;
        }
        }
        __atomic_store_n(&g_tail, t, __ATOMIC_RELEASE);
    }
}

/* ---- the game's thread ------------------------------------------------------- */

void web_presenter_start(int (*menus_use_windows_cursor)(void)) {
    g_menus_cursor = menus_use_windows_cursor;
    hle_screen_frame_hook = on_frame;
    hle_dd_unlock_hook = present_now;
}

void web_presenter_pump(void) {
    static uint32_t next_fps, last_frames;
    drain_input();
    update_cursor();
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
            event_line(line);
            g_worst_gap = 0, g_late = 0, g_pub_ms = 0, g_pub_n = 0;
        }
        last_frames = frames;
        next_fps = now + 1000;
    }
}
