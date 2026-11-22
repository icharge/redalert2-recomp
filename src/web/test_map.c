/* FA2EX's Test Map: one skirmish on a staged map, with no menus (docs/web/test-map.md).
 *
 * `--test-map PATH` names a small INI the page wrote beside the map. run_lift.py test_map_patches
 * then jumps Select_Game past the main menu into its own Skirmish case and replaces the skirmish
 * dialog with src/runtime/test_map_fill.inc, which reads the values here. When the match ends the
 * end-of-scenario routine (score screen) is skipped and the page gets a testMapDone event.
 *
 * The file is plain `key=value` under `[Section]` headers; `;` starts a comment. Values are read
 * once, before the game runs, so the guest's chdir into the game folder does not matter. */
#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "web_api.h"

#define TM_MAX_KEYS 96

typedef struct { char section[16]; char key[24]; char value[96]; } tm_entry;

static tm_entry g_entries[TM_MAX_KEYS];
static int g_count;
static int g_pending;     /* set by a readable --test-map file; cleared once the dialog is skipped */
static int g_active;      /* a test-map match was started: its end goes to the page */

const char *ra2_test_map_str(const char *section, const char *key, const char *def);

static char *trim(char *s) {
    while (isspace((unsigned char)*s)) s++;
    char *e = s + strlen(s);
    while (e > s && isspace((unsigned char)e[-1])) *--e = 0;
    return s;
}

int ra2_test_map_load(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "[test-map] cannot read %s\n", path); return 0; }
    char line[256], section[16] = "";
    g_count = 0;
    while (fgets(line, sizeof line, f)) {
        char *semi = strchr(line, ';');
        if (semi) *semi = 0;
        char *s = trim(line);
        if (!*s) continue;
        if (*s == '[') {
            char *close = strchr(s, ']');
            if (close) { *close = 0; snprintf(section, sizeof section, "%s", trim(s + 1)); }
            continue;
        }
        char *eq = strchr(s, '=');
        if (!eq || g_count == TM_MAX_KEYS) continue;
        *eq = 0;
        tm_entry *e = &g_entries[g_count++];
        snprintf(e->section, sizeof e->section, "%s", section);
        snprintf(e->key, sizeof e->key, "%s", trim(s));
        snprintf(e->value, sizeof e->value, "%s", trim(eq + 1));
    }
    fclose(f);
    g_pending = 1;
    fprintf(stderr, "[test-map] %s: %d values, scenario %s\n", path, g_count,
            ra2_test_map_str("Settings", "Scenario", "?"));
    return 1;
}

const char *ra2_test_map_str(const char *section, const char *key, const char *def) {
    for (int i = 0; i < g_count; i++)
        if (!strcasecmp(g_entries[i].section, section) && !strcasecmp(g_entries[i].key, key))
            return g_entries[i].value;
    return def;
}

int ra2_test_map_int(const char *section, const char *key, int def) {
    const char *v = ra2_test_map_str(section, key, NULL);
    if (!v || !*v) return def;
    char *end;
    long n = strtol(v, &end, 0);
    return end == v ? def : (int)n;
}

int ra2_test_map_has(const char *section) {
    for (int i = 0; i < g_count; i++)
        if (!strcasecmp(g_entries[i].section, section)) return 1;
    return 0;
}

/* The fill's string work, kept host-side: whether a scenario list item is the staged map. */
int ra2_test_map_is_scenario(const char *item) {
    return !strcasecmp(item, ra2_test_map_str("Settings", "Scenario", ""));
}

/* The player's name, when the file gives one; 0 keeps the handle the game already has. The handle
 * string (0xA8B380, set by 0x735090) is 16-bit: each byte of the name widens to one unit. */
int ra2_test_map_name(char *dst, int cap) {
    const char *name = ra2_test_map_str("Settings", "Name", "");
    if (!*name) return 0;
    int n = 0;
    for (; name[n] && 2 * (n + 1) < cap; n++) {
        dst[2 * n] = name[n];
        dst[2 * n + 1] = 0;
    }
    dst[2 * n] = dst[2 * n + 1] = 0;
    return 1;
}

void ra2_test_map_note(int what, uint32_t n) {
    const char *map = ra2_test_map_str("Settings", "Scenario", "?");
    if (what == 1)
        fprintf(stderr, "[test-map] %s is not in the scenario list (%u maps); stage it as .yrm before start-up\n", map, n);
    else if (what == 2)
        fprintf(stderr, "[test-map] the game refused %s\n", map);
    else
        fprintf(stderr, "[test-map] %s is not offered under the default game mode; check [Basic] GameMode\n", map);
}

/* Patch site 1 (the menu loop's head) and 2 (the skirmish dialog's call). */
int ra2_test_map_pending(void) { return g_pending; }

/* The fill ran: the dialog is skipped once; a failed fill reports and leaves the menus to the game. */
void ra2_test_map_started(int ok) {
    g_pending = 0;
    g_active = ok;
    if (!ok) {
        fprintf(stderr, "[test-map] the test map could not be set up; showing the menus\n");
        web_event_json("{\"e\":\"testMapFailed\"}");
    } else {
        fprintf(stderr, "[test-map] starting the match\n");
    }
}

/* Patch site 3: in place of the end-of-scenario routine (the score screen). 1 when the call was
 * taken over, 0 to let the game run its own. */
int ra2_test_map_done(void) {
    if (!g_active) return 0;
    g_active = 0;
    fprintf(stderr, "[test-map] match over\n");
    web_event_json("{\"e\":\"testMapDone\"}");
    return 1;
}
