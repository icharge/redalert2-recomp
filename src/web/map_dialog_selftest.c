/*
 * Self-test for map_dialog.c: the map screens' templates with a search box added.
 *
 *   emcc src/web/map_dialog_selftest.c src/web/map_dialog.c \
 *       -sENVIRONMENT=node -sEXIT_RUNTIME=1 -o build-web/map-dialog-selftest.js
 *   node build-web/map-dialog-selftest.js
 */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "map_dialog.h"

static uint8_t tmpl[512];
static size_t at;
static void w16(uint16_t v) { memcpy(tmpl + at, &v, 2), at += 2; }
static void w32(uint32_t v) { memcpy(tmpl + at, &v, 4), at += 4; }
static void wstr(const char *s) { do w16((uint16_t)(unsigned char)*s); while (*s++); }
static void item(uint32_t id, uint16_t cls, const char *text, int16_t x, int16_t y, int16_t cx, int16_t cy, uint32_t style) {
    while (at & 3) tmpl[at++] = 0;
    w32(0), w32(0), w32(style);
    w16((uint16_t)x), w16((uint16_t)y), w16((uint16_t)cx), w16((uint16_t)cy);
    w32(id);
    w16(0xFFFF), w16(cls);
    wstr(text);
    w16(0);
}
/* A DLGTEMPLATEEX like Customize Battle's: a font, a label, the map list, a button. */
static size_t game_template(void) {
    at = 0;
    w16(1), w16(0xFFFF), w32(0), w32(0), w32(0x40000040u);
    w16(3), w16(0), w16(0), w16(426), w16(295);
    w16(0), w16(0), wstr("");                       /* menu, class, title */
    w16(8), w16(400), tmpl[at++] = 0, tmpl[at++] = 1, wstr("Arial");
    item(0xFFFFFFFFu, 0x82, "GUI:GameMap", 168, 60, 130, 10, 0x50000201u);
    item(1363, 0x83, "", 168, 78, 130, 160, 0x50000151u);
    item(1733, 0x80, "GUI:UseMap", 318, 122, 108, 23, 0x5000000Bu);
    return at;
}
static uint16_t r16(const uint8_t *p) { uint16_t v; memcpy(&v, p, 2); return v; }
static uint32_t r32(const uint8_t *p) { uint32_t v; memcpy(&v, p, 4); return v; }
/* the controls of a template: id, class, x, y, cx, cy, style */
static int controls(const uint8_t *t, uint32_t out[][7]) {
    int n = r16(t + 16);
    size_t p = 26;
    for (int k = 0; k < 3; k++) p += r16(t + p) == 0xFFFF ? 4 : ({ size_t q = p; while (r16(t + q)) q += 2; q + 2 - p; });
    p += 6;
    while (r16(t + p)) p += 2;
    p += 2;
    for (int i = 0; i < n; i++) {
        p = (p + 3) & ~(size_t)3;
        out[i][6] = r32(t + p + 8);
        out[i][2] = r16(t + p + 12), out[i][3] = r16(t + p + 14), out[i][4] = r16(t + p + 16), out[i][5] = r16(t + p + 18);
        out[i][0] = r32(t + p + 20);
        p += 24;
        out[i][1] = r16(t + p + 2), p += 4;
        while (r16(t + p)) p += 2;
        p += 2;
        p += 2 + r16(t + p);
    }
    return n;
}

int main(void) {
    size_t n = game_template();
    uint8_t out[1024];
    size_t m = ra2_map_dialog(tmpl, n, out, sizeof out, 1363, 0x7FFEu, 12);
    assert(m > n);
    uint32_t c[8][7];
    assert(controls(out, c) == 4);
    /* the game's controls as they were, but the list: 14 down and 14 shorter */
    assert(c[0][0] == 0xFFFFFFFFu && c[0][3] == 60);
    assert(c[1][0] == 1363 && c[1][2] == 168 && c[1][3] == 78 + 14 && c[1][4] == 130 && c[1][5] == 160 - 14);
    assert(c[2][0] == 1733 && c[2][2] == 318);
    /* the search box: an Edit where the list's top was, as wide, 12 high, a tab stop */
    assert(c[3][0] == 0x7FFEu && c[3][1] == 0x81);
    assert(c[3][2] == 168 && c[3][3] == 78 && c[3][4] == 130 && c[3][5] == 12);
    assert(c[3][6] == 0x50010080u);
    /* the game's template is not touched */
    assert(r16(tmpl + 16) == 3);

    assert(ra2_map_dialog(tmpl, n, out, sizeof out, 9999, 0x7FFEu, 12) == 0); /* no such list */
    assert(ra2_map_dialog(tmpl, n, out, n, 1363, 0x7FFEu, 12) == 0);         /* no room */
    tmpl[0] = 0;                                                             /* not a DLGTEMPLATEEX */
    assert(ra2_map_dialog(tmpl, n, out, sizeof out, 1363, 0x7FFEu, 12) == 0);

    puts("map_dialog_selftest: ok");
    return 0;
}
