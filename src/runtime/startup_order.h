#pragma once

/* Remaster setting: the start-up order of the boot/loading screen and the
 * animated logo. Boot screen first is Red Alert 2's stock order; logo first is
 * Yuri's Revenge's. Both editions support both orders at run time. */
int ra2_startup_logo_first(void);
void ra2_startup_set_logo_first(int on);

/* The boot screen plays at most once per start-up: Red Alert 2 has two paths
 * to it (early, and after the logo when logo-first is selected). */
int ra2_startup_take_boot_screen(void);

/* Start-up intro mode, shared by both editions:
 *   0  headless/test default: skip the start-up movies (the host truncates them)
 *   1  intro on: the game plays the intro after the logo
 *   2  intro off: the logo still plays, the game skips only the intro
 * The launcher passes --intro (1) unless Skip intro is on, then --no-intro (2).
 */
enum { RA2_INTRO_SKIP_MOVIES = 0, RA2_INTRO_ON = 1, RA2_INTRO_LOGO_ONLY = 2 };
void ra2_set_intro_mode(int mode);
int ra2_intro_enabled(void);
int ra2_startup_movies_skipped(void);

/* The start-up logo skip: true while the logo is playing and Escape or a left
 * click was pressed. The host implements the two queries. */
int ra2_startup_logo_skip(void);
int ra2_startup_skip_pressed(void);
int ra2_menu_seen(void);
