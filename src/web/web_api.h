/*
 * What the page and the game say to each other (docs/web/protocol.md). The
 * TypeScript side is web/src/game/protocol.ts; change the two together, and
 * RA2_WEB_PROTOCOL with them.
 */
#pragma once
#include <stdint.h>
#include <stddef.h>

#define RA2_WEB_PROTOCOL 8

#define RA2_CURSOR_PX 32

/* The picture and the cursor, published by the game thread and read by the
 * page in wasm's shared memory (ra2_shared() says where). Every field up to
 * cursor_rgba is one 32-bit word, so the page reads it as an Int32Array. A
 * frame is w*h*4 bytes of RGBA at frame_ptr. frame_seq is a seqlock: odd while a
 * picture is being published, even when it is whole; the page takes a picture
 * only at an even value that did not change while it read (protocol.md). With
 * presentMode 0 (the default) that is RGBA; with 1 the words from format on are
 * the picture. */
typedef struct ra2_shared {
    uint32_t protocol;               /* RA2_WEB_PROTOCOL */
    volatile uint32_t frame_seq;     /* seqlock: odd while a picture is published (see above) */
    volatile uint32_t frame_ptr;
    volatile uint32_t frame_w, frame_h;
    volatile uint32_t cursor_seq;    /* up whenever the cursor below changes */
    volatile uint32_t cursor_kind;   /* RA2_CURSOR_* */
    volatile int32_t  cursor_hot_x, cursor_hot_y;
    uint32_t view_w, view_h;         /* ra2_resize: the canvas's CSS size */
    float    view_dpr;
    uint32_t reserved;
    uint8_t  cursor_rgba[RA2_CURSOR_PX * RA2_CURSOR_PX * 4];
    uint32_t game_w, game_h;         /* input coordinates; frame may be 2x for HD vehicles */
    uint32_t warp_seq;
    int32_t warp_x, warp_y;          /* SetCursorPos: relative Pointer Lock must follow warps */
    int32_t pointer_x, pointer_y;    /* game-pixel position for the pause cursor overlay */
    /* protocol 8: the raw picture (presentMode 1). In raw mode frame_ptr holds frame_h rows of frame_pitch
     * bytes in `format`, in the buffer frame_index names; the page says which buffer it reads in read_index. */
    volatile uint32_t format;        /* RA2_FMT_* */
    volatile uint32_t frame_pitch;   /* bytes per row of the raw frame */
    volatile uint32_t palette_ptr;   /* PAL8: 256 words, r | g << 8 | b << 16 */
    volatile int32_t read_index;     /* written by the page with Atomics.store: the buffer it is reading, -1 for none (protocol.md) */
    volatile int32_t frame_index;    /* the buffer frame_ptr is in, 0..2; -1 before the first */
    volatile uint32_t hd_layer_1x, hd_layer_2x;  /* the HD vehicle layers (filled by the GPU path; 0 until then) */
    volatile uint32_t hd_rects, hd_rect_count, hd_seq;
    volatile uint32_t republish;     /* the page sets 1 to ask for a full picture; the game clears it */
    volatile uint32_t present_mode;  /* written by the page: RA2_PRESENT_*, read at each publish */
} ra2_shared_t;

enum { RA2_CURSOR_NONE = 0,          /* the game draws its own: hide the system one */
       RA2_CURSOR_IMAGE = 1,         /* cursor_rgba, with its hot spot */
       RA2_CURSOR_ARROW = 2,         /* the system arrow */
       RA2_CURSOR_OVERLAY = 3 };     /* cursor_rgba above the whole game/sidebar */

enum { RA2_FMT_RGBA = 0,             /* 4 bytes, R lowest: what presentMode 0 always publishes */
       RA2_FMT_RGB565 = 1,           /* 2 bytes, the game's own 16-bit screen */
       RA2_FMT_PAL8 = 2,             /* 1 byte, indexes into palette_ptr */
       RA2_FMT_BGRX = 3 };           /* 4 bytes, B, G, R, X in memory: the game's 32-bit screen */

enum { RA2_PRESENT_RGBA = 0,         /* the default: RGBA in frame_ptr, as protocol 7 */
       RA2_PRESENT_RAW = 1 };        /* the game's own format, unconverted */

_Static_assert(__builtin_offsetof(ra2_shared_t, cursor_rgba) == 52, "web/src/game/protocol.ts reads cursor_rgba at byte 52");
_Static_assert(__builtin_offsetof(ra2_shared_t, pointer_x) == 4168, "web/src/game/protocol.ts reads pointer_x at word 1042");
_Static_assert(__builtin_offsetof(ra2_shared_t, pointer_y) == 4172, "web/src/game/protocol.ts reads pointer_y at word 1043");
_Static_assert(__builtin_offsetof(ra2_shared_t, format) == 1044 * 4, "web/src/game/protocol.ts reads format at word 1044");
_Static_assert(__builtin_offsetof(ra2_shared_t, frame_pitch) == 1045 * 4, "web/src/game/protocol.ts reads framePitch at word 1045");
_Static_assert(__builtin_offsetof(ra2_shared_t, palette_ptr) == 1046 * 4, "web/src/game/protocol.ts reads palettePtr at word 1046");
_Static_assert(__builtin_offsetof(ra2_shared_t, read_index) == 1047 * 4, "web/src/game/protocol.ts reads readIndex at word 1047");
_Static_assert(__builtin_offsetof(ra2_shared_t, frame_index) == 1048 * 4, "web/src/game/protocol.ts reads frameIndex at word 1048");
_Static_assert(__builtin_offsetof(ra2_shared_t, hd_layer_1x) == 1049 * 4, "web/src/game/protocol.ts reads hdLayer1x at word 1049");
_Static_assert(__builtin_offsetof(ra2_shared_t, hd_layer_2x) == 1050 * 4, "web/src/game/protocol.ts reads hdLayer2x at word 1050");
_Static_assert(__builtin_offsetof(ra2_shared_t, hd_rects) == 1051 * 4, "web/src/game/protocol.ts reads hdRects at word 1051");
_Static_assert(__builtin_offsetof(ra2_shared_t, hd_rect_count) == 1052 * 4, "web/src/game/protocol.ts reads hdRectCount at word 1052");
_Static_assert(__builtin_offsetof(ra2_shared_t, hd_seq) == 1053 * 4, "web/src/game/protocol.ts reads hdSeq at word 1053");
_Static_assert(__builtin_offsetof(ra2_shared_t, republish) == 1054 * 4, "web/src/game/protocol.ts reads republish at word 1054");
_Static_assert(__builtin_offsetof(ra2_shared_t, present_mode) == 1055 * 4, "web/src/game/protocol.ts reads presentMode at word 1055");

/* events: one line on stdout, "@ra2 " and JSON (presenter.c) */
void web_event_boot(const char *title, const char *exe, uint32_t stamp);
void web_event_menu(void);
extern volatile int web_menu_seen;   /* set when it was sent: movies before it are the start-up ones */
void web_event_error(const char *message);
void web_event_exit(int code);
void web_event_json(const char *json);
void web_json_escape(char *out, size_t n, const char *text);
int ra2_exit_confirmation_reply(uint32_t request, int exit_game);

enum { RA2_SETTING_SCALE, RA2_SETTING_BARS, RA2_SETTING_HD, RA2_SETTING_MODERN,
       RA2_SETTING_RESOLUTION, RA2_SETTING_MENU };
void web_settings_start(const char *override_scale);
void web_settings_command(int key, int value, int extra);
void web_settings_event(void);
int web_settings_open(void);
void web_presenter_pause(void);
void ra2_set_menu_music(int allowed);   /* the page's setting; the --no-menu-music option of a headless run */
const char *web_settings_mod(void);
void web_settings_save_mod(void);
void web_modern_key(int down, uint32_t vk);
void web_modern_pointer(uint32_t message, int x, int y);

/* the game thread's side (presenter.c) */
void web_presenter_start(int (*menus_use_windows_cursor)(void));
void web_presenter_pump(void);       /* from the pump hook: input in, the cursor out, fps */

/* main.c: --clockstats (presenter.c prints the counts once a second) */
int  ra2_clockstats_on(void);
void ra2_clockstats_take(uint32_t out[5]);   /* qpc, timeGetTime, GetTickCount, Sleep(n), Sleep(0) since the last take */
