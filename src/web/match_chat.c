/* The page's match chat panel (docs/web/match-chat.md).
 *
 * Every row of the game's message list (mission text, a player defeated, pages) reaches the page as a
 * matchMessage event from web_match_message, at Add_Message's start; a row with a sender's name is
 * player chat and is left to web_match_chat, which knows more about it.
 *
 * Shown: run_lift.py match_chat_patches calls web_match_chat after the game adds a player's line to
 * its message list (a line from another player, or the player's own echo); this turns the packet
 * buffer into a matchChat event. The text is the game's UTF-16 units as they are (Thai is Windows-874
 * bytes widened to U+00A1..U+00FB); the page reads them with the player's Thai font setting.
 *
 * Sent: the page queues a line (ra2_match_chat_send in presenter.c, through the input ring); the key
 * pre-hook's patch takes it with web_match_chat_take, on the game's thread, into the message list's
 * overflow chunk, and the game sends it as its own. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "web_api.h"
#include "win32hle.h"

#define MAX_UNITS 111            /* the packet's text: 111 units and a NUL (more would overwrite the colour) */
#define MAX_LINES 4
#define STALE_MS 3000u           /* a line the game did not take (not in a LAN or online match) is dropped */

#define PACKET_NAME 0x04u
#define PACKET_NAME_BYTES 20
#define PACKET_TEXT 0x30u
#define PACKET_COLOUR 0x110u

typedef struct {
    uint16_t units[MAX_UNITS + 1];
    int length;
    uint32_t target;             /* 1 listeners, 2 allies, 3 all */
    uint32_t at;
} queued_line;

/* Both sides run on the game's thread: the input ring's drain and the lifted pre-hook. */
static queued_line g_lines[MAX_LINES];
static int g_count;
static queued_line g_building;

/* One unit of the line the page is sending. */
void web_match_chat_unit(uint32_t unit) {
    if (unit && g_building.length < MAX_UNITS) g_building.units[g_building.length++] = (uint16_t)unit;
}

/* The line is whole: queue it for the game, to the target (1 listeners, 2 allies, 3 all). */
void web_match_chat_end(uint32_t target) {
    queued_line line = g_building;
    memset(&g_building, 0, sizeof g_building);
    if (!line.length || g_count == MAX_LINES) return;
    line.units[line.length] = 0;
    line.target = target >= 1 && target <= 3 ? target : 3;
    line.at = hle_ticks_ms();
    g_lines[g_count++] = line;
}

/* Whether the page was told chat can be sent (a LAN or online match runs), and when the pre-hook last
 * ran in one. */
static int g_told_ready;
static uint32_t g_ready_at;

static void tell_ready(int ready) {
    if (ready == g_told_ready) return;
    g_told_ready = ready;
    web_event_json(ready ? "{\"e\":\"matchChatReady\",\"on\":true}" : "{\"e\":\"matchChatReady\",\"on\":false}");
}

/* The presenter's pump: the pre-hook stopped running in a LAN or online match (the match ended). */
void web_match_chat_pump(void) {
    if (g_told_ready && hle_ticks_ms() - g_ready_at > 1500u) {
        tell_ready(0);
        g_count = 0;
    }
}

/* The key pre-hook, each frame (GameMode, the overflow chunk, the chat target dword): in a LAN (3) or
 * online (4) match, the next queued line into the overflow chunk and its target into the dword; 0 with
 * nothing queued, or in any other mode. */
int web_match_chat_take(uint32_t mode, uint32_t chunk, uint32_t target) {
    if (mode != 3u && mode != 4u) return 0;
    uint32_t now = hle_ticks_ms();
    g_ready_at = now;
    tell_ready(1);
    while (g_count && now - g_lines[0].at > STALE_MS) {
        memmove(g_lines, g_lines + 1, (size_t)(g_count - 1) * sizeof g_lines[0]);
        g_count--;
    }
    if (!g_count) return 0;
    /* the length and target show what the panel handed on; the text itself stays out of the log */
    fprintf(stderr, "[match chat] sending a line (%d units) to target %u, mode %u\n", g_lines[0].length,
            g_lines[0].target, mode);
    memcpy((void *)(uintptr_t)chunk, g_lines[0].units, (size_t)(g_lines[0].length + 1) * sizeof(uint16_t));
    *(uint32_t *)(uintptr_t)target = g_lines[0].target;
    memmove(g_lines, g_lines + 1, (size_t)(g_count - 1) * sizeof g_lines[0]);
    g_count--;
    return 1;
}

/* A JSON string of units: ASCII as it is, the rest as \uXXXX. */
static size_t json_units(char *out, size_t n, const uint16_t *units, size_t count) {
    size_t k = 0;
    for (size_t i = 0; i < count && units[i] && k + 8 < n; i++) {
        uint16_t u = units[i];
        if (u == '"' || u == '\\') out[k++] = '\\', out[k++] = (char)u;
        else if (u >= 0x20 && u < 0x7F) out[k++] = (char)u;
        else k += (size_t)snprintf(out + k, n - k, "\\u%04x", u);
    }
    out[k] = 0;
    return k;
}

/* After the game added a player's line: the packet buffer, and the chat target for the own echo
 * (0 for a line from another player). */
void web_match_chat(uint32_t packet, uint32_t target) {
    const uint8_t *bytes = (const uint8_t *)(uintptr_t)(packet + PACKET_NAME);
    uint16_t name[PACKET_NAME_BYTES + 1];
    int length = 0;
    while (length < PACKET_NAME_BYTES && bytes[length]) name[length] = bytes[length], length++;
    name[length] = 0;
    uint16_t text[MAX_UNITS + 1];
    memcpy(text, (const void *)(uintptr_t)(packet + PACKET_TEXT), MAX_UNITS * sizeof(uint16_t));
    text[MAX_UNITS] = 0;
    int32_t colour = *(const int32_t *)(uintptr_t)(packet + PACKET_COLOUR);
    char name_json[PACKET_NAME_BYTES * 6 + 1], text_json[MAX_UNITS * 6 + 1], event[1024];
    json_units(name_json, sizeof name_json, name, PACKET_NAME_BYTES);
    json_units(text_json, sizeof text_json, text, MAX_UNITS);
    snprintf(event, sizeof event, "{\"e\":\"matchChat\",\"name\":\"%s\",\"text\":\"%s\",\"colour\":%d,\"own\":%s,\"to\":%u}",
             name_json, text_json, (int)colour, target ? "true" : "false", target);
    fprintf(stderr, "[match chat] %s line (colour %d, target %u)\n", target ? "own" : "a player's", (int)colour, target);
    web_event_json(event);
}

/* Add_Message's start: a row for the message list. Rows with a name (player chat) are web_match_chat's. */
void web_match_message(uint32_t name, uint32_t text, uint32_t scheme, uint32_t style) {
    if (name || !text) return;
    const uint16_t *units = (const uint16_t *)(uintptr_t)text;
    if (!units[0]) return;
    char text_json[0xA2 * 6 + 1], event[1200];
    json_units(text_json, sizeof text_json, units, 0xA1);   /* a row holds 161 units */
    snprintf(event, sizeof event, "{\"e\":\"matchMessage\",\"text\":\"%s\",\"scheme\":%d,\"style\":%u}",
             text_json, (int)scheme, style);
    web_event_json(event);
}

/* The pre-hook, after one of the game's chat keys set the chat target (1 the players ticked under
 * Chat in Diplomacy, 2 allies, 3 everyone): in a LAN or online match where the page's panel listens,
 * the panel opens its line to that target and the game opens none (1); otherwise 0, and the game
 * opens its own line. */
int web_match_chat_open(uint32_t mode, uint32_t target) {
    if ((mode != 3u && mode != 4u) || !g_told_ready || target < 1u || target > 3u) return 0;
    char event[48];
    snprintf(event, sizeof event, "{\"e\":\"matchChatOpen\",\"to\":%u}", target);
    web_event_json(event);
    return 1;
}
