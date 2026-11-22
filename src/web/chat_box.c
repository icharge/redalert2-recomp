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
#include "wolapi.h"
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
static uint32_t g_screen_ids[MAX_SCREENS];

/* The game's buttons the page's FRIENDS opens from, instead of the game's old Page dialog and Buddy
 * List: the page lays a button of its own over each (Play.tsx, PageButton.tsx), so it is told where
 * they are too.
 * - the Page button (0x5C2, "GUI:PageButton"): Yuri's Revenge's game rooms (0xC2, 0xC9). The Page
 *   dialogs use 0x5C2 for their own buttons: only these screens count. The lobby's Page button is
 *   hidden (web_chat_box_template): there the Buddy List does the same.
 * - the Buddy List button (0x689, "GUI:PlayBuddy"): the lobby, in both games (Red Alert 2 has no
 *   Buddy List screen behind it at all). */
#include "recomp_target.h"
#define PAGE_BUTTON_ID 0x5C2u
#define BUDDY_BUTTON_ID 0x689u
#if defined(RA2_TARGET_GAME)
static int has_page_button(uint32_t id) { (void)id; return 0; }
#else
static int has_page_button(uint32_t id) { return id == 0xC2u || id == 0xC9u; }
#endif
static int has_buddy_button(uint32_t id) { return id == 0x113u; }

/* What the page was last told: the chat line, the Page button and the Buddy List button (w 0: none). */
typedef struct { int open, x, y, w, h, px, py, pw, ph, bx, by, bw, bh; } field_status;
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
        memmove(g_screen_ids, g_screen_ids + 1, sizeof g_screen_ids - sizeof g_screen_ids[0]);
        at = MAX_SCREENS - 1;
    }
    /* keep the order: the newest last */
    for (int i = at; i + 1 < MAX_SCREENS; i++) g_screens[i] = g_screens[i + 1], g_screen_ids[i] = g_screen_ids[i + 1];
    g_screens[MAX_SCREENS - 1] = 0;
    for (int i = 0; i < MAX_SCREENS; i++)
        if (!g_screens[i]) { g_screens[i] = hwnd, g_screen_ids[i] = id; break; }
}

/* The newest showing chat screen's line: its Edit's place, and the game's control over it; *screen
 * is where that screen is in g_screens. */
static uint32_t chat_line(int *l, int *t, int *r, int *b, int *screen) {
    for (int i = MAX_SCREENS - 1; i >= 0; i--) {
        uint32_t dialog = g_screens[i];
        if (!showing(dialog)) continue;
        uint32_t edit = hle_dialog_item(dialog, CHAT_EDIT_ID);
        if (!edit || !hle_window_screen_rect(edit, l, t, r, b) || *r <= *l || *b <= *t) continue;
        uint32_t h = hle_window_at((*l + *r) / 2, (*t + *b) / 2, NULL, NULL);
        if (h && hle_window_parent(h) != dialog) h = 0;   /* another window covers it */
        if (!h) continue;
        *screen = i;
        return h;
    }
    return 0;
}

/* The presenter's pump, on the game's thread. */
void web_chat_box_pump(void) {
    field_status now = { 0 };
    int l, t, r, b, screen = -1;
    g_box = chat_line(&l, &t, &r, &b, &screen);
    if (g_box) {
        now.open = 1, now.x = l, now.y = t, now.w = r - l, now.h = b - t;
        uint32_t page = has_page_button(g_screen_ids[screen]) ? hle_dialog_item(g_screens[screen], PAGE_BUTTON_ID) : 0;
        if (showing(page) && hle_window_screen_rect(page, &l, &t, &r, &b) && r > l && b > t)
            now.px = l, now.py = t, now.pw = r - l, now.ph = b - t;
        uint32_t buddy = has_buddy_button(g_screen_ids[screen]) ? hle_dialog_item(g_screens[screen], BUDDY_BUTTON_ID) : 0;
        if (showing(buddy) && hle_window_screen_rect(buddy, &l, &t, &r, &b) && r > l && b > t)
            now.bx = l, now.by = t, now.bw = r - l, now.bh = b - t;
    }
    if (!memcmp(&now, &g_told, sizeof now)) return;
    char event[256];
    snprintf(event, sizeof event,
             "{\"e\":\"chatField\",\"open\":%s,\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d,"
             "\"px\":%d,\"py\":%d,\"pw\":%d,\"ph\":%d,\"bx\":%d,\"by\":%d,\"bw\":%d,\"bh\":%d}",
             now.open ? "true" : "false", now.x, now.y, now.w, now.h, now.px, now.py, now.pw, now.ph,
             now.bx, now.by, now.bw, now.bh);
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

/* A right-click on a chat screen, at x, y in game pixels: the name in the lobby's player list (0x53E)
 * under it, told to the page as a playerPick event (an empty name: no player there), so the page can
 * offer Add friend, Message and Profile. On the game's thread (the input ring), as the list is the
 * game's. */
#define PLAYER_LIST_ID 0x53Eu
#define LB_GETITEMDATA_MSG 0x0199u
#define LB_ITEMFROMPOINT_MSG 0x01A9u

/* The lobby's player list is owner-drawn and keeps no text: each row's data is the index of the
 * user in the list the game was given (wolapi.c's channel roster), whose name the shim knows. */
void web_chat_box_pick(int x, int y) {
    char name[64] = "";
    for (int i = MAX_SCREENS - 1; i >= 0 && !name[0]; i--) {
        if (g_screen_ids[i] != 0x113u || !showing(g_screens[i])) continue;
        uint32_t list = hle_dialog_item(g_screens[i], PLAYER_LIST_ID);
        int l, t, r, b;
        if (!showing(list) || !hle_window_screen_rect(list, &l, &t, &r, &b)) continue;
        if (x < l || x >= r || y < t || y >= b) continue;
        uint32_t at = hle_send(list, LB_ITEMFROMPOINT_MSG, 0, (uint32_t)(y - t) << 16 | (uint32_t)(x - l));
        if (at & 0x10000u) break;                       /* below the last row */
        const char *user = ra2_wolapi_user_name(hle_send(list, LB_GETITEMDATA_MSG, at & 0xFFFFu, 0));
        if (!user) break;
        size_t n = strcspn(user, ", \t");
        if (n >= sizeof name) n = sizeof name - 1;
        memcpy(name, user, n);
        name[n] = 0;
    }
    fprintf(stderr, "[chat box] right-click at %d,%d: %s\n", x, y, name[0] ? name : "no player there");
    char event[160], escaped[128];
    web_json_escape(escaped, sizeof escaped, name);
    snprintf(event, sizeof event, "{\"e\":\"playerPick\",\"name\":\"%s\",\"x\":%d,\"y\":%d}", escaped, x, y);
    web_event_json(event);
}

/* Join a game room from the page (a friend's game, an invitation): on the lobby screen, the room's row
 * in the games list (0x6EE) is selected and the screen's Join button (0x62D) pressed, as a player would.
 * Like the player list, the games list is owner-drawn: a row's data is the index of the channel in the
 * list the game was given (wolapi.c). Room names compare without case, a leading '#', spaces against
 * underscores, and the shim's 16-character cut. The page hears the outcome as a joinRoom event; the
 * game then asks for a password, says the room is full, and so on, as for its own Join. */
#define GAMES_LIST_ID 0x6EEu
#define JOIN_BUTTON_ID 0x62Du
#define LB_GETCOUNT_MSG 0x018Bu
#define LB_SETCURSEL_MSG 0x0186u
#define WM_COMMAND_MSG 0x0111u
#define LBN_SELCHANGE_CODE 1u

static char g_join_room[64];
static size_t g_join_length;

static void room_key(const char *in, char *out, size_t n) {
    size_t k = 0;
    if (*in == '#') in++;
    for (; *in && k + 1 < n; in++) {
        char c = *in == '_' ? ' ' : *in;
        out[k++] = (char)(c >= 'A' && c <= 'Z' ? c - 'A' + 'a' : c);
    }
    out[k] = 0;
}

static int same_room(const char *listed, const char *wanted) {
    char a[64], b[64];
    room_key(listed, a, sizeof a);
    room_key(wanted, b, sizeof b);
    size_t la = strlen(a);
    /* the shim keeps 16 characters of a name */
    return !strcmp(a, b) || (la == 16 && !strncmp(a, b, la));
}

static void tell_join(int ok, const char *reason) {
    char event[200], escaped[96];
    web_json_escape(escaped, sizeof escaped, g_join_room);
    snprintf(event, sizeof event, "{\"e\":\"joinRoom\",\"room\":\"%s\",\"ok\":%s,\"reason\":\"%s\"}", escaped,
             ok ? "true" : "false", reason);
    web_event_json(event);
    fprintf(stderr, "[chat box] join %s: %s\n", g_join_room, ok ? "pressed Join" : reason);
}

static void join_room(void) {
    for (int i = MAX_SCREENS - 1; i >= 0; i--) {
        if (g_screen_ids[i] != 0x113u || !showing(g_screens[i])) continue;
        uint32_t dialog = g_screens[i];
        uint32_t list = hle_dialog_item(dialog, GAMES_LIST_ID);
        uint32_t join = hle_dialog_item(dialog, JOIN_BUTTON_ID);
        if (!list || !join) break;
        uint32_t count = hle_send(list, LB_GETCOUNT_MSG, 0, 0);
        for (uint32_t row = 0; count != 0xFFFFFFFFu && row < count; row++) {
            const char *name = ra2_wolapi_channel_name(hle_send(list, LB_GETITEMDATA_MSG, row, 0));
            if (!name || !same_room(name, g_join_room)) continue;
            hle_send(list, LB_SETCURSEL_MSG, row, 0);
            hle_send(dialog, WM_COMMAND_MSG, LBN_SELCHANGE_CODE << 16 | GAMES_LIST_ID, list);
            hle_post_message(dialog, WM_COMMAND_MSG, JOIN_BUTTON_ID, join);
            tell_join(1, "");
            return;
        }
        tell_join(0, "not listed");
        return;
    }
    tell_join(0, "not in the lobby");
}

/* One character of the room's name (from the page, through the input ring), or 0: it is whole. */
void web_chat_box_join_char(uint32_t character) {
    if (character) {
        if (g_join_length + 1 < sizeof g_join_room) g_join_room[g_join_length++] = (char)character;
        return;
    }
    g_join_room[g_join_length] = 0;
    g_join_length = 0;
    join_room();
}

/* Yuri's Revenge's lobby (0x113): its Page button is left hidden, as the lobby's Buddy List opens the
 * page's FRIENDS (the game rooms keep theirs). user32's template hook, just before the dialog is made,
 * clears the button's WS_VISIBLE. Red Alert 2's lobby has no Page button. */
#define G16(a) (*(volatile uint16_t *)(uintptr_t)(a))
#define G32(a) (*(volatile uint32_t *)(uintptr_t)(a))

static uint32_t skip_name(uint32_t p) {   /* a DLGTEMPLATE sz_or_ord */
    uint16_t w = G16(p);
    if (w == 0) return p + 2;
    if (w == 0xFFFFu) return p + 4;
    while (G16(p)) p += 2;
    return p + 2;
}

void web_chat_box_template(uint32_t id, uint32_t tmpl) {
    if (id != 0x113u) return;
    if (G16(tmpl) != 1 || G16(tmpl + 2) != 0xFFFFu) return;   /* DLGTEMPLATEEX only */
    uint32_t count = G16(tmpl + 16), p = tmpl + 26;
    p = skip_name(p);                     /* menu */
    p = skip_name(p);                     /* class */
    p = skip_name(p);                     /* title */
    if (G32(tmpl + 12) & 0x40u) {         /* DS_SETFONT: point size, weight, italic + charset, typeface */
        p += 6;
        p = skip_name(p);
    }
    for (uint32_t i = 0; i < count; i++) {
        p = (p + 3) & ~3u;
        if (G32(p + 20) == PAGE_BUTTON_ID) G32(p + 8) &= ~WS_VISIBLE;
        p += 24;
        p = skip_name(p);                 /* class */
        p = skip_name(p);                 /* title */
        p += 2 + G16(p);                  /* creation data */
    }
}
