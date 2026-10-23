/* The same battlefield rules as the Windows presenter, on the game's thread.
 * The browser's input ring latches physical buttons before win32hle sees them. */
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include "win32hle.h"
#include "recomp_target.h"

#define WM_MOUSEMOVE 0x0200u
#define WM_LBUTTONDOWN 0x0201u
#define WM_LBUTTONUP 0x0202u
#define WM_RBUTTONDOWN 0x0204u
#define WM_RBUTTONUP 0x0205u
#define MK_LBUTTON 1
#define MK_RBUTTON 2
typedef int32_t modern_int_t;
typedef struct { int x, y; } modern_point_t;
#include "modern_controls_state.h"

static int g_buttons, g_shift, g_right_as_left, g_swap;
static unsigned g_trace_count;
void web_modern_trace(const char *stage, uint32_t a, uint32_t b, uint32_t c) {
    const char *enabled = getenv("RA2_MODERN_TRACE");
    if (enabled && *enabled && g_trace_count++ < 100)
        fprintf(stderr, "[modern] %s %08X %08X %08X\n", stage, a, b, c);
}
static modern_point_t g_cursor, g_last_click;
static uint32_t g_last_click_at;
static modern_int_t modern_compare_exchange(volatile modern_int_t *p, modern_int_t v, modern_int_t old) {
    modern_int_t before = *p; if (before == old) *p = v; return before;
}
static modern_int_t modern_exchange(volatile modern_int_t *p, modern_int_t v) {
    modern_int_t before = *p; *p = v; return before;
}
static int modern_cursor(modern_point_t *p) { *p = g_cursor; return 1; }
static int modern_drag_x(void) { return 4; }
static int modern_drag_y(void) { return 4; }
static uint32_t modern_ticks(void) { return hle_ticks_ms(); }
static uint32_t modern_double_time(void) { return 500; }
static int input_live_button_state(void) { return g_buttons; }
static void sync_buttons(void) {
    int left = !!(g_buttons & MK_LBUTTON), right = !!(g_buttons & MK_RBUTTON);
    if (g_swap) { int tmp = left; left = right; right = tmp; }
    else if (g_right_as_left) { left = left || right; right = 0; }
    hle_input_key_state(1, left);
    hle_input_key_state(2, right);
}
static void input_live_map_right_to_left(int on) { g_right_as_left = on; sync_buttons(); }
static void input_live_swap_left_right(int on) { g_swap = on; sync_buttons(); }

#include "modern_controls.inc"

void web_modern_configure(int on) {
    g_modern_controls = on != 0;
    g_right_as_left = g_swap = 0;
    g_modern_right_gesture = g_modern_right_pending = g_modern_right_drag = 0;
    sync_buttons();
}
void web_modern_key(int down, uint32_t vk) { if (vk == 0x10) g_shift = down; }
void web_modern_pointer(uint32_t message, int x, int y) {
    g_cursor.x = x; g_cursor.y = y;
    if (message == WM_LBUTTONDOWN) {
        g_buttons |= MK_LBUTTON;
        g_modern_shift_box_select = g_modern_controls && g_shift;
        g_modern_shift_box_dragged = 0;
        g_modern_left_press = g_cursor;
        uint32_t now = modern_ticks();
        if (g_modern_controls && g_last_click_at && now - g_last_click_at <= modern_double_time() &&
            abs(x - g_last_click.x) < 4 && abs(y - g_last_click.y) < 4) {
            g_modern_left_double_click_at = (modern_int_t)now;
            g_modern_left_double_click_shift = g_shift;
            g_last_click_at = 0;
        } else { g_last_click_at = now; g_last_click = g_cursor; }
    } else if (message == WM_LBUTTONUP) {
        g_buttons &= ~MK_LBUTTON;
        if (g_modern_controls && g_shift) g_modern_shift_box_select = 1;
    } else if (message == WM_RBUTTONDOWN) g_buttons |= MK_RBUTTON;
    else if (message == WM_RBUTTONUP) g_buttons &= ~MK_RBUTTON;
    else if (message == WM_MOUSEMOVE && g_modern_controls && (g_buttons & MK_LBUTTON)) {
        if (g_shift) g_modern_shift_box_select = 1;
        if (abs(x - g_modern_left_press.x) >= 4 || abs(y - g_modern_left_press.y) >= 4)
            g_modern_shift_box_dragged = 1;
    }
    if (!g_buttons) g_swap = 0;
}
