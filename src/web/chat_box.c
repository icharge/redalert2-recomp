/* The page's chat box: a text box the page lays over the game's own chat line.
 *
 * The game's chat screens (the WOL lobby 0x113, the game rooms and LAN setup screens, the Page
 * dialogs, the co-op score screen) keep their typing line in Edit 0x540, and the game lays its own
 * control over it, as over the map search box (map_search.c). The page shows a real text box in its
 * place, so the browser's IME and keyboard (Thai and the rest) type into something visible; on Enter
 * it sends the text here, and it reaches that control as typed characters and an Enter key, so the
 * game sends it as its own chat (commands such as /r, /page and /on included).
 *
 * The page learns where the line is from the chatField event, sent from the presenter's pump. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "web_api.h"
#include "win32hle.h"

#define CHAT_EDIT_ID 0x540u
#define WS_VISIBLE 0x10000000u
#define WM_KEYDOWN 0x0100u
#define WM_KEYUP 0x0101u
#define WM_CHAR 0x0102u
#define VK_RETURN 0x0Du
#define RETURN_SCAN 0x1Cu

/* The dialogs that hold a chat line in Edit 0x540 (both editions' templates). */
static int is_chat_screen(uint32_t id) {
    switch (id) {
    case 0xBB: case 0xBC: case 0xBD: case 0xC2: case 0xC9:   /* game rooms, LAN setup */
    case 0x113:                                              /* the WOL lobby */
    case 0x11B: case 0x11E:                                  /* Page */
    case 0xBC6:                                              /* the co-op score screen */
        return 1;
    }
    return 0;
}

#define MAX_SCREENS 8
static uint32_t g_screens[MAX_SCREENS];   /* oldest first; 0 is a free place */

/* What the page was last told. */
typedef struct { int open, x, y, w, h; } field_status;
static field_status g_told;
static uint32_t g_box;                    /* the game's control over the showing line */

static int showing(uint32_t h) { return h && hle_is_window(h) && (hle_window_style(h) & WS_VISIBLE); }

/* user32's dialog hook, through script.c. */
void web_chat_box_dialog(uint32_t hwnd, uint32_t id) {
    if (!is_chat_screen(id)) return;
    int at = -1;
    for (int i = 0; i < MAX_SCREENS; i++)
        if (!g_screens[i] || !hle_is_window(g_screens[i]) || g_screens[i] == hwnd) { at = i; break; }
    if (at < 0) {
        memmove(g_screens, g_screens + 1, sizeof g_screens - sizeof g_screens[0]);
        at = MAX_SCREENS - 1;
    }
    /* keep the order: the newest last */
    for (int i = at; i + 1 < MAX_SCREENS; i++) g_screens[i] = g_screens[i + 1];
    g_screens[MAX_SCREENS - 1] = 0;
    for (int i = 0; i < MAX_SCREENS; i++)
        if (!g_screens[i]) { g_screens[i] = hwnd; break; }
}

/* The newest showing chat screen's line: its Edit's place, and the game's control over it. */
static uint32_t chat_line(int *l, int *t, int *r, int *b) {
    for (int i = MAX_SCREENS - 1; i >= 0; i--) {
        uint32_t dialog = g_screens[i];
        if (!showing(dialog)) continue;
        uint32_t edit = hle_dialog_item(dialog, CHAT_EDIT_ID);
        if (!edit || !hle_window_screen_rect(edit, l, t, r, b) || *r <= *l || *b <= *t) continue;
        uint32_t h = hle_window_at((*l + *r) / 2, (*t + *b) / 2, NULL, NULL);
        if (h && hle_window_parent(h) != dialog) h = 0;   /* another window covers it */
        if (!h) continue;
        return h;
    }
    return 0;
}

/* The presenter's pump, on the game's thread. */
void web_chat_box_pump(void) {
    field_status now = { 0 };
    int l, t, r, b;
    g_box = chat_line(&l, &t, &r, &b);
    if (g_box) now.open = 1, now.x = l, now.y = t, now.w = r - l, now.h = b - t;
    if (!memcmp(&now, &g_told, sizeof now)) return;
    char event[128];
    snprintf(event, sizeof event, "{\"e\":\"chatField\",\"open\":%s,\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d}",
             now.open ? "true" : "false", now.x, now.y, now.w, now.h);
    web_event_json(event);
    g_told = now;
}

/* One character of the page's text (the game's encoding), or 0: the text is whole, press Enter. */
void web_chat_box_char(uint32_t character) {
    if (!g_box || !hle_is_window(g_box)) return;
    if (character) {
        hle_post_message(g_box, WM_CHAR, character, 1u);
        return;
    }
    hle_post_message(g_box, WM_KEYDOWN, VK_RETURN, 1u | RETURN_SCAN << 16);
    hle_post_message(g_box, WM_CHAR, '\r', 1u | RETURN_SCAN << 16);
    hle_post_message(g_box, WM_KEYUP, VK_RETURN, 1u | RETURN_SCAN << 16 | 3u << 30);
}
