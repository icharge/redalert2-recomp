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

/* The largest cursor frame the page accepts, in pixels. MOUSE.SHA's header says
 * its biggest frame is 55x43 (YR and RA2); 64 is the next power of two, and
 * leaves a little room for mods. */
#define RA2_PAGE_CURSOR_PX 64
#define RA2_PALETTE_BYTES 768

typedef struct ra2_page_cursor {
    /* The frame: w * h palette indices, top-down; index 0 is transparent. */
    const uint8_t *indices;
    /* MOUSEPAL.PAL: 768 bytes of r, g, b, each 0..63 (the game scales by 4). */
    const uint8_t *palette;
    int w, h;                     /* the frame's size */
    int x, y;                     /* its place in the sheet */
    int sheet_w, sheet_h;         /* the SHP's largest frame */
    int hot_x, hot_y;             /* already resolved by the game */
    /* Changes whenever the frame, its place, the hot spot or the visibility
     * change. Read it before and after the indices: an odd value means the
     * game thread is in the middle of an update. */
    uint32_t seq;
    /* Changes when the palette is (re)loaded. */
    uint32_t palette_seq;
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
void ra2_page_cursor_this(uint32_t mouse_object);
void ra2_page_cursor_drawn(void);
/* From the MOUSEPAL.PAL load (run_lift.py page_cursor_palette_patches): 768 bytes. */
void ra2_page_cursor_palette(uint32_t bytes);
/* The sprite and its state, for the host's presenter. */
const ra2_page_cursor_t *ra2_page_cursor_state(void);
/* Clears the state once the game has stopped drawing the cursor (movies, the
 * end of a match, a locked screen): call each presenter frame. */
void ra2_page_cursor_tick(void);
/* One line of what was captured, for --debuglog / RA2_PAGE_CURSOR_DEBUG. */
void ra2_page_cursor_log(const char *why);
