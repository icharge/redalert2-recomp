/*
 * Self-test for map_box.c, the map search box's text as the game's box holds it:
 *
 *   emcc src/web/map_box_selftest.c src/web/map_box.c -sENVIRONMENT=node -sEXIT_RUNTIME=1 \
 *       -o build-web/map-box-selftest.js
 *   node build-web/map-box-selftest.js
 */
#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "map_box.h"

#define WM_KEYDOWN 0x0100u
#define WM_CHAR 0x0102u
#define WM_LBUTTONDOWN 0x0201u

static int type(ra2_map_box *b, const char *s) {
    int changed = 0;
    for (; *s; s++) changed |= ra2_map_box_take(b, WM_CHAR, (unsigned char)*s);
    return changed;
}
static int key(ra2_map_box *b, unsigned vk) { return ra2_map_box_take(b, WM_KEYDOWN, vk); }

int main(void) {
    ra2_map_box b = { 0 };

    /* characters go in at the caret; Backspace (a WM_CHAR 8) takes the one before it */
    assert(type(&b, "lake") && !strcmp(b.text, "lake") && b.caret == 4);
    assert(ra2_map_box_take(&b, WM_CHAR, 8) && !strcmp(b.text, "lak") && b.caret == 3);

    /* the keys the game's box moves its caret with, as it does (checked in the game) */
    assert(!key(&b, 0x24) && b.caret == 0);                       /* Home */
    assert(type(&b, "x") && !strcmp(b.text, "xlak"));
    assert(!key(&b, 0x23) && b.caret == 4);                       /* End */
    assert(!key(&b, 0x25) && !key(&b, 0x25) && b.caret == 2);     /* Left, Left */
    assert(!key(&b, 0x27) && b.caret == 3);                       /* Right */
    assert(key(&b, 0x2E) && !strcmp(b.text, "xla") && b.caret == 3);   /* Delete */
    assert(!key(&b, 0x2E) && !strcmp(b.text, "xla"));             /* nothing after the caret */
    key(&b, 0x24);
    assert(!ra2_map_box_take(&b, WM_CHAR, 8) && !strcmp(b.text, "xla"));   /* nothing before it */

    /* a click in the box puts the caret at the end, as the game's box does */
    assert(!ra2_map_box_take(&b, WM_LBUTTONDOWN, 1) && b.caret == 3);

    /* key-downs that type (letters) change nothing: their WM_CHAR does; Tab and other
     * control characters aren't text */
    assert(!key(&b, 'Q') && !ra2_map_box_take(&b, WM_CHAR, 9) && !strcmp(b.text, "xla"));

    /* CP874 (Thai) bytes are text */
    assert(ra2_map_box_take(&b, WM_CHAR, 0xA1) && b.len == 4 && (unsigned char)b.text[3] == 0xA1);

    /* the game's box takes any length: past the buffer only the count is kept, until it empties */
    ra2_map_box l = { 0 };
    for (unsigned i = 0; i < sizeof l.text + 10; i++) type(&l, " ");
    assert(l.overflow && l.len == sizeof l.text + 10 && l.caret == l.len);
    while (l.len > 1) ra2_map_box_take(&l, WM_CHAR, 8);
    assert(l.overflow);                                           /* still unknown text */
    assert(ra2_map_box_take(&l, WM_CHAR, 8) && !l.overflow && l.len == 0 && !l.text[0]);
    assert(type(&l, "lake") && !strcmp(l.text, "lake"));

    puts("map_box_selftest: ok");
    return 0;
}
