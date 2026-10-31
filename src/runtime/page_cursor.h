/* The game's in-match software cursor, captured for the page (or the presenter)
 * to draw on top of the picture (docs/web/cursor-layer.md).
 *
 * In a match the game draws its cursor itself: WWMouseClass blits the cursor
 * shape onto the primary surface from its own thread, so the cursor moves at
 * the game's frame rate plus presentation latency. The page already knows the
 * pointer position the moment the mouse moves (ra2_shared_t.pointer_x/y); with
 * the cursor's pixels and hot spot it can draw the same cursor at display rate.
 *
 * This module reads the game's own state, never a file: the pixels come from
 * the cursor as the game just drew it, so a mod that replaces MOUSE.SHA is
 * covered too. It is host-neutral; src/web/presenter.c publishes the sprite
 * into shared memory and src/runtime/present.c draws it in the native window.
 *
 * Nothing changes unless a host turns it on (ra2_page_cursor_on) and asks for
 * it (ra2_page_cursor_request): the game keeps drawing its own cursor the rest
 * of the time, which is the fallback if anything here cannot read the game.
 */
#pragma once
#include <stdint.h>

/* The largest cursor the page accepts, in pixels (the game's MOUSE.SHA frames
 * are 32x32; 64 leaves room for mods). */
#define RA2_PAGE_CURSOR_PX 64

typedef struct ra2_page_cursor {
    /* w * h * 4 RGBA pixels, top-down; alpha is 0 (transparent) or 255. */
    const uint8_t *rgba;
    int w, h;
    int hot_x, hot_y;
    /* Changes whenever the pixels, the size, the hot spot or the visibility
     * change. Read it before and after the pixels: an odd value means the
     * game thread is in the middle of an update. */
    uint32_t seq;
    int visible;
} ra2_page_cursor_t;

void ra2_page_cursor_on(int on);       /* the host enables the feature */
int  ra2_page_cursor_enabled(void);
/* The page (or the native presenter) draws the cursor itself: the game's own
 * blit is skipped while the request holds and a sprite has been captured. */
void ra2_page_cursor_request(int on);
int  ra2_page_cursor_requested(void);
/* From the lifted code, around the game's cursor blit (run_lift.py): suppress
 * says whether to skip it; drawn reports the cursor object after it. */
int  ra2_page_cursor_suppress(void);
void ra2_page_cursor_drawn(uint32_t mouse_object);
/* The sprite and its state, for the host's presenter. */
const ra2_page_cursor_t *ra2_page_cursor_state(void);
/* Clears the state once the game has stopped drawing the cursor (movies, the
 * end of a match, a locked screen): call each presenter frame. */
void ra2_page_cursor_tick(void);
/* One line of what was captured, for --debuglog / RA2_PAGE_CURSOR_DEBUG. */
void ra2_page_cursor_log(const char *why);
