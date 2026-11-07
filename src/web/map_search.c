/* The map search: a search box in the game's own map screens.
 *
 * Customize Battle (dialog 0x6B) and the network game's map screen (0xCD) list maps in list box
 * 1363. Their templates get one more control, an Edit at the top of the list (map_dialog.c). The
 * game's own procedure paints that Edit but doesn't expose its text through WM_GETTEXT, so the
 * page's committed text and edit keys are tracked and the list is filtered on the game's thread. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "map_dialog.h"
#include "map_match.h"
#include "web_api.h"
#include "win32hle.h"

#define MAP_LIST_ID 1363u
#define SEARCH_ID 0x7FFEu
#define SEARCH_HEIGHT 12
#define WM_KEYDOWN 0x0100u
#define WM_CHAR 0x0102u

static int is_map_screen(uint32_t id) { return id == 0x6Bu || id == 0xCDu; }

static uint8_t g_templates[2][4096];
static uint32_t g_dialog;
static uint32_t g_edit;
static char g_input[128];
static char g_seen[128];
static unsigned g_input_len, g_input_pos;
static int g_backspace_pending;
static int g_search_focused;
static char g_query[128];
static int g_players;
static int g_no_matches;
static int g_event_open, g_event_no_matches;
static int g_event_x, g_event_y, g_event_w, g_event_h;

static int keep(const char *text, uint32_t data, void *ctx) {
    (void)data, (void)ctx;
    return ra2_map_matches(text, g_query, g_players);
}

/* user32's swap hook: the screen's template, with the box. 0 leaves the game's. */
static uint32_t with_search_box(uint32_t id, uint32_t tmpl) {
    if (!is_map_screen(id)) return 0;
    uint8_t *out = g_templates[id == 0xCDu];
    size_t n = ra2_map_dialog((const uint8_t *)(uintptr_t)tmpl, 4096, out, sizeof g_templates[0], MAP_LIST_ID,
                              SEARCH_ID, SEARCH_HEIGHT);
    return n ? (uint32_t)(uintptr_t)out : 0;
}

void web_map_search_start(void) { hle_dialog_template_swap = with_search_box; }

/* user32's dialog hook, through script.c: a map screen opened. A new screen starts unfiltered. */
void web_map_search_dialog(uint32_t hwnd, uint32_t id) {
    if (!is_map_screen(id)) return;
    g_dialog = hwnd;
    g_edit = hle_dialog_item(hwnd, SEARCH_ID);
    g_input[0] = g_seen[0] = g_query[0] = 0;
    g_input_len = g_input_pos = 0, g_players = 0, g_backspace_pending = 0, g_search_focused = 0;
    g_no_matches = 0;
}

static void apply_search(void) {
    uint32_t d = g_dialog;
    if (!d || !hle_is_window(d)) return;
    if (!g_edit || !hle_is_window(g_edit)) g_edit = hle_dialog_item(d, SEARCH_ID);
    if (!g_edit || !hle_is_window(g_edit)) return;
    uint32_t list = hle_dialog_item(d, MAP_LIST_ID);
    if (!list) return;
    ra2_map_query(g_query, sizeof g_query, g_input);
    g_players = ra2_map_players(g_query);
    int active = g_query[0] || g_players;
    int shown = hle_list_filter(list, active ? keep : NULL, NULL);
    g_no_matches = active && shown == 0;
}

static void publish_status(int open, int x, int y, int w, int h) {
    if (open == g_event_open && g_no_matches == g_event_no_matches &&
        x == g_event_x && y == g_event_y && w == g_event_w && h == g_event_h) return;
    char event[160];
    snprintf(event, sizeof event,
             "{\"e\":\"mapSearch\",\"open\":%s,\"noMatches\":%s,\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d}",
             open ? "true" : "false", g_no_matches ? "true" : "false", x, y, w, h);
    web_event_json(event);
    g_event_open = open;
    g_event_no_matches = g_no_matches;
    g_event_x = x, g_event_y = y, g_event_w = w, g_event_h = h;
}

/* A click hit-test keeps map-list navigation keys out of the search caret tracker. */
void web_map_search_click(int x, int y) {
    if (!g_dialog || !hle_is_window(g_dialog)) return;
    if (!g_edit || !hle_is_window(g_edit)) g_edit = hle_dialog_item(g_dialog, SEARCH_ID);
    int client_x, client_y;
    g_search_focused = g_edit && hle_window_at(x, y, &client_x, &client_y) == g_edit;
    if (g_search_focused) g_input_pos = g_input_len;
}

/* The custom-painted Edit doesn't expose its text. Track committed characters and edit keys. */
void web_map_search_message(uint32_t hwnd, uint32_t message, uint32_t wParam, uint32_t lParam) {
    (void)hwnd;
    (void)lParam;
    if (!g_dialog || !hle_is_window(g_dialog)) return;
    if (message == WM_CHAR) {
        /* Text input is only emitted for the focused browser text sink. */
        g_search_focused = 1;
        if (wParam == 8u) {
            if (g_backspace_pending) g_backspace_pending = 0;
            else if (g_input_pos) {
                memmove(g_input + g_input_pos - 1, g_input + g_input_pos, g_input_len - g_input_pos + 1);
                g_input_len--, g_input_pos--;
            }
        } else if (wParam >= 32u && wParam <= 255u && g_input_len + 1 < sizeof g_input) {
            g_backspace_pending = 0;
            memmove(g_input + g_input_pos + 1, g_input + g_input_pos, g_input_len - g_input_pos + 1);
            g_input[g_input_pos++] = (char)wParam;
            g_input_len++;
        }
    } else if (message == WM_KEYDOWN && g_search_focused) {
        if (wParam == 0x24u) g_input_pos = 0;
        else if (wParam == 0x23u) g_input_pos = g_input_len;
        else if (wParam == 0x25u && g_input_pos) g_input_pos--;
        else if (wParam == 0x27u && g_input_pos < g_input_len) g_input_pos++;
        else if (wParam == 8u && g_input_pos) {
            memmove(g_input + g_input_pos - 1, g_input + g_input_pos, g_input_len - g_input_pos + 1);
            g_input_len--, g_input_pos--, g_backspace_pending = 1;
        } else if (wParam == 0x2Eu && g_input_pos < g_input_len) {
            memmove(g_input + g_input_pos, g_input + g_input_pos + 1, g_input_len - g_input_pos);
            g_input_len--;
        }
    }
}

/* Input drains immediately before this presenter pump, so a changed query can be applied here. */
void web_map_search_pump(void) {
    uint32_t d = g_dialog;
    if (!d || !hle_is_window(d) || !(hle_window_style(d) & 0x10000000u)) {
        publish_status(0, 0, 0, 0, 0);
        return;
    }
    if (strcmp(g_input, g_seen) != 0) {
        snprintf(g_seen, sizeof g_seen, "%s", g_input);
        apply_search();
    }
    uint32_t list = hle_dialog_item(d, MAP_LIST_ID);
    int l = 0, t = 0, r = 0, b = 0;
    if (!list || !hle_window_screen_rect(list, &l, &t, &r, &b)) {
        publish_status(0, 0, 0, 0, 0);
        return;
    }
    publish_status(1, l, t, r - l, b - t);
}
