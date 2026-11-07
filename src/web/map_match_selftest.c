/*
 * Self-test for map_match.c, the map search's rules:
 *
 *   emcc src/web/map_match_selftest.c src/web/map_match.c \
 *       -sENVIRONMENT=node -sEXIT_RUNTIME=1 -o build-web/map-match-selftest.js
 *   node build-web/map-match-selftest.js
 */
#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "map_match.h"

static int matches(const char *name, const char *utf8, int players) {
    char query[128];
    ra2_map_query(query, sizeof query, utf8);
    return ra2_map_matches(name, query, players);
}

int main(void) {
    /* words, in any case and order, each somewhere in the name */
    assert(matches("Lake Blitzen (2-4)", "", 0));
    assert(matches("Lake Blitzen (2-4)", "lake", 0));
    assert(matches("Lake Blitzen (2-4)", "BLITZ", 0));
    assert(matches("Lake Blitzen (2-4)", "blitz lake", 0));
    assert(!matches("Lake Blitzen (2-4)", "lake war", 0));
    assert(matches("Little Big Lake (2)", "  big   lake ", 0));

    /* players: the name's "(n)" or "(a-b)" holds the count */
    assert(matches("Lake Blitzen (2-4)", "", 2));
    assert(matches("Lake Blitzen (2-4)", "", 4));
    assert(!matches("Lake Blitzen (2-4)", "", 5));
    assert(matches("Canyon Fodder (3)", "", 3));
    assert(!matches("Canyon Fodder (3)", "", 2));
    assert(matches("Cold War (2-3)", "war", 3));
    assert(!matches("Cold War (2-3)", "isle", 3));
    assert(!matches("A map with no count", "", 2));   /* no count: only when any number will do */
    assert(matches("A map with no count", "", 0));
    assert(matches("Brackets (in) the name (2-8)", "", 8));   /* the last brackets count */

    /* the box holds the game's bytes (CP874): Thai is matched as it is, only ASCII changes case */
    char thai[] = { (char)0xE1, (char)0xBC, (char)0xB9, ' ', '(', '2', ')', 0 };   /* "แผน (2)" */
    assert(matches(thai, "\xE1\xBC\xB9", 0));
    assert(!matches(thai, "\xA1", 0));                                             /* "ก" */

    /* a number on its own, 1 to 8, is a player count, taken out of the words */
    {
        char q[64];
        ra2_map_query(q, sizeof q, "lake 4");
        assert(ra2_map_players(q) == 4 && !strcmp(q, "lake"));
        ra2_map_query(q, sizeof q, "2 war");
        assert(ra2_map_players(q) == 2 && !strcmp(q, "war"));
        ra2_map_query(q, sizeof q, "defcon 6");
        assert(ra2_map_players(q) == 6 && !strcmp(q, "defcon"));
        ra2_map_query(q, sizeof q, "lake");
        assert(ra2_map_players(q) == 0 && !strcmp(q, "lake"));
        ra2_map_query(q, sizeof q, "lake 12 0");                     /* not a count: words */
        assert(ra2_map_players(q) == 0 && !strcmp(q, "lake 12 0"));
        ra2_map_query(q, sizeof q, "8");
        assert(ra2_map_players(q) == 8 && !strcmp(q, ""));
    }

    char query[8];
    ra2_map_query(query, sizeof query, "alongquery");                      /* cut, not overrun */
    assert(strlen(query) == sizeof query - 1);

    puts("map_match_selftest: ok");
    return 0;
}
