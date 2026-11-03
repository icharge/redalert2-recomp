#include "startup_order.h"

static int g_logo_first;
static int g_boot_done;
static int g_intro_mode = RA2_INTRO_SKIP_MOVIES;

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
