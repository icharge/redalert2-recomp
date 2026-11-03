#include "startup_order.h"

static int g_logo_first;
static int g_boot_done;

int ra2_startup_logo_first(void) { return g_logo_first; }

void ra2_startup_set_logo_first(int on) {
    g_logo_first = on != 0;
    g_boot_done = 0;
}

int ra2_startup_take_boot_screen(void) {
    if (g_boot_done) return 0;
    return g_boot_done = 1;
}
