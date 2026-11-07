/* The map search: a search box in the game's own map screens.
 *
 * Customize Battle (dialog 0x6B) and the network game's map screen (0xCD) list maps in list box
 * 1363. Their templates get one more control, an Edit at the top of the list (map_dialog.c). The
 * game's own procedure paints that Edit but doesn't expose its text through WM_GETTEXT, so the
 * window-message hook records its characters and filters the list on the game's thread. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "map_dialog.h"
#include "map_match.h"
#include "win32hle.h"

#define MAP_LIST_ID 1363u
#define SEARCH_ID 0x7FFEu
#define HELP_ID 1685u
#define SEARCH_HEIGHT 12
#define WM_SETTEXT 0x000Cu
#define WM_KEYDOWN 0x0100u
#define WM_CHAR 0x0102u
#define WM_LBUTTONDOWN 0x0201u

static int is_map_screen(uint32_t id) { return id == 0x6Bu || id == 0xCDu; }

static uint8_t g_templates[2][4096];
static uint32_t g_dialog;
static uint32_t g_edit;
static char g_input[128];
static char g_seen[128];
static unsigned g_input_len, g_input_pos;
static char g_query[128];
static int g_players;
static int g_said;

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
    g_input_len = g_input_pos = 0, g_players = 0, g_said = 0;
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
    int shown = hle_list_filter(list, g_query[0] || g_players ? keep : NULL, NULL);
    int none = shown == 0;
    if (none != g_said) {
        static const char no_match[] = "No maps match";
        uint32_t help = hle_dialog_item(d, HELP_ID);
        if (help) hle_send(help, WM_SETTEXT, 0, (uint32_t)(uintptr_t)(none ? no_match : ""));
        hle_invalidate_all();
        g_said = none;
    }
}

/* The page's committed-text and key paths call this for the focused search Edit. */
void web_map_search_message(uint32_t hwnd, uint32_t message, uint32_t wParam, uint32_t lParam) {
    (void)lParam;
    if (!hwnd || !g_dialog || !hle_is_window(g_dialog)) return;
    if (!g_edit || !hle_is_window(g_edit)) g_edit = hle_dialog_item(g_dialog, SEARCH_ID);
    if (!g_edit) return;
    /* WM_CHAR from the page targets the focused window, which the game may report as its
     * dialog wrapper instead of the child Edit. The map picker has no other text entry. */
    if (message != WM_CHAR && hwnd != g_edit) return;
    int changed = 0;
    if (message == WM_CHAR) {
        if (wParam == 8u) {
            if (g_input_pos) {
                memmove(g_input + g_input_pos - 1, g_input + g_input_pos, g_input_len - g_input_pos + 1);
                g_input_len--, g_input_pos--, changed = 1;
            }
        } else if (wParam >= 32u && wParam <= 255u && g_input_len + 1 < sizeof g_input) {
            memmove(g_input + g_input_pos + 1, g_input + g_input_pos, g_input_len - g_input_pos + 1);
            g_input[g_input_pos++] = (char)wParam;
            g_input_len++, changed = 1;
        }
    } else if (message == WM_KEYDOWN) {
        if (wParam == 0x24u) g_input_pos = 0;                         /* Home */
        else if (wParam == 0x23u) g_input_pos = g_input_len;          /* End */
        else if (wParam == 0x25u && g_input_pos) g_input_pos--;       /* Left */
        else if (wParam == 0x27u && g_input_pos < g_input_len) g_input_pos++; /* Right */
        else if (wParam == 8u && g_input_pos) {                       /* Backspace */
            memmove(g_input + g_input_pos - 1, g_input + g_input_pos, g_input_len - g_input_pos + 1);
            g_input_len--, g_input_pos--, changed = 1;
        }
        else if (wParam == 0x2Eu && g_input_pos < g_input_len) {     /* Delete */
            memmove(g_input + g_input_pos, g_input + g_input_pos + 1, g_input_len - g_input_pos);
            g_input_len--, changed = 1;
        }
    } else if (message == WM_LBUTTONDOWN) {
        g_input_pos = g_input_len;                                    /* common case: continue typing */
    }
    (void)changed;
}

/* Input drains immediately before this presenter pump, so a changed query can be applied here. */
void web_map_search_pump(void) {
    uint32_t d = g_dialog;
    if (!d || !hle_is_window(d) || !(hle_window_style(d) & 0x10000000u)) return;
    if (strcmp(g_input, g_seen) != 0) {
        snprintf(g_seen, sizeof g_seen, "%s", g_input);
        apply_search();
    }
    if (g_said) {
        static const char no_match[] = "No maps match";
        uint32_t help = hle_dialog_item(d, HELP_ID);
        if (help && strcmp(hle_window_text(help), no_match) != 0) {
            hle_send(help, WM_SETTEXT, 0, (uint32_t)(uintptr_t)no_match);
            hle_invalidate_all();
        }
    }
}
