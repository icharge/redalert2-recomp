/* The map screens' templates with a search box added (map_dialog.h). No game state here:
 * map_dialog_selftest.c tests it alone. */
#include "map_dialog.h"

#include <string.h>

static uint16_t r16(const uint8_t *p) { uint16_t v; memcpy(&v, p, 2); return v; }
static uint32_t r32(const uint8_t *p) { uint32_t v; memcpy(&v, p, 4); return v; }
static void w16(uint8_t *p, uint16_t v) { memcpy(p, &v, 2); }
static void w32(uint8_t *p, uint32_t v) { memcpy(p, &v, 4); }

/* Past a sz_or_ord at p: 0xFFFF and an ordinal, or a UTF-16 string. 0 when it runs past `size`. */
static size_t skip_name(const uint8_t *t, size_t p, size_t size) {
    if (p + 2 > size) return 0;
    if (r16(t + p) == 0xFFFFu) return p + 4 <= size ? p + 4 : 0;
    while (p + 2 <= size && r16(t + p)) p += 2;
    return p + 2 <= size ? p + 2 : 0;
}

size_t ra2_map_dialog(const uint8_t *tmpl, size_t size, uint8_t *out, size_t cap, uint32_t list_id,
                      uint32_t edit_id, int edit_h) {
    if (size < 26 || r16(tmpl) != 1 || r16(tmpl + 2) != 0xFFFFu) return 0;
    unsigned count = r16(tmpl + 16);
    size_t p = 26;
    for (int k = 0; k < 3 && p; k++) p = skip_name(tmpl, p, size);   /* menu, class, title */
    if (p && (r32(tmpl + 12) & 0x40u)) p = skip_name(tmpl, p + 6, size);   /* DS_SETFONT */
    size_t list = 0;
    for (unsigned i = 0; i < count && p; i++) {
        p = (p + 3) & ~(size_t)3;
        if (p + 24 > size) return 0;
        if (r32(tmpl + p + 20) == list_id) list = p;
        p += 24;
        p = skip_name(tmpl, p, size);                     /* class */
        if (p) p = skip_name(tmpl, p, size);              /* title */
        if (p && p + 2 <= size) p += 2 + r16(tmpl + p);   /* creation data */
        else p = 0;
    }
    if (!p || p > size || !list) return 0;
    size_t end = (p + 3) & ~(size_t)3, item = 24 + 4 + 2 + 2;   /* the box: fixed part, class, title, data */
    if (end + item > cap) return 0;

    memcpy(out, tmpl, p);
    memset(out + p, 0, end - p);
    w16(out + 16, (uint16_t)(count + 1));
    int16_t x = (int16_t)r16(tmpl + list + 12), y = (int16_t)r16(tmpl + list + 14);
    int16_t cx = (int16_t)r16(tmpl + list + 16), cy = (int16_t)r16(tmpl + list + 18);
    int room = edit_h + 2;
    w16(out + list + 14, (uint16_t)(y + room));
    w16(out + list + 18, (uint16_t)(cy - room));

    uint8_t *b = out + end;
    w32(b, 0), w32(b + 4, 0), w32(b + 8, 0x50010080u);   /* WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL */
    w16(b + 12, (uint16_t)x), w16(b + 14, (uint16_t)y), w16(b + 16, (uint16_t)cx), w16(b + 18, (uint16_t)edit_h);
    w32(b + 20, edit_id);
    w16(b + 24, 0xFFFFu), w16(b + 26, 0x0081u);           /* Edit */
    w16(b + 28, 0);                                     /* no title */
    w16(b + 30, 0);                                     /* no creation data */
    return end + item;
}
