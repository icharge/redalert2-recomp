#pragma once

/* Remaster setting: the start-up order of the boot/loading screen and the
 * animated logo. Boot screen first is Red Alert 2's stock order; logo first is
 * Yuri's Revenge's. Both editions support both orders at run time. */
int ra2_startup_logo_first(void);
void ra2_startup_set_logo_first(int on);

/* The boot screen plays at most once per start-up: Red Alert 2 has two paths
 * to it (early, and after the logo when logo-first is selected). */
int ra2_startup_take_boot_screen(void);
