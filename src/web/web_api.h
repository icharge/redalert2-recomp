/*
 * What the page and the game say to each other (docs/web/protocol.md). The
 * TypeScript side is web/src/game/protocol.ts; change the two together, and
 * RA2_WEB_PROTOCOL with them.
 */
#pragma once
#include <stdint.h>
#include <stddef.h>

#define RA2_WEB_PROTOCOL 6

#define RA2_CURSOR_PX 32

/* The picture and the cursor, published by the game thread and read by the
 * page in wasm's shared memory (ra2_shared() says where). Every field up to
 * cursor_rgba is one 32-bit word, so the page reads it as an Int32Array. A
 * frame is w*h*4 bytes of RGBA at frame_ptr; frame_seq goes up after each
 * one is written, and the page redraws when it changes. */
typedef struct ra2_shared {
    uint32_t protocol;               /* RA2_WEB_PROTOCOL */
    volatile uint32_t frame_seq;
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
} ra2_shared_t;

enum { RA2_CURSOR_NONE = 0,          /* the game draws its own: hide the system one */
       RA2_CURSOR_IMAGE = 1,         /* cursor_rgba, with its hot spot */
       RA2_CURSOR_ARROW = 2,         /* the system arrow */
       RA2_CURSOR_OVERLAY = 3 };     /* cursor_rgba above the whole game/sidebar */

_Static_assert(__builtin_offsetof(ra2_shared_t, cursor_rgba) == 52, "web/src/game/protocol.ts reads cursor_rgba at byte 52");
_Static_assert(__builtin_offsetof(ra2_shared_t, pointer_x) == 4168, "web/src/game/protocol.ts reads pointer_x at word 1042");

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
const char *web_settings_mod(void);
void web_settings_save_mod(void);
void web_modern_key(int down, uint32_t vk);
void web_modern_pointer(uint32_t message, int x, int y);

/* the game thread's side (presenter.c) */
void web_presenter_start(int (*menus_use_windows_cursor)(void));
void web_presenter_pump(void);       /* from the pump hook: input in, the cursor out, fps */
