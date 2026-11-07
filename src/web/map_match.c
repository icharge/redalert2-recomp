/* The map search's rules (map_match.h). No game state here: map_match_selftest.c tests it alone. */
#include "map_match.h"

#include <stdio.h>
#include <string.h>

void ra2_map_query(char *out, size_t size, const char *text) {
    size_t n = 0;
    int space = 1;   /* no space at the start, none doubled */
    if (!size) return;
    for (const unsigned char *p = (const unsigned char *)(text ? text : ""); *p && n + 1 < size; p++) {
        if (*p == ' ' || *p == '\t') {
            if (!space) out[n++] = ' ', space = 1;
            continue;
        }
        out[n++] = (char)(*p >= 'A' && *p <= 'Z' ? *p + 32 : *p);
        space = 0;
    }
    if (n && out[n - 1] == ' ') n--;
    out[n] = 0;
}

int ra2_map_players(char *query) {
    int players = 0;
    char *w = query, *out = query;
    while (*w) {
        size_t len = strcspn(w, " ");
        if (len == 1 && w[0] >= '1' && w[0] <= '8' && !players) {
            players = w[0] - '0';
        } else {
            if (out != query) *out++ = ' ';
            memmove(out, w, len), out += len;
        }
        w += len;
        while (*w == ' ') w++;
    }
    *out = 0;
    return players;
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
