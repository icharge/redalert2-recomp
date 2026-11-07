/* The map search's rules (map_match.h). No game state here: map_match_selftest.c tests it alone. */
#include "map_match.h"

#include <stdint.h>
#include <stdio.h>
#include <string.h>

void ra2_map_query(char *out, size_t size, const char *utf8) {
    size_t n = 0;
    int space = 1;   /* no space at the start, none doubled */
    const unsigned char *p = (const unsigned char *)(utf8 ? utf8 : "");
    if (!size) return;
    while (*p && n + 1 < size) {
        uint32_t c = *p++;
        if (c >= 0xC0) {   /* a UTF-8 sequence: its code point */
            int more = c >= 0xF0 ? 3 : c >= 0xE0 ? 2 : 1;
            c &= 0x3Fu >> more;
            while (more-- && (*p & 0xC0) == 0x80) c = c << 6 | (*p++ & 0x3Fu);
        }
        unsigned char b;
        if (c == ' ' || c == '\t') {
            if (space) continue;
            b = ' ', space = 1;
        } else {
            b = c < 0x80 ? (unsigned char)(c >= 'A' && c <= 'Z' ? c + 32 : c)
                : c >= 0x0E01 && c <= 0x0E5B ? (unsigned char)(0xA1 + (c - 0x0E01))   /* Thai, as CP874 */
                : '?';
            space = 0;
        }
        out[n++] = (char)b;
    }
    if (n && out[n - 1] == ' ') n--;
    out[n] = 0;
}

/* The players a name admits, from its last brackets: "(3)" or "(2-4)". 0 when it says nothing. */
static int player_range(const char *name, int *lo, int *hi) {
    const char *open = strrchr(name, '(');
    if (!open) return 0;
    int a, b;
    char close;
    if (sscanf(open, "(%d-%d%c", &a, &b, &close) == 3 && close == ')') return *lo = a, *hi = b, 1;
    if (sscanf(open, "(%d%c", &a, &close) == 2 && close == ')') return *lo = *hi = a, 1;
    return 0;
}

int ra2_map_matches(const char *name, const char *query, int players) {
    char lower[256], word[128];
    size_t n = 0;
    for (; name[n] && n + 1 < sizeof lower; n++) lower[n] = name[n] >= 'A' && name[n] <= 'Z' ? (char)(name[n] + 32) : name[n];
    lower[n] = 0;
    for (const char *q = query; *q;) {
        size_t len = strcspn(q, " ");
        if (len >= sizeof word) len = sizeof word - 1;
        memcpy(word, q, len), word[len] = 0;
        if (len && !strstr(lower, word)) return 0;
        q += strcspn(q, " ");
        while (*q == ' ') q++;
    }
    if (players <= 0) return 1;
    int lo, hi;
    return player_range(name, &lo, &hi) && lo <= players && players <= hi;
}
