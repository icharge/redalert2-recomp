/* The map finder as a screen of the game's own (Yuri's Revenge only; a prototype, built with -DRA2_FINDER_NATIVE=ON,
 * which makes the Find Maps button open it instead of the page's panel).
 *
 * The game builds a shell screen in steps: it creates a dialog from a resource (0x775700), then calls its screen
 * set-up (0x622820, ecx = the dialog, edx = its resource id), which registers the dialog and its controls for the
 * game's own drawing, loads the screen's background, lays the controls out and gives its buttons their plates; the
 * screen's procedure hands every message to the shell's common handler (0x622B50) first; and its loop sends the
 * screen 0x4A9 as it starts. The layout knows a screen by its resource id (0x608CD0: for each id, the control ids
 * that are plate buttons). A screen of ours is made the same way: a template built here, a dialog procedure that
 * is a host function (a user32 shim, called as a guest procedure is), the set-up called with Customize Battle's id
 * (0x6B) and its control ids, and the common handler and 0x4A9 as above. The game then draws it as its own: its
 * background, its title, red plates on its buttons, frames on the Edit and the list.
 *
 * Not done: the list's rows. The game's list handler (0x618D40) answers LB_ADDSTRING on this screen's list with -1
 * and does not draw rows put in the host's list (hle_list_add), with strings or with map-shaped objects as data;
 * what it needs from a screen's procedure to take rows is not found. Nor the Edit's text, the buttons' actions
 * (Back closes the screen; the others do nothing) and the page's results. */
#ifndef RA2_TARGET_GAME
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "finder_screen.h"
#include "recomp_types.h"
#include "win32hle.h"

#define SCREEN_SETUP_VA 0x00622820u   /* ecx = the dialog, edx = its resource id */
#define SHELL_MESSAGE_VA 0x00622B50u  /* every shell screen's procedure hands its messages here first: ecx = hwnd, edx = message, (wParam, lParam) */
#define SHELL_CURRENT_VA 0x00AC48A8u  /* the game's current shell dialog, set by the set-up */
#define GAME_INSTANCE_VA 0x00B732F0u
#define LAYOUT_ID 0x6Bu               /* the screen we are made as: Customize Battle (its buttons 0x6C5 and 0x583, its map list 1363) */

#define WS_VISIBLE 0x10000000u
#define WM_INITDIALOG 0x0110u
#define WM_COMMAND 0x0111u

/* The ids are Customize Battle's (0x6B): its two buttons in their slots on the right panel (Use Map's and Random
 * Map's), its Cancel at the bottom, its map list, and its statics. */
enum { SEARCH_ID = 0x7FF0, LIST_ID = 1363, FIND_ID = 0x6C5, DOWNLOAD_ID = 0x583, CLOSE_ID = 0x5C0, TITLE_ID = 0x694, STATUS_ID = 0x695 };

static uint8_t g_tmpl[2048];
static size_t g_at;
static uint32_t g_screen, g_previous, g_owner;
static volatile int g_open_request, g_close_request;

static void w16(uint16_t v) { memcpy(g_tmpl + g_at, &v, 2), g_at += 2; }
static void w32(uint32_t v) { memcpy(g_tmpl + g_at, &v, 4), g_at += 4; }
static void wstr(const char *s) { do w16((uint16_t)(unsigned char)*s); while (*s++); }
static void item(uint32_t id, uint16_t cls, const char *text, int x, int y, int cx, int cy, uint32_t style) {
    while (g_at & 3) g_tmpl[g_at++] = 0;
    w32(0), w32(0), w32(style);
    w16((uint16_t)x), w16((uint16_t)y), w16((uint16_t)cx), w16((uint16_t)cy);
    w32(id);
    w16(0xFFFF), w16(cls);
    wstr(text);
    w16(0);
}

/* A DLGTEMPLATEEX on the grid of the game's map screens (533 x 369 dialog units): the Edit and the list at the left, the
 * buttons on the right panel, a status line at the bottom. */
static void build_template(void) {
    g_at = 0;
    memset(g_tmpl, 0, sizeof g_tmpl);
    w16(1), w16(0xFFFF), w32(0), w32(0), w32(0x40000040u | WS_VISIBLE);
    w16(8), w16(0), w16(0), w16(533), w16(369);
    w16(0), w16(0), wstr("");
    w16(8), w16(400), g_tmpl[g_at++] = 0, g_tmpl[g_at++] = 1, wstr("Arial");
    item(TITLE_ID, 0x82, "GUI:ChooseMap", 425, 1, 108, 10, 0x50020001u);
    item(0xFFFFFFFFu, 0x82, "GUI:GameMap", 77, 60, 278, 10, 0x50000201u);
    item(SEARCH_ID, 0x81, "", 77, 78, 278, 12, 0x50010080u);
    item(LIST_ID, 0x83, "", 77, 92, 278, 197, 0x50000151u);
    item(STATUS_ID, 0x82, "GUI:Blank", 2, 355, 303, 12, 0x50000200u);
    item(FIND_ID, 0x80, "GUI:Search", 425, 122, 108, 23, 0x5000000Bu);
    item(DOWNLOAD_ID, 0x80, "GUI:Add", 425, 149, 108, 23, 0x5000000Bu);
    item(CLOSE_ID, 0x80, "GUI:Back", 425, 346, 108, 23, 0x5000000Bu);
}

/* The dialog procedure, as a host function: stdcall (hwnd, message, wParam, lParam) on the guest stack. */
static void finder_proc(void) {
    uint32_t hwnd = A32(0), message = A32(1), wParam = A32(2), lParam = A32(3), result = 0;
    {
        uint32_t args[2] = { wParam, lParam }, keep_ecx = g_ecx, keep_edx = g_edx;
        g_ecx = hwnd, g_edx = message;
        hle_call_guest(SHELL_MESSAGE_VA, 2, args);
        g_ecx = keep_ecx, g_edx = keep_edx;
    }
    if (message == WM_INITDIALOG) result = 1;
    else if (message == WM_COMMAND && (wParam >> 16) == 0 && (wParam & 0xFFFFu) == CLOSE_ID) g_close_request = 1, result = 1;
    RET(result, 4);
}

static const win32hle_shim g_shims[] = { { "ra2_finder_screen_proc", finder_proc }, { NULL, NULL } };

void web_finder_screen_open(void) { g_open_request = 1; }

#define MAP_ITEM_BYTES 0x1BC   /* the game's map list rows are pointers to its 0x1BC-byte map objects, the name at +0x58 */
#define MAP_ITEM_NAME 0x58
static void fill_list(uint32_t list) {
    static const char *rows[] = { "Alpha (2)", "Bravo (4)", "Charlie (6)", "Delta (8)" };
    static uint8_t items[4][MAP_ITEM_BYTES];
    for (int i = 0; list && i < 4; i++) {
        memset(items[i], 0, MAP_ITEM_BYTES);
        strcpy((char *)items[i] + MAP_ITEM_NAME, rows[i]);
        hle_list_add(list, rows[i], (uint32_t)(uintptr_t)items[i]);
    }
}

static void open_now(void) {
    static int registered;
    uint32_t owner = web_finder_screen_owner();
    if (!owner || g_screen) return;
    if (!registered) win32hle_register(g_shims), registered = 1;
    build_template();
    uint32_t args[5] = { MEM32(GAME_INSTANCE_VA), (uint32_t)(uintptr_t)g_tmpl, hle_window_parent(owner),
                         hle_resolve("ra2_finder_screen_proc"), 0 };
    uint32_t h = hle_call_guest(hle_resolve("CreateDialogIndirectParamA"), 5, args);
    fprintf(stderr, "[finder] dialog %x (owner %x, parent %x)\n", h, owner, args[2]);
    if (!h) return;
    g_screen = h, g_owner = owner;
    g_previous = MEM32(SHELL_CURRENT_VA);
    /* The game fills a screen's lists before its set-up gives them their own drawing and handling. */
    fill_list(hle_dialog_item(h, LIST_ID));
    uint32_t keep_ecx = g_ecx, keep_edx = g_edx;
    g_ecx = h, g_edx = LAYOUT_ID;
    hle_call_guest(SCREEN_SETUP_VA, 0, NULL);
    g_ecx = keep_ecx, g_edx = keep_edx;
    uint32_t zero = 0;
    hle_call_guest(hle_resolve("ShowWindow"), 2, (uint32_t[]){ owner, zero });   /* ours covers the screen: hide the one under it */
    hle_send(h, 0x04A9u, 0, 1);   /* what the game's own screen loop sends a screen as it starts */
}

static void close_now(void) {
    uint32_t h = g_screen;
    g_screen = 0, g_close_request = 0;
    if (h && hle_is_window(h)) hle_call_guest(hle_resolve("DestroyWindow"), 1, &h);
    if (g_owner && hle_is_window(g_owner)) hle_call_guest(hle_resolve("ShowWindow"), 2, (uint32_t[]){ g_owner, 5 });
    MEM32(SHELL_CURRENT_VA) = g_previous;   /* the set-up made ours the current screen */
    fprintf(stderr, "[finder] closed\n");
}

void web_finder_screen_pump(void) {
    if (g_open_request) g_open_request = 0, open_now();
    if (g_close_request) close_now();
}
#endif
