/* The map search: the page's search box over the game's map list (docs/web/protocol.md, "mapList").
 *
 * Customize Battle (dialog 0x6B) and the network game's map screen (0xCD) list the maps in list box
 * 1363, in both games, one item a map: "Lake Blitzen (2-4)". While one is up, the pump tells the page
 * where the list is and how many maps it shows; the page sends the search (ra2_map_search) and the
 * list keeps only the matches (win32hle's hle_list_filter): the game sees the shorter list as the
 * whole list, so the map it starts is the one the player picked. The rules are map_match.c's. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <emscripten.h>

#include "map_match.h"
#include "win32hle.h"

void web_event_json(const char *json);   /* presenter.c */

#define MAP_LIST_ID 1363u
#define WS_VISIBLE 0x10000000u

static volatile uint32_t g_dialog;       /* the map screen, from its creation */

/* The page's search, written on the main thread and read on the game's: a sequence lock (odd while
 * the page writes). */
static volatile unsigned g_want_seq;
static char g_want_text[128];
static volatile int g_want_players;

/* What the list has: the search applied, and what the page was last told. */
static char g_query[128];
static int g_players;
static unsigned g_applied;
static int g_matched = -1;               /* what the search applied kept: 0 none (then the list shows all) */
static struct { int open, x, y, w, h, shown, total, matched; unsigned seq; } g_told;

EMSCRIPTEN_KEEPALIVE void ra2_map_search(const char *text, int players, int seq) {
    unsigned s = g_want_seq;
    __atomic_store_n(&g_want_seq, s | 1u, __ATOMIC_RELEASE);
    snprintf(g_want_text, sizeof g_want_text, "%s", text ? text : "");
    g_want_players = players;
    __atomic_store_n(&g_want_seq, (unsigned)seq << 1, __ATOMIC_RELEASE);
}

static int keep(const char *text, uint32_t data, void *ctx) {
    (void)data, (void)ctx;
    return ra2_map_matches(text, g_query, g_players);
}

/* user32's dialog hook, through script.c: a map screen opened. A new screen starts unfiltered. */
void web_map_search_dialog(uint32_t hwnd, uint32_t id) {
    if (id != 0x6Bu && id != 0xCDu) return;
    g_dialog = hwnd;
    g_query[0] = 0, g_players = 0, g_matched = -1;
}

/* On the game's thread, every pump. */
void web_map_search_pump(void) {
    uint32_t d = g_dialog, list = 0;
    if (d && hle_is_window(d) && (hle_window_style(d) & WS_VISIBLE)) list = hle_dialog_item(d, MAP_LIST_ID);
    if (list && !(hle_window_style(list) & WS_VISIBLE)) list = 0;

    unsigned want = __atomic_load_n(&g_want_seq, __ATOMIC_ACQUIRE);
    if (list && !(want & 1u) && want != g_applied) {
        char text[sizeof g_want_text];
        memcpy(text, g_want_text, sizeof text);
        int players = g_want_players;
        if (__atomic_load_n(&g_want_seq, __ATOMIC_ACQUIRE) == want) {   /* not rewritten while copied */
            ra2_map_query(g_query, sizeof g_query, text);
            g_players = players > 0 ? players : 0;
            g_matched = hle_list_filter(list, g_query[0] || g_players ? keep : NULL, NULL);
            g_applied = want;
        }
    }

    int l = 0, t = 0, r = 0, b = 0, shown = 0, total = 0;
    int open = list && hle_window_screen_rect(list, &l, &t, &r, &b) && hle_list_counts(list, &shown, &total);
    if (!open) l = t = r = b = shown = total = 0;
    if (open == g_told.open && l == g_told.x && t == g_told.y && r - l == g_told.w && b - t == g_told.h &&
        shown == g_told.shown && total == g_told.total && g_matched == g_told.matched && g_applied == g_told.seq)
        return;
    g_told.open = open, g_told.x = l, g_told.y = t, g_told.w = r - l, g_told.h = b - t;
    g_told.shown = shown, g_told.total = total, g_told.matched = g_matched, g_told.seq = g_applied;
    char line[200];
    snprintf(line, sizeof line,
             "{\"e\":\"mapList\",\"open\":%d,\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d,\"shown\":%d,\"total\":%d,"
             "\"matched\":%d,\"seq\":%u}",
             open, l, t, r - l, b - t, shown, total, g_matched, g_applied >> 1);
    web_event_json(line);
}
