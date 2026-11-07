/* The map search's rules (map_search.c): which of the game's map list items a search keeps. */
#pragma once
#include <stddef.h>

/* The search box's text (the game's bytes: CP874, Thai at 0xA1..0xFB) as a query: ASCII in lower
 * case, words one space apart. */
void ra2_map_query(char *out, size_t size, const char *text);

/* Whether a map list item ("Lake Blitzen (2-4)") is kept: every word of the query somewhere in it,
 * in any case, and, when players > 0, its "(n)" or "(a-b)" admitting that many players. */
int ra2_map_matches(const char *name, const char *query, int players);

/* Take a player count out of a query: a word that is a number from 1 to 8. Returns it, or 0. */
int ra2_map_players(char *query);
