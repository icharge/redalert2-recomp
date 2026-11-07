/* The map search's rules (map_search.c): which of the game's map list items a search keeps. */
#pragma once
#include <stddef.h>

/* The page's search text (UTF-8) as the game's bytes (CP874: ASCII, Thai at 0xA1..0xFB), lower case,
 * words one space apart. Anything else becomes '?', which matches nothing. */
void ra2_map_query(char *out, size_t size, const char *utf8);

/* Whether a map list item ("Lake Blitzen (2-4)") is kept: every word of the query somewhere in it,
 * in any case, and, when players > 0, its "(n)" or "(a-b)" admitting that many players. */
int ra2_map_matches(const char *name, const char *query, int players);
