/* The map search: a search box in the game's own map screens.
 *
 * Customize Battle (dialog 0x6B: skirmish, LAN and WOL hosts) and 0xCD (a smaller map picker) list
 * maps in list box 1363. Their templates get one more control, an Edit at the top of the list (map_dialog.c). The
 * game lays its own one-line control over that Edit, draws it, and keeps the typed text inside
 * itself, where user32 can't read it. So the search follows what reaches that control (map_box.c):
 * each click and key the game takes from its queue for it (hle_take_hook), whichever way the page
 * sent it. The list is filtered on the game's thread, in the presenter's pump. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "map_box.h"
#include "map_dialog.h"
#include "map_match.h"
#include "web_api.h"
#include "win32hle.h"

#define MAP_LIST_ID 1363u
#define SEARCH_ID 0x7FFEu
#define SEARCH_HEIGHT 12            /* dialog units */
#define TEMPLATE_BYTES 4096         /* room for a map screen's template, with the box */
#define WS_VISIBLE 0x10000000u

static int is_map_screen(uint32_t id) { return id == 0x6Bu || id == 0xCDu; }

static uint8_t g_templates[2][TEMPLATE_BYTES];

/* The open map screen. */
static struct {
    uint32_t dialog, edit, box;     /* box: the game's control over the Edit */
    ra2_map_box text;
    int changed, searching;         /* searching: the box's text filters the list */
} g_screen;

/* What the page was last told: the list's place, and whether the search left it empty. */
typedef struct { int open, no_matches, x, y, w, h; } search_status;
static search_status g_told;

static char g_query[sizeof g_screen.text.text];
static int g_players;

static int keep(const char *text, uint32_t data, void *ctx) {
    (void)data, (void)ctx;
    return ra2_map_matches(text, g_query, g_players);
}

static int keep_none(const char *text, uint32_t data, void *ctx) {
    (void)text, (void)data, (void)ctx;
    return 0;
}

/* user32's swap hook: the screen's template, with the box. 0 leaves the game's. */
static uint32_t with_search_box(uint32_t id, uint32_t tmpl) {
    if (!is_map_screen(id)) return 0;
    uint8_t *out = g_templates[id == 0xCDu];
    size_t n = ra2_map_dialog((const uint8_t *)(uintptr_t)tmpl, TEMPLATE_BYTES, out, sizeof g_templates[0],
                              MAP_LIST_ID, SEARCH_ID, SEARCH_HEIGHT);
    return n ? (uint32_t)(uintptr_t)out : 0;
}

static int screen_showing(void) {
    return g_screen.dialog && hle_is_window(g_screen.dialog) && (hle_window_style(g_screen.dialog) & WS_VISIBLE);
}

/* The game's control over the Edit: the one a click at the Edit's middle reaches. */
static uint32_t search_box(void) {
    if (g_screen.box && hle_is_window(g_screen.box)) return g_screen.box;
    if (!g_screen.edit || !hle_is_window(g_screen.edit)) g_screen.edit = hle_dialog_item(g_screen.dialog, SEARCH_ID);
    int l, t, r, b;
    if (!g_screen.edit || !hle_window_screen_rect(g_screen.edit, &l, &t, &r, &b)) return 0;
    uint32_t h = hle_window_at((l + r) / 2, (t + b) / 2, NULL, NULL);
    g_screen.box = h && hle_window_parent(h) == g_screen.dialog ? h : 0;
    return g_screen.box;
}

/* user32's take hook: a posted message, as the game takes it from its queue. */
static void taken(uint32_t hwnd, uint32_t message, uint32_t wParam, uint32_t lParam) {
    (void)lParam;
    if (!screen_showing() || hwnd != search_box()) return;
    if (ra2_map_box_take(&g_screen.text, message, wParam)) g_screen.changed = 1;
}

void web_map_search_start(void) {
    hle_dialog_template_swap = with_search_box;
    hle_take_hook = taken;
}

/* user32's dialog hook, through script.c: a map screen opened. A new screen starts unfiltered. */
void web_map_search_dialog(uint32_t hwnd, uint32_t id) {
    if (!is_map_screen(id)) return;
    memset(&g_screen, 0, sizeof g_screen);
    g_screen.dialog = hwnd;
}

/* Filter the list by the box's text. A box holding more than the search can read shows no maps
 * (the list then shows none, while the game keeps the player's pick). */
static void apply_search(uint32_t list) {
    if (g_screen.text.overflow) {
        hle_list_filter(list, keep_none, NULL);
        g_screen.searching = 1;
        return;
    }
    ra2_map_query(g_query, sizeof g_query, g_screen.text.text);
    g_players = ra2_map_players(g_query);
    g_screen.searching = g_query[0] || g_players;
    hle_list_filter(list, g_screen.searching ? keep : NULL, NULL);
}

static void tell(search_status now) {
    if (!memcmp(&now, &g_told, sizeof now)) return;
    char event[160];
    snprintf(event, sizeof event,
             "{\"e\":\"mapSearch\",\"open\":%s,\"noMatches\":%s,\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d}",
             now.open ? "true" : "false", now.no_matches ? "true" : "false", now.x, now.y, now.w, now.h);
    web_event_json(event);
    g_told = now;
}

static void maps_rescan_now(void);
static int maps_rescan_pending(void);

/* The presenter's pump, on the game's thread. */
void web_map_search_pump(void) {
    if (maps_rescan_pending()) maps_rescan_now();
    search_status now = { 0 };
    uint32_t list = screen_showing() ? hle_dialog_item(g_screen.dialog, MAP_LIST_ID) : 0;
    int l, t, r, b;
    if (!list || !hle_window_screen_rect(list, &l, &t, &r, &b)) {
        tell(now);
        return;
    }
    if (g_screen.changed) g_screen.changed = 0, apply_search(list);
    /* user32 applies the search at the game's next message, and again when the game fills the
     * list for another game type: count what it shows now. */
    int shown = 0;
    hle_list_counts(list, &shown, NULL);
    now.open = 1, now.no_matches = g_screen.searching && shown == 0;
    now.x = l, now.y = t, now.w = r - l, now.h = b - t;
    tell(now);
}

/* ---- prototype: scan the map folder again (docs/web/online-maps-research.md) ----------------------
 * Yuri's Revenge only. The game lists its maps once, in Session's one-time init (0x699980), into the
 * vector at Session + 0x690. ra2_maps_rescan(truncate) asks the pump to run that scan again on the
 * game's thread; truncate 1 sets the vector's count to 0 first (the old items are leaked), 0 appends. */
#ifndef RA2_TARGET_GAME
#include <emscripten.h>
#include "recomp_types.h"

#define SESSION_VA 0x00A8B238u
#define MAP_ITEMS_VA 0x00A8B8CCu    /* the vector's item array */
#define MAP_COUNT_VA 0x00A8B8D8u
#define MAP_SCAN_VA 0x00699980u     /* Session::scan_maps(), ecx = Session */
#define MAP_NAME_OFFSET 0x58u

extern uint32_t g_ecx;
static volatile int g_rescan;       /* 0 none, 1 append, 2 truncate first */

EMSCRIPTEN_KEEPALIVE int ra2_maps_count(void) { return (int)MEM32(MAP_COUNT_VA); }

EMSCRIPTEN_KEEPALIVE void ra2_maps_rescan(int truncate) { g_rescan = truncate ? 2 : 1; }

static void maps_dump(const char *why) {
    uint32_t n = MEM32(MAP_COUNT_VA), items = MEM32(MAP_ITEMS_VA);
    fprintf(stderr, "[maps] %s: %u maps\n", why, n);
    for (uint32_t i = 0; i < n && i < 4096; i++) {
        uint32_t item = MEM32(items + 4u * i);
        fprintf(stderr, "[maps]   %u %s\n", i, item ? (const char *)(uintptr_t)(item + MAP_NAME_OFFSET) : "(null)");
    }
}

EMSCRIPTEN_KEEPALIVE void ra2_maps_dump(void) { g_rescan = 3; }

static int maps_rescan_pending(void) { return g_rescan; }

static void maps_rescan_now(void) {
    int how = g_rescan;
    g_rescan = 0;
    if (how == 3) { maps_dump("dump"); return; }
    uint32_t before = MEM32(MAP_COUNT_VA);
    if (how == 2) MEM32(MAP_COUNT_VA) = 0;
    uint32_t keep = g_ecx;
    g_ecx = SESSION_VA;
    hle_call_guest(MAP_SCAN_VA, 0, NULL);
    g_ecx = keep;
    fprintf(stderr, "[maps] rescan (%s): %u -> %u\n", how == 2 ? "truncate" : "append", before, MEM32(MAP_COUNT_VA));
    maps_dump("after rescan");
}
#else
static void maps_rescan_now(void) {}
static int maps_rescan_pending(void) { return 0; }
#endif
