#include "startup_order.h"

static int g_logo_first;
static int g_boot_done;
static int g_intro_mode = RA2_INTRO_SKIP_MOVIES;
static int g_skip_was;

/* Escape or a left click skips the start-up logo. The host supplies the raw
 * key/mouse state; only the press edge counts, so a button already held when
 * the logo starts (the launcher's click) does not skip it. */
int ra2_startup_logo_skip(void) {
    if (ra2_menu_seen()) return 0;
    int pressed = ra2_startup_skip_pressed();
    int edge = pressed && !g_skip_was;
    g_skip_was = pressed;
    return edge;
}

int ra2_startup_logo_first(void) { return g_logo_first; }

void ra2_startup_set_logo_first(int on) {
    g_logo_first = on != 0;
    g_boot_done = 0;
}

int ra2_startup_take_boot_screen(void) {
    if (g_boot_done) return 0;
    return g_boot_done = 1;
}

void ra2_set_intro_mode(int mode) { g_intro_mode = mode; }
int ra2_intro_enabled(void) { return g_intro_mode == RA2_INTRO_ON; }
int ra2_startup_movies_skipped(void) { return g_intro_mode == RA2_INTRO_SKIP_MOVIES; }
