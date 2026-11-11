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

#include "finder_screen.h"
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
#define RANDOM_MAP_ID 0x583u        /* Customize Battle's Random Map button... */
#define FIND_BUTTON_ID 0x7FFDu      /* ...and ours under it: Find Maps (the page's map finder) */
#define FIND_BUTTON_TITLE "GUI:Find"    /* the game's own "Find", in the player's language */
#define FIND_PRESS_QUIET_MS 300   /* repeats of one press that arrive within this are the same press */
#define FIND_BUTTON_GAP 4           /* dialog units under Random Map */
#define WM_COMMAND 0x0111u

static int is_map_screen(uint32_t id) { return id == 0x6Bu || id == 0xCDu; }

static uint8_t g_templates[2][TEMPLATE_BYTES];

/* The open map screen. */
static struct {
    uint32_t dialog, edit, box;     /* box: the game's control over the Edit */
    uint32_t find;                  /* the Find Maps button, once settled */
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
    const uint8_t *game = (const uint8_t *)(uintptr_t)tmpl;
#ifndef RA2_TARGET_GAME
    if (id == 0x6Bu) {
        /* Yuri's Revenge: the Find Maps button under Random Map, in the same plate */
        static uint8_t stage[TEMPLATE_BYTES];
        size_t m = ra2_map_dialog(game, TEMPLATE_BYTES, stage, sizeof stage, MAP_LIST_ID, SEARCH_ID, SEARCH_HEIGHT);
        if (!m) return 0;
        size_t n = ra2_map_dialog_button(stage, m, out, sizeof g_templates[0], RANDOM_MAP_ID, RANDOM_MAP_ID,
                                         FIND_BUTTON_TITLE, FIND_BUTTON_GAP);
        if (!n) memcpy(out, stage, m), n = m;
        return (uint32_t)(uintptr_t)out;
    }
#endif
    size_t n = ra2_map_dialog(game, TEMPLATE_BYTES, out, sizeof g_templates[0], MAP_LIST_ID, SEARCH_ID,
                              SEARCH_HEIGHT);
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
#ifndef RA2_TARGET_GAME
    web_finder_screen_take(hwnd, message, wParam);
#endif
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

/* user32's proc hook, through script.c: a message delivered to a window. The Find Maps button is
 * clicked when the screen gets its WM_COMMAND (BN_CLICKED); the game knows nothing of the id and
 * ignores it, so the page is told and opens the map finder. */
void web_map_search_message(uint32_t hwnd, uint32_t message, uint32_t wParam, uint32_t lParam) {
    (void)lParam;
    if (message != WM_COMMAND || !g_screen.dialog || hwnd != g_screen.dialog) return;
    if ((wParam & 0xFFFFu) != FIND_BUTTON_ID || (wParam >> 16) != 0) return;
    /* The hook sees a message at each procedure that passes it along, so one press arrives as several
     * (four, here): take the first, and none again for a moment. */
    static uint32_t last_ms;
    uint32_t now = hle_ticks_ms();
    if (last_ms && now - last_ms < FIND_PRESS_QUIET_MS) return;
    last_ms = now;
#if defined(RA2_FINDER_NATIVE) && !defined(RA2_TARGET_GAME)
    web_finder_screen_open();   /* prototype: a screen of the game's own instead of the page's panel */
#else
    web_event_json("{\"e\":\"mapFinder\"}");
#endif
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
static void find_button_settle(void);

/* The screen the finder opens over. */
uint32_t web_finder_screen_owner(void) { return screen_showing() ? g_screen.dialog : 0; }

/* The presenter's pump, on the game's thread. */
void web_map_search_pump(void) {
    /* The scan reads every map file again, on this thread: the game stands still for it, longer with each map added.
     * While the finder covers the map screen nobody sees that screen's list, so the scan waits for the finder to
     * close, and then runs once for all the maps it added. */
    int covered = 0;
#ifndef RA2_TARGET_GAME
    covered = web_finder_screen_showing();
#endif
    if (maps_rescan_pending() && !covered) maps_rescan_now();
    find_button_settle();
#ifndef RA2_TARGET_GAME
    web_finder_screen_pump();
#endif
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
#define MAP_TYPE_LIST_ID 0x6EBu     /* the game type list (Battle, Free For All, ...) */
#define MAP_TYPE_LAST_VA 0x008316FCu /* the game type the map list was last filled for */
#define MAP_REFILL_COMMAND ((1u << 16) | MAP_TYPE_LIST_ID) /* WM_COMMAND: LBN_SELCHANGE of the game type list */

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

/* The red plate. The game gives a button its plate, and lays it out, only if the screen's id table knows it
 * (0x608CD0: for Customize Battle, Random Map 0x583 and Use Map 0x6C5); any other control is laid out as a
 * plain one and drawn on a grey plate. So the template makes the Find Maps button with Random Map's id, the game
 * treats it as one of its buttons while it makes the screen, and here, once that is done, it is given its own id
 * (the game reads a control's id when it is pressed, not before) and put under Random Map. */
static void find_button_settle(void) {
    if (!screen_showing() || g_screen.find) return;
    uint32_t find = hle_dialog_item_nth(g_screen.dialog, RANDOM_MAP_ID, 1), rnd = hle_dialog_item(g_screen.dialog, RANDOM_MAP_ID);
    int dl, dt, dr, db, rl, rt, rr, rb;
    if (!find || !rnd || !hle_window_screen_rect(g_screen.dialog, &dl, &dt, &dr, &db) ||
        !hle_window_screen_rect(rnd, &rl, &rt, &rr, &rb))
        return;
    hle_set_control_id(find, FIND_BUTTON_ID);
    hle_move_window(find, rl - dl, rb - dt, rr - rl, rb - rt);
    g_screen.find = find;
    fprintf(stderr, "[maps] Find Maps button %x settled under Random Map\n", find);
}

static void maps_rescan_now(void) {
    int how = g_rescan;
    g_rescan = 0;
    if (how == 3) { maps_dump("dump"); return; }
    uint32_t before = MEM32(MAP_COUNT_VA);
    if (how == 2) MEM32(MAP_COUNT_VA) = 0;
    uint32_t keep = g_ecx;
    g_ecx = SESSION_VA;
    double began = emscripten_get_now();
    hle_call_guest(MAP_SCAN_VA, 0, NULL);
    g_ecx = keep;
    fprintf(stderr, "[maps] rescan (%s): %u -> %u in %.0f ms\n", how == 2 ? "truncate" : "append", before, MEM32(MAP_COUNT_VA), emscripten_get_now() - began);
    /* A Customize Battle that is already open filled its list before the scan. Its proc rebuilds list 1363
     * from the vector when the game type list (0x6EB) reports a selection change (0x5E6B78); send it that, so
     * a new map shows with no reopen. (WM_COMMAND 0x583 is the Random Map button: not that.) */
    uint32_t types = screen_showing() ? hle_dialog_item(g_screen.dialog, MAP_TYPE_LIST_ID) : 0;
    if (types) {
        /* The proc does nothing when the picked game type is the one it last filled the list for (it keeps that in
         * 0x8316FC). Forget it, or the list keeps the old map objects: the preview looks the picked item up in the
         * vector, finds nothing, and stays as it was. */
        MEM32(MAP_TYPE_LAST_VA) = 0xFFFFFFFFu;
        hle_post_message(g_screen.dialog, 0x111u, MAP_REFILL_COMMAND, types);   /* lParam: the list, as Windows sends it */
    }
}
#else
static void find_button_settle(void) {}
static void maps_rescan_now(void) {}
static int maps_rescan_pending(void) { return 0; }
#endif
