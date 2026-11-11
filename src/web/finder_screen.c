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
 * The list's rows are the game's own too, added the way its own screens add them (list_add below): its custom message
 * 0x4CD with a UTF-16 string, which makes the row's record and puts the text in the host's list, then LB_SETITEMDATA, which
 * the game's list keeps in that record. (LB_ADDSTRING sent to the game's list answers -1: its handler wants the custom
 * message; the host's own add, hle_list_add, leaves rows the game does not draw.)
 *
 * The page does the finding: the screen reads what the player typed (the game keeps it inside its own one-line control, so it
 * is followed from the keys that reach it, as map_search.c does), tells the page what to search (mapFinderSearch) or add
 * (mapFinderAdd), and shows what the page answers (ra2_finder_results, ra2_finder_note, ra2_finder_added).
 *
 * A picked row shows the map's preview where Customize Battle shows one (control 0x468): the screen tells the page which
 * map is picked (mapFinderPreview), the page puts the map's file in the game's folder and says so (ra2_finder_preview), and
 * the game's own preview code reads that file and draws it. */
#ifndef RA2_TARGET_GAME
#include <emscripten.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "finder_screen.h"
#include "map_box.h"
#include "recomp_types.h"
#include "web_api.h"
#include "win32hle.h"

#define SCREEN_SETUP_VA 0x00622820u   /* ecx = the dialog, edx = its resource id */
#define SHELL_MESSAGE_VA 0x00622B50u  /* every shell screen's procedure hands its messages here first: ecx = hwnd, edx = message, (wParam, lParam) */
#define SHELL_CURRENT_VA 0x00AC48A8u  /* the game's current shell dialog, set by the set-up */
#define GAME_INSTANCE_VA 0x00B732F0u
#define LAYOUT_ID 0x6Bu               /* the screen we are made as: Customize Battle (its buttons 0x6C5 and 0x583, its map list 1363) */

#define WS_VISIBLE 0x10000000u
#define WM_INITDIALOG 0x0110u
#define WM_COMMAND 0x0111u
#define WM_PAINT 0x000Fu

/* The ids are Customize Battle's (0x6B): its two buttons in their slots on the right panel (Use Map's and Random
 * Map's), its Cancel at the bottom, its map list, and its statics. */
enum { SEARCH_ID = 0x7FF0, LIST_ID = 1363, FIND_ID = 0x6C5, DOWNLOAD_ID = 0x583, CLOSE_ID = 0x5C0, TITLE_ID = 0x694, STATUS_ID = 0x695, PREVIEW_ID = 0x468 };

static uint8_t g_tmpl[2048];
static size_t g_at;
static uint32_t g_screen, g_previous, g_owner;
static volatile int g_open_request, g_close_request, g_search_request, g_add_request;
static int g_sliding;   /* a slide-out is running (the game's loop calls the pump) */

static void w16(uint16_t v) { memcpy(g_tmpl + g_at, &v, 2), g_at += 2; }
static void w32(uint32_t v) { memcpy(g_tmpl + g_at, &v, 4), g_at += 4; }
static void wstr(const char *s) { do w16((uint16_t)(unsigned char)*s); while (*s++); }
static void item_ex(uint32_t id, uint16_t cls, const char *text, int x, int y, int cx, int cy, uint32_t style, uint32_t ex) {
    while (g_at & 3) g_tmpl[g_at++] = 0;
    w32(0), w32(ex), w32(style);
    w16((uint16_t)x), w16((uint16_t)y), w16((uint16_t)cx), w16((uint16_t)cy);
    w32(id);
    w16(0xFFFF), w16(cls);
    wstr(text);
    w16(0);
}
static void item(uint32_t id, uint16_t cls, const char *text, int x, int y, int cx, int cy, uint32_t style) {
    item_ex(id, cls, text, x, y, cx, cy, style, 0);
}

/* A DLGTEMPLATEEX on the grid of the game's map screens (533 x 369 dialog units): the Edit and the list at the left, the
 * buttons on the right panel, a status line at the bottom. */
static void build_template(void) {
    g_at = 0;
    memset(g_tmpl, 0, sizeof g_tmpl);
    w16(1), w16(0xFFFF), w32(0), w32(0), w32(0x40000040u | WS_VISIBLE);
    w16(9), w16(0), w16(0), w16(533), w16(369);
    w16(0), w16(0), wstr("");
    w16(8), w16(400), g_tmpl[g_at++] = 0, g_tmpl[g_at++] = 1, wstr("Arial");
    item(TITLE_ID, 0x82, "GUI:ChooseMap", 425, 1, 108, 10, 0x50020001u);
    item_ex(PREVIEW_ID, 0x82, "", 428, 23, 96, 69, 0x50000004u, 0x20u);   /* Customize Battle's preview control, as its template has it */
    item(0xFFFFFFFFu, 0x82, "GUI:GameMap", 77, 60, 278, 10, 0x50000201u);
    item(SEARCH_ID, 0x81, "", 77, 78, 278, 12, 0x50010080u);
    item(LIST_ID, 0x83, "", 77, 92, 278, 197, 0x50000151u);
    item(STATUS_ID, 0x82, "GUI:Blank", 2, 355, 303, 12, 0x50000200u);
    item(FIND_ID, 0x80, "GUI:Search", 425, 122, 108, 23, 0x5000000Bu);
    item(DOWNLOAD_ID, 0x80, "GUI:Add", 425, 149, 108, 23, 0x5000000Bu);
    item(CLOSE_ID, 0x80, "GUI:Back", 425, 346, 108, 23, 0x5000000Bu);
}

static void preview_paint(uint32_t dialog);
static void preview_load(const char *file);
static void preview_clear(void);

/* The dialog procedure, as a host function:stdcall (hwnd, message, wParam, lParam) on the guest stack. */
static void finder_proc(void) {
    uint32_t hwnd = A32(0), message = A32(1), wParam = A32(2), lParam = A32(3), result = 0;
    {
        uint32_t args[2] = { wParam, lParam }, keep_ecx = g_ecx, keep_edx = g_edx;
        g_ecx = hwnd, g_edx = message;
        hle_call_guest(SHELL_MESSAGE_VA, 2, args);
        g_ecx = keep_ecx, g_edx = keep_edx;
    }
    if (message == WM_INITDIALOG) result = 1;
    else if (message == WM_COMMAND) {
        uint32_t id = wParam & 0xFFFFu, code = wParam >> 16;
        if (code == 0 && id == CLOSE_ID) g_close_request = 1, result = 1;
        else if (code == 0 && id == FIND_ID) g_search_request = 1, result = 1;
        else if (code == 0 && id == DOWNLOAD_ID) g_add_request = 1, result = 1;
        else if (code == 2 && id == LIST_ID) g_add_request = 1, result = 1;   /* LBN_DBLCLK */
    }
    else if (message == WM_PAINT) preview_paint(hwnd);   /* over what the common handler painted */
    RET(result, 4);
}

static const win32hle_shim g_shims[] = { { "ra2_finder_screen_proc", finder_proc }, { NULL, NULL } };

void web_finder_screen_open(void) { g_open_request = 1; }
int web_finder_screen_showing(void) { return g_screen != 0; }

/* ---- the rows ------------------------------------------------------------------------------------------------------
 * The game's own list takes a row as a message (0x4CD, wParam 0, lParam a UTF-16 string): it makes the row's record, adds the
 * string to the list and sets the record as the row's data; the data we want is then set with LB_SETITEMDATA, which the
 * game's list keeps in that record. */
#define LB_RESETCONTENT 0x0184u
#define LB_SETCURSEL 0x0186u
#define LB_GETCURSEL 0x0188u
#define LB_SETITEMDATA 0x019Au
#define LB_GETITEMDATA 0x0199u
#define GAME_LIST_ADD 0x04CDu

/* UTF-8 to UTF-16; a byte that is not UTF-8 stands for itself. */
static size_t widen(const char *s, uint16_t *out, size_t cap) {
    size_t n = 0;
    while (*s && n + 3 < cap) {
        unsigned char c = (unsigned char)*s;
        uint32_t cp = c;
        int more = c >= 0xF0 && c < 0xF8 ? 3 : c >= 0xE0 && c < 0xF0 ? 2 : c >= 0xC0 && c < 0xE0 ? 1 : 0;
        if (more) {
            uint32_t v = c & (0x3Fu >> more);
            int k = 1;
            for (; k <= more && ((unsigned char)s[k] & 0xC0) == 0x80; k++) v = (v << 6) | ((unsigned char)s[k] & 0x3Fu);
            if (k > more) cp = v, s += more;
        }
        s++;
        if (cp >= 0x10000) {
            out[n++] = (uint16_t)(0xD800 + ((cp - 0x10000) >> 10));
            out[n++] = (uint16_t)(0xDC00 + ((cp - 0x10000) & 0x3FF));
        } else out[n++] = (uint16_t)cp;
    }
    out[n] = 0;
    return n;
}

static int list_add(uint32_t list, const char *text, uint32_t data) {
    static uint16_t wide[512];
    widen(text, wide, sizeof wide / sizeof wide[0]);
    uint32_t at = hle_send(list, GAME_LIST_ADD, 0, (uint32_t)(uintptr_t)wide);
    if ((int)at >= 0) hle_send(list, LB_SETITEMDATA, at, data);
    return (int)at;
}

/* The finder's rows: the page's search results, and a note ("Searching...") that is not a map. A map row's list data is its
 * number + 1; a note's is 0. */
#define MAX_ROWS 64
#define SHA1_CHARS 40
typedef struct { char sha1[SHA1_CHARS + 1], name[96]; int unreviewed, state; } row_t;   /* state: 0 none, 1 busy, 2 added */
static row_t g_rows[MAX_ROWS];
static int g_nrows;
static char g_note[96];
static char g_picked[SHA1_CHARS + 1];   /* the picked row's map; "" when none is */

static void show_rows(void) {
    uint32_t list = g_screen ? hle_dialog_item(g_screen, LIST_ID) : 0;
    if (!list) return;
    hle_send(list, LB_RESETCONTENT, 0, 0);
    if (g_note[0]) list_add(list, g_note, 0);
    for (int i = 0; i < g_nrows; i++) {
        char text[160];
        snprintf(text, sizeof text, "%s%s%s", g_rows[i].name, g_rows[i].unreviewed ? " [unreviewed]" : "",
                 g_rows[i].state == 2 ? " - added" : g_rows[i].state == 1 ? " ..." : "");
        int at = list_add(list, text, (uint32_t)(i + 1));
        if (at >= 0 && g_picked[0] && !strcmp(g_rows[i].sha1, g_picked)) hle_send(list, LB_SETCURSEL, (uint32_t)at, 0);
    }
}

/* ---- from the page (any thread): what it sends waits for the pump ---------------------------------------------------- */
static char g_in_results[MAX_ROWS * 160], g_in_note[96], g_in_added[SHA1_CHARS + 1];
static char g_in_preview[SHA1_CHARS + 1], g_in_preview_file[32];
static volatile int g_in_flags;   /* 1 results, 2 note, 4 added, 8 add failed, 16 preview; the page writes, the pump takes */
static volatile int g_in_lock;

static void lock(void) { while (__atomic_exchange_n(&g_in_lock, 1, __ATOMIC_ACQUIRE)) {} }
static void unlock(void) { __atomic_store_n(&g_in_lock, 0, __ATOMIC_RELEASE); }

/* Lines of "sha1 TAB flags TAB name" (flags: u unreviewed, a already added); replaces the rows. */
EMSCRIPTEN_KEEPALIVE void ra2_finder_results(const char *tsv) {
    lock();
    snprintf(g_in_results, sizeof g_in_results, "%s", tsv ? tsv : "");
    g_in_flags |= 1;
    unlock();
}
/* One line shown in the list that is no map ("No maps found"); "" clears it. */
EMSCRIPTEN_KEEPALIVE void ra2_finder_note(const char *text) {
    lock();
    snprintf(g_in_note, sizeof g_in_note, "%s", text ? text : "");
    g_in_flags |= 2;
    unlock();
}
/* An add ended: the map is in (added 1), or is not. */
EMSCRIPTEN_KEEPALIVE void ra2_finder_added(const char *sha1, int added) {
    lock();
    snprintf(g_in_added, sizeof g_in_added, "%s", sha1 ? sha1 : "");
    g_in_flags |= added ? 4 : 8;
    unlock();
}
static void remove_game_file(const char *name) {
    char path[64];
    snprintf(path, sizeof path, "/game/%s", name);
    remove(path);
}
/* The map `sha1` is in the game's folder as `file`, for its preview. The file is ours to remove. */
EMSCRIPTEN_KEEPALIVE void ra2_finder_preview(const char *sha1, const char *file) {
    char dropped[sizeof g_in_preview_file] = "";
    lock();
    if (g_in_flags & 16) memcpy(dropped, g_in_preview_file, sizeof dropped);   /* one the pump never took */
    snprintf(g_in_preview, sizeof g_in_preview, "%s", sha1 ? sha1 : "");
    snprintf(g_in_preview_file, sizeof g_in_preview_file, "%s", file ? file : "");
    g_in_flags |= 16;
    unlock();
    if (dropped[0] && strcmp(dropped, g_in_preview_file)) remove_game_file(dropped);
}
/* A preview file the page sent that nothing will read (the screen closed). */
static void preview_drop_pending(void) {
    char file[sizeof g_in_preview_file] = "";
    lock();
    if (g_in_flags & 16) memcpy(file, g_in_preview_file, sizeof file), g_in_flags &= ~16;
    unlock();
    if (file[0]) remove_game_file(file);
}

static void take_results(const char *tsv) {
    g_nrows = 0;
    for (const char *p = tsv; *p && g_nrows < MAX_ROWS;) {
        const char *eol = strchr(p, '\n');
        size_t len = eol ? (size_t)(eol - p) : strlen(p);
        const char *t1 = memchr(p, '\t', len);
        const char *t2 = t1 ? memchr(t1 + 1, '\t', len - (size_t)(t1 + 1 - p)) : NULL;
        if (t1 && t2 && t1 - p == SHA1_CHARS) {
            row_t *r = &g_rows[g_nrows++];
            memset(r, 0, sizeof *r);
            memcpy(r->sha1, p, SHA1_CHARS);
            for (const char *f = t1 + 1; f < t2; f++) {
                if (*f == 'u') r->unreviewed = 1;
                if (*f == 'a') r->state = 2;
            }
            size_t nl = len - (size_t)(t2 + 1 - p);
            memcpy(r->name, t2 + 1, nl < sizeof r->name - 1 ? nl : sizeof r->name - 1);
        }
        p += len + (eol ? 1 : 0);
    }
}

static void take_from_page(void) {
    if (!__atomic_load_n(&g_in_flags, __ATOMIC_ACQUIRE)) return;
    static char results[sizeof g_in_results];
    char note[sizeof g_in_note], added[sizeof g_in_added], preview[sizeof g_in_preview], file[sizeof g_in_preview_file];
    lock();
    int flags = g_in_flags;
    g_in_flags = 0;
    memcpy(results, g_in_results, sizeof results);
    memcpy(note, g_in_note, sizeof note);
    memcpy(added, g_in_added, sizeof added);
    memcpy(preview, g_in_preview, sizeof preview);
    memcpy(file, g_in_preview_file, sizeof file);
    unlock();
    if (flags & 1) take_results(results);
    if (flags & 2) snprintf(g_note, sizeof g_note, "%s", note);
    if (flags & (4 | 8))
        for (int i = 0; i < g_nrows; i++)
            if (!strcmp(g_rows[i].sha1, added)) g_rows[i].state = flags & 4 ? 2 : 0;
    if (flags & ~16) show_rows();
    if ((flags & 16) && file[0]) {
        if (!strcmp(preview, g_picked)) preview_load(file);   /* still the picked map */
        remove_game_file(file);
    }
}

/* ---- to the page ------------------------------------------------------------------------------------------------------- */
static void send_event(const char *kind, const char *key, const char *value) {
    char event[600], esc[400];
    size_t n = 0;
    for (const unsigned char *s = (const unsigned char *)value; *s && n + 8 < sizeof esc; s++) {
        if (*s == '"' || *s == '\\') esc[n++] = '\\', esc[n++] = (char)*s;
        else if (*s < 0x20 || *s >= 0x7F) n += (size_t)snprintf(esc + n, 8, "\\u%04x", *s);
        else esc[n++] = (char)*s;
    }
    esc[n] = 0;
    snprintf(event, sizeof event, "{\"e\":\"%s\",\"%s\":\"%s\"}", kind, key, esc);
    web_event_json(event);
}

/* ---- the preview: the game's own, as Customize Battle shows one ------------------------------------------------------
 * The game's preview is an object of 4 bytes (its picture) that reads a map file by name (which also reads the map's start
 * positions into the scenario) and draws itself into the dialog's control 0x468. */
#define PREVIEW_INIT_VA 0x006406E0u    /* ecx = the object */
#define PREVIEW_FREE_VA 0x006406F0u    /* ecx = the object: lets its picture go */
#define PREVIEW_LOAD_VA 0x00641EE0u    /* ecx = the object, (file name) */
#define PREVIEW_DRAW_VA 0x00640710u    /* ecx = the object, (dialog) */
#define SCREEN_SHOW_VA 0x00607FD0u     /* ecx = the dialog: what a screen's WM_PAINT ends with */
#define GAME_NEW_VA 0x007C8E17u        /* cdecl (bytes) */
#define GAME_DELETE_VA 0x007C8B3Du     /* cdecl (pointer) */
#define MAP_SCREEN_PREVIEWED_VA 0x00AC0D30u   /* Customize Battle: the map its own preview was last loaded for */

static uint32_t g_preview;

static uint32_t call_this(uint32_t va, uint32_t self, int nargs, const uint32_t *args) {
    uint32_t keep = g_ecx;
    g_ecx = self;
    uint32_t r = hle_call_guest(va, nargs, args);
    g_ecx = keep;
    return r;
}

static void repaint(void) {
    if (g_screen) hle_call_guest(hle_resolve("InvalidateRect"), 3, (uint32_t[]){ g_screen, 0, 0 });
}

/* The game's teardown of a screen slides its buttons out first (0x7757E0 -> 0x622720 -> 0x608070), with the screen still
 * showing; the next screen then slides its own in. It is a loop that runs the game's pump until the slide is done, and
 * returns at once for a dialog that is not showing steady. We take that step alone: the dialog is not torn down. */
#define SLIDE_OUT_VA 0x00608070u   /* ecx = the dialog */

static void slide_out(uint32_t dialog) {
    if (!dialog || !hle_is_window(dialog)) return;
    g_sliding = 1;   /* the loop runs the pump: the pump must not start another change meanwhile */
    call_this(SLIDE_OUT_VA, dialog, 0, NULL);
    g_sliding = 0;
}

static void preview_clear(void) {
    if (!g_preview) return;
    call_this(PREVIEW_FREE_VA, g_preview, 0, NULL);
    hle_call_guest(GAME_DELETE_VA, 1, &g_preview);
    g_preview = 0;
    repaint();
}

static void preview_load(const char *file) {
    preview_clear();
    uint32_t bytes = 4, name = (uint32_t)(uintptr_t)file;
    uint32_t made = hle_call_guest(GAME_NEW_VA, 1, &bytes);
    if (!made) return;
    call_this(PREVIEW_INIT_VA, made, 0, NULL);
    g_preview = made;
    double began = emscripten_get_now();
    call_this(PREVIEW_LOAD_VA, g_preview, 1, &name);
    fprintf(stderr, "[finder] preview of %s: %s, %.0f ms\n", file, MEM32(g_preview) ? "a picture" : "none",
            emscripten_get_now() - began);
    repaint();
}

static void preview_paint(uint32_t dialog) {
    if (!g_preview || !MEM32(g_preview)) return;
    call_this(PREVIEW_DRAW_VA, g_preview, 1, &dialog);
    call_this(SCREEN_SHOW_VA, dialog, 0, NULL);
}

/* The picked row changed: its preview is asked of the page ("" stops it fetching). */
static void follow_pick(void) {
    uint32_t list = hle_dialog_item(g_screen, LIST_ID);
    const char *sha1 = "";
    int at = list ? (int)hle_send(list, LB_GETCURSEL, 0, 0) : -1;
    if (at >= 0) {
        uint32_t data = hle_send(list, LB_GETITEMDATA, (uint32_t)at, 0);
        if (data && data <= (uint32_t)g_nrows) sha1 = g_rows[data - 1].sha1;
    }
    if (!strcmp(sha1, g_picked)) return;
    snprintf(g_picked, sizeof g_picked, "%s", sha1);
    preview_clear();
    send_event("mapFinderPreview", "sha1", g_picked);
}

/* ---- the search text: what the game's own Edit holds (the same following of its keys as map_search.c) ------------------- */
static ra2_map_box g_text;
static uint32_t g_box;

static uint32_t search_box(void) {
    if (g_box && hle_is_window(g_box)) return g_box;
    uint32_t edit = hle_dialog_item(g_screen, SEARCH_ID);
    int l, t, r, b;
    if (!edit || !hle_window_screen_rect(edit, &l, &t, &r, &b)) return 0;
    uint32_t h = hle_window_at((l + r) / 2, (t + b) / 2, NULL, NULL);
    g_box = h && hle_window_parent(h) == g_screen ? h : 0;
    return g_box;
}

/* map_search.c's take hook passes on what the game takes from its queue. */
void web_finder_screen_take(uint32_t hwnd, uint32_t message, uint32_t wParam) {
    if (!g_screen || !hle_is_window(g_screen) || hwnd != search_box()) return;
    ra2_map_box_take(&g_text, message, wParam);
}

/* ---- the buttons ------------------------------------------------------------------------------------------------------- */
static void press_search(void) {
    if (g_text.overflow) return;
    snprintf(g_note, sizeof g_note, "Searching...");
    g_nrows = 0;
    show_rows();
    send_event("mapFinderSearch", "q", g_text.text);
}

static void press_add(void) {
    uint32_t list = hle_dialog_item(g_screen, LIST_ID);
    int at = (int)hle_send(list, LB_GETCURSEL, 0, 0);
    if (at < 0) return;
    uint32_t data = hle_send(list, LB_GETITEMDATA, (uint32_t)at, 0);
    if (!data || data > (uint32_t)g_nrows) return;
    row_t *r = &g_rows[data - 1];
    if (r->state) return;
    r->state = 1;
    show_rows();
    hle_send(list, LB_SETCURSEL, (uint32_t)at, 0);   /* the same row stays picked */
    send_event("mapFinderAdd", "sha1", r->sha1);
}

static void open_now(void) {
    static int registered;
    uint32_t owner = web_finder_screen_owner();
    if (!owner || g_screen) return;
    slide_out(owner);   /* Customize Battle's buttons slide out, as they do when it is left */
    if (!registered) win32hle_register(g_shims), registered = 1;
    build_template();
    uint32_t args[5] = { MEM32(GAME_INSTANCE_VA), (uint32_t)(uintptr_t)g_tmpl, hle_window_parent(owner),
                         hle_resolve("ra2_finder_screen_proc"), 0 };
    /* The template is ours. Unsaid, user32 names the dialog as the last one the game looked up (Customize Battle), and
     * map_search.c then takes this screen for a new map screen: it adds its search box and Find button to it, and loses
     * the real one under it. */
    hle_dialog_resource_forget();
    uint32_t h = hle_call_guest(hle_resolve("CreateDialogIndirectParamA"), 5, args);
    fprintf(stderr, "[finder] dialog %x (owner %x, parent %x)\n", h, owner, args[2]);
    if (!h) return;
    g_screen = h, g_owner = owner;
    g_previous = MEM32(SHELL_CURRENT_VA);
    memset(&g_text, 0, sizeof g_text);
    g_box = 0, g_nrows = 0, g_picked[0] = 0;
    uint32_t keep_ecx = g_ecx, keep_edx = g_edx;
    g_ecx = h, g_edx = LAYOUT_ID;
    hle_call_guest(SCREEN_SETUP_VA, 0, NULL);
    g_ecx = keep_ecx, g_edx = keep_edx;
    uint32_t zero = 0;
    hle_call_guest(hle_resolve("ShowWindow"), 2, (uint32_t[]){ owner, zero });   /* ours covers the screen: hide the one under it */
    hle_send(h, 0x04A9u, 0, 1);   /* what the game's own screen loop sends a screen as it starts */
    snprintf(g_note, sizeof g_note, "Type a map name, then press Search");
    show_rows();
}

static void close_now(void) {
    uint32_t h = g_screen;
    slide_out(h);   /* ours slides out while it still shows, then Customize Battle slides in */
    g_screen = 0, g_close_request = 0;
    preview_clear();
    if (g_picked[0]) g_picked[0] = 0, send_event("mapFinderPreview", "sha1", "");
    preview_drop_pending();
    MEM32(MAP_SCREEN_PREVIEWED_VA) = 0xFFFFFFFFu;   /* ours read another map's start positions: Customize Battle loads its own again */
    if (h && hle_is_window(h)) hle_call_guest(hle_resolve("DestroyWindow"), 1, &h);
    if (g_owner && hle_is_window(g_owner)) hle_call_guest(hle_resolve("ShowWindow"), 2, (uint32_t[]){ g_owner, 5 });
    MEM32(SHELL_CURRENT_VA) = g_previous;   /* the set-up made ours the current screen */
    fprintf(stderr, "[finder] closed\n");
}

void web_finder_screen_pump(void) {
    if (g_sliding) return;
    if (g_open_request) g_open_request = 0, open_now();
    if (!g_screen) {
        if (g_in_flags & 16) preview_drop_pending();   /* the page answered after the screen closed */
        return;
    }
    if (!hle_is_window(g_screen)) { g_screen = 0; return; }
    if (g_close_request) { close_now(); return; }
    take_from_page();
    if (g_search_request) g_search_request = 0, press_search();
    if (g_add_request) g_add_request = 0, press_add();
    follow_pick();
}
#endif
