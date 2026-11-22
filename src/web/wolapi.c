/*
 * Browser-side WOLAPI COM compatibility objects.
 *
 * The game checks these classes and their connection points before it opens
 * the original Westwood Online screens. This file serves the observed RA2/YR
 * interface identities in win32hle; it does not load WOLAPI.DLL. The network
 * method and event layouts follow the embedded WOLAPI 1.16 type library in
 * the user's installed Wolapi.dll. Network I/O stays on the browser thread;
 * this object pumps incoming protocol lines on the game's thread.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <stdio.h>
#include <time.h>
#include <dirent.h>
#include <emscripten.h>
#include <emscripten/heap.h>

#include "win32hle.h"
#include "wolapi.h"
#if defined(__has_include)
#if __has_include("recomp_target.h")
#include "recomp_target.h"
#endif
#endif

/* The lobby channel type each game builds its "Lob_<type>_<n>" names from. Red Alert 2
 * asks for the channel list with type 0 first and only accepts a lobby named Lob_33_*;
 * Yuri's Revenge sets its own 41 with a typed list request before it joins. */
#ifdef RA2_TARGET_GAME
#define WOL_LOBBY_TYPE 33
#else
#define WOL_LOBBY_TYPE 41
#endif

#define S_OK 0u
#define E_NOINTERFACE 0x80004002u
#define E_POINTER 0x80004003u
#define E_NOTIMPL 0x80004001u
#define E_FAIL 0x80004005u

/* x86 layouts from the embedded WOLAPI type library (pointer fields are 4B). */
typedef struct {
    int32_t gametype, chattype, timezone;
    float longitude, latitude;
    uint32_t next;
    char name[71], connlabel[5], conndata[128], login[10], password[10];
} wol_server;

typedef struct {
    int32_t type;
    uint32_t min_users, max_users, current_users, official, tournament, ingame, flags, reserved, ipaddr;
    int32_t latency, hidden;
    uint32_t next;
    char name[17], topic[81], location[65], key[9], ex_info[44];
} wol_channel;

typedef struct {
    uint32_t flags;
    int32_t group;
    uint32_t reserved, reserved2, reserved3, squad_id, ipaddr, squad_icon, next;
    char name[10], squad_name[41], squad_abbrev[13];
    int32_t locale, team;
} wol_user;

_Static_assert(sizeof(wol_server) == 248, "WOLAPI x86 Server layout");
_Static_assert(sizeof(wol_channel) == 268, "WOLAPI x86 Channel layout");
_Static_assert(sizeof(wol_user) == 108, "WOLAPI x86 User layout");
_Static_assert(sizeof(ra2_wolapi_session) == 504, "browser WOL session layout");

#define WOL_LINE_CAP 4096u
#define WOL_LINE_COUNT 128u
static char g_lines[WOL_LINE_COUNT][WOL_LINE_CAP];
static volatile uint32_t g_line_write, g_line_read;
static wol_server g_server;
static wol_server g_server_entry;
static wol_channel g_channels[64];
static wol_channel g_lobby, g_active_channel;
static wol_user g_users[32];
/* RA2Web's round trip to each member in ms, parallel to g_users (wol_user's layout is fixed); -1 = not measured. */
static int32_t g_user_ping[32];
static wol_user g_locale_user;
static uint32_t g_channel_count, g_user_count, g_channel_type = WOL_LOBBY_TYPE;
/* The name of the channel's user at `index` in the list the game was given (its player list keeps
 * that index as each row's data, chat_box.c), or NULL. */
const char *ra2_wolapi_user_name(uint32_t index) {
    return index < g_user_count && g_users[index].name[0] ? g_users[index].name : NULL;
}
/* The name (no '#') of the channel at `index` in the list the game was given (its games list keeps
 * that index as each row's data, chat_box.c), or NULL. */
const char *ra2_wolapi_channel_name(uint32_t index) {
    return index < g_channel_count && g_channels[index].name[0] ? g_channels[index].name : NULL;
}
/* The game publishes its map slot count in GAMEOPT, separately from the room
 * limit it later sends with MODE +l. Keep both so the lobby and server use the
 * smaller, actually playable capacity. */
static uint32_t g_map_player_slots, g_requested_player_limit;
/* True while g_channels holds the answer to a type-0 (lobby) channel list. */
static uint32_t g_channel_list_lobby;
/* Players in the lobby this client last joined, for the synthetic lobby entry
 * used when the server has no lobby row to report (e.g. the first player). */
static uint32_t g_lobby_users;
static uint32_t g_pending_server_list;
static uint32_t g_pending_logout;
static uint32_t g_pending_page_sent; /* RequestUnicodePage sent a page: OnPageSend from the pump */
/* The started room's own PART (see the PART handler): held until the game
 * leaves by itself, then delivered from the next pump. Reset at each STARTG. */
static uint32_t g_match_leave_requested, g_match_part_held, g_pending_match_part;
static uint32_t g_creating_channel;
static uint32_t g_joining_channel;
/* The game is owed a roster (OnUserList): after its own join, or after it asked
 * for one. RA2Web also sends every member the room's NAMES after anyone joins or
 * leaves; a stock server doesn't, and the game is told of those through
 * OnChannelJoin/OnChannelLeave. A guest's game adds each OnUserList entry to its
 * session players, so an extra roster there doubles them, and with three or more
 * players the guests' connection plans stop matching (the start fails). */
static uint32_t g_roster_wanted;
static uint32_t g_starting_game, g_connected, g_connection_pending;
static char g_login[64], g_password[64], g_nick[32], g_current_channel[48];
static struct { char nick[10], password[10]; } g_saved_nicks[11];
static char g_attribute_name[64], g_attribute_value[256];
/* The MOTD arrives (375/372.../376) before the bridge reports the connection;
 * hold it so the game sees OnConnection first, as it would from the real service. */
static char g_motd[1024];
static uint32_t g_motd_ready;
static uint32_t g_product_sku;
static ra2_wolapi_session g_session;

EMSCRIPTEN_KEEPALIVE const ra2_wolapi_session *ra2_wolapi_current_session(void) {
    return g_session.game_id[0] && strcmp(g_session.channel, g_current_channel) == 0 ? &g_session : NULL;
}
int ra2_wolapi_match_active(void) { return g_session.game_id[0] != 0; }
/* Locale enum from Wolapi.dll's type library, in its original numeric order. */
static const struct { const char *name, *code; } g_locales[] = {
    { "Unknown", "" }, { "Other", "" }, { "USA", "en-US" }, { "Canada", "en-CA" },
    { "United Kingdom", "en-GB" }, { "Germany", "de-DE" }, { "France", "fr-FR" },
    { "Spain", "es-ES" }, { "Netherlands", "nl-NL" }, { "Belgium", "" },
    { "Austria", "de-AT" }, { "Switzerland", "de-CH" }, { "Italy", "it-IT" },
    { "Denmark", "da-DK" }, { "Sweden", "sv-SE" }, { "Norway", "nb-NO" },
    { "Finland", "fi-FI" }, { "Israel", "he-IL" }, { "South Africa", "en-ZA" },
    { "Japan", "ja-JP" }, { "South Korea", "ko-KR" }, { "China", "zh-CN" },
    { "Singapore", "zh-SG" }, { "Taiwan", "zh-TW" }, { "Malaysia", "zh-MY" },
    { "Australia", "en-AU" }, { "New Zealand", "en-NZ" }, { "Brazil", "pt-BR" },
    { "Thailand", "th-TH" }, { "Argentina", "es-AR" }, { "Philippines", "en-PH" },
    { "Greece", "el-GR" }, { "Ireland", "en-IE" }, { "Poland", "pl-PL" },
    { "Portugal", "pt-PT" }, { "Mexico", "es-MX" }, { "Russia", "ru-RU" },
    { "Turkey", "tr-TR" },
};

EMSCRIPTEN_KEEPALIVE void ra2_wolapi_receive_line(const char *line) {
    if (!line) return;
    uint32_t write = __atomic_load_n(&g_line_write, __ATOMIC_RELAXED);
    uint32_t next = (write + 1u) % WOL_LINE_COUNT;
    if (next == __atomic_load_n(&g_line_read, __ATOMIC_ACQUIRE)) return;
    strncpy(g_lines[write], line, WOL_LINE_CAP - 1u);
    g_lines[write][WOL_LINE_CAP - 1u] = '\0';
    __atomic_store_n(&g_line_write, next, __ATOMIC_RELEASE);
}

static void browser_start(void) {
    MAIN_THREAD_EM_ASM({
        if (Module.ra2WolStart) Module.ra2WolStart(UTF8ToString($0), UTF8ToString($1));
        else if (Module.ra2WolReceiveLine) Module.ra2WolReceiveLine("@wolapi error WOL bridge is unavailable");
    }, g_login, g_password);
}

static void browser_send(const char *line) {
    MAIN_THREAD_EM_ASM({
        /* Game options are opaque bytes, not UTF-8 text. */
        var line = "";
        for (var at = $0; HEAPU8[at]; at++) line += String.fromCharCode(HEAPU8[at]);
        if (Module.ra2WolSend) Module.ra2WolSend(line);
        else if (Module.ra2WolReceiveLine) Module.ra2WolReceiveLine("@wolapi error WOL bridge is unavailable");
    }, line);
}

static void browser_stop(void) {
    MAIN_THREAD_EM_ASM({ if (Module.ra2WolStop) Module.ra2WolStop(); });
}

static void browser_send_unicode(const char *prefix, const uint16_t *text) {
    MAIN_THREAD_EM_ASM({
        var line = UTF8ToString($0);
        for (var at = $1 >> 1; HEAPU16[at]; at++) line += String.fromCharCode(HEAPU16[at]);
        if (Module.ra2WolSend) Module.ra2WolSend(line);
    }, prefix, text);
}

/* COM identities observed at GameMD.exe:0x785370. */
static const uint8_t CLSID_WOL_CHAT[16] = {
    0xf5,0xba,0xd3,0x4d,0x79,0x75,0xd1,0x11,0xb1,0xc6,0x00,0x60,0x97,0x17,0x65,0x56
};
static const uint8_t IID_WOL_CHAT[16] = {
    0xf4,0xba,0xd3,0x4d,0x79,0x75,0xd1,0x11,0xb1,0xc6,0x00,0x60,0x97,0x17,0x65,0x56
};
static const uint8_t IID_WOL_CHAT_EVENTS[16] = {
    0xf6,0xba,0xd3,0x4d,0x79,0x75,0xd1,0x11,0xb1,0xc6,0x00,0x60,0x97,0x17,0x65,0x56
};
static const uint8_t CLSID_WOL_CHANNEL[16] = {
    0xab,0xb0,0x32,0xb8,0xd3,0xa7,0xd1,0x11,0x97,0xc3,0x00,0x60,0x97,0x06,0xfa,0x0c
};
static const uint8_t IID_WOL_CHANNEL[16] = {
    0xaa,0xb0,0x32,0xb8,0xd3,0xa7,0xd1,0x11,0x97,0xc3,0x00,0x60,0x97,0x06,0xfa,0x0c
};
static const uint8_t IID_WOL_CHANNEL_EVENTS[16] = {
    0xac,0xb0,0x32,0xb8,0xd3,0xa7,0xd1,0x11,0x97,0xc3,0x00,0x60,0x97,0x06,0xfa,0x0c
};
static const uint8_t CLSID_WOL_PROFILE[16] = {
    0x06,0xa2,0x6e,0xbf,0x55,0x9e,0xd1,0x11,0x9d,0xc6,0x00,0x60,0x97,0xc5,0x43,0x21
};
static const uint8_t IID_WOL_PROFILE[16] = {
    0xeb,0xfc,0xf5,0x0b,0x03,0x9f,0xd1,0x11,0x9d,0xc7,0x00,0x60,0x97,0xc5,0x43,0x21
};
static const uint8_t IID_WOL_PROFILE_EVENTS[16] = {
    0x9d,0xe9,0x69,0x68,0xb4,0x9f,0xd1,0x11,0x9d,0xc8,0x00,0x60,0x97,0xc5,0x43,0x21
};
static const uint8_t IID_IConnectionPointContainer[16] = {
    0x84,0xb2,0x96,0xb1,0xb4,0xba,0x1a,0x10,0xb6,0x9c,0x00,0xaa,0x00,0x34,0x1d,0x07
};
static const uint8_t IID_IConnectionPoint[16] = {
    0x86,0xb2,0x96,0xb1,0xb4,0xba,0x1a,0x10,0xb6,0x9c,0x00,0xaa,0x00,0x34,0x1d,0x07
};

typedef struct wol_object wol_object;
struct wol_object {
    uint32_t chat;
    uint32_t container;
    uint32_t point;
    uint32_t sink;
    uint32_t cookie;
    const uint8_t *primary_iid;
    const uint8_t *event_iid;
};

static wol_object g_chat = { .primary_iid = IID_WOL_CHAT, .event_iid = IID_WOL_CHAT_EVENTS };
static wol_object g_channel = { .primary_iid = IID_WOL_CHANNEL, .event_iid = IID_WOL_CHANNEL_EVENTS };
static wol_object g_profile = { .primary_iid = IID_WOL_PROFILE, .event_iid = IID_WOL_PROFILE_EVENTS };
static uint32_t g_chat_vt, g_channel_vt, g_profile_vt, g_container_vt, g_point_vt;
/* Requests survive lobby return, but not a new match/login or sink replacement. */
static struct { uint32_t id, sink, generation; } g_reports[8];
static uint32_t g_report_id, g_report_generation;

static void invalidate_reports(void) {
    ++g_report_generation;
    memset(g_reports, 0, sizeof g_reports);
}

static void complete_report(uint32_t id, uint32_t status) {
    for (unsigned i = 0; i < 8; ++i) {
        if (g_reports[i].id != id || !id) continue;
        uint32_t sink = g_reports[i].sink;
        uint32_t generation = g_reports[i].generation;
        g_reports[i].id = 0;
        if (!sink || sink != g_channel.sink || generation != g_report_generation) return;
        uint32_t args[] = { sink, status };
        hle_call_guest(MEM32(MEM32(sink) + 5u * 4u), 2, args); /* INetUtilEvent::OnGameresSent */
        return;
    }
}

static wol_object *object_of(uint32_t self) { return (wol_object *)(uintptr_t)MEM32(self + 8); }

static uint32_t event_call(uint32_t ordinal, uint32_t count, const uint32_t *values) {
    uint32_t sink = g_chat.sink;
    if (!sink || ordinal >= 45) return E_FAIL;
    uint32_t args[8] = { sink };
    if (count > 7) return E_FAIL;
    for (uint32_t i = 0; i < count; i++) args[i + 1] = values[i];
    uint32_t method = MEM32(MEM32(sink) + 4u * (ordinal + 3u));
    return hle_call_guest(method, (int)count + 1, args);
}

static void copy_text(char *to, size_t capacity, const char *from) {
    if (!capacity) return;
    if (!from) from = "";
    strncpy(to, from, capacity - 1u);
    to[capacity - 1u] = '\0';
}

/* The launcher's sign-in (docs/wol/members-and-sso.md, task F5A-3). The page redeems
 * a launch ticket and gives the shim the game account's nick; the game then logs in as
 * that nick whatever the dialog sent, so the game and the server agree on who it is.
 * The page's main thread writes the staged copy and bumps the counter; the game thread
 * takes it at its next WolChat::GetNick or connection request. An empty nick ends it
 * (the server refused the held session) and the dialog's own login applies again.
 * The dialog's Nickname field is not filled from here: the game takes it from its own
 * wolinfo.ini / wolinfomd.ini ([DefaultPersona] LastValid=), not from WolChat::GetNick.
 *
 * Auto-login (LW-7b, docs/wol/handoff-wolapi.md): on entering Internet the game reads
 * [DefaultPersona] AutoLogin= from that file (the page sets it to the launch nick) and
 * looks the nick up through GetNick, slots 1 to 32 (never 0); on a match it connects
 * without the dialog. So the launch nick also goes into a saved-nick slot from 1 up,
 * with a placeholder password: the held session logs in, the password is never sent. */
static char g_launch_staged[32], g_launch_nick[32];
static uint32_t g_launch_staged_count, g_launch_taken_count;
static uint32_t g_launch_slot; /* the slot holding the launch nick, or 0 */
static const char g_launch_password[] = "launcher";

EMSCRIPTEN_KEEPALIVE void ra2_wolapi_set_launch_login(const char *nick) {
    copy_text(g_launch_staged, sizeof g_launch_staged, nick);
    __atomic_add_fetch(&g_launch_staged_count, 1u, __ATOMIC_RELEASE);
}

static void take_launch_login(void) {
    uint32_t count = __atomic_load_n(&g_launch_staged_count, __ATOMIC_ACQUIRE);
    if (count == g_launch_taken_count) return;
    g_launch_taken_count = count;
    copy_text(g_launch_nick, sizeof g_launch_nick, g_launch_staged);
    if (g_launch_slot) {
        memset(&g_saved_nicks[g_launch_slot], 0, sizeof g_saved_nicks[g_launch_slot]);
        g_launch_slot = 0;
    }
    /* A slot keeps 9 characters (decision 11 caps game account names there); a longer
     * nick could never match the persona, so the dialog shows as before. */
    if (!g_launch_nick[0] || strlen(g_launch_nick) >= sizeof g_saved_nicks[0].nick) return;
    uint32_t slot = 0;
    for (uint32_t i = 1; i < 11 && !slot; i++)
        if (!strcasecmp(g_saved_nicks[i].nick, g_launch_nick)) slot = i;
    for (uint32_t i = 1; i < 11 && !slot; i++)
        if (!g_saved_nicks[i].nick[0]) slot = i;
    if (!slot) return;
    /* A nick the player saved keeps its password; an empty one gets the placeholder. */
    if (!g_saved_nicks[slot].nick[0]) {
        copy_text(g_saved_nicks[slot].nick, sizeof g_saved_nicks[slot].nick, g_launch_nick);
        copy_text(g_saved_nicks[slot].password, sizeof g_saved_nicks[slot].password,
                  g_launch_password);
        g_launch_slot = slot;
    } else if (!g_saved_nicks[slot].password[0]) {
        copy_text(g_saved_nicks[slot].password, sizeof g_saved_nicks[slot].password,
                  g_launch_password);
    }
}

static void emit_server_list(void) {
    memset(&g_server, 0, sizeof g_server);
    g_server.gametype = (int32_t)g_product_sku;
    g_server.chattype = (int32_t)g_channel_type;
    copy_text(g_server.name, sizeof g_server.name, "-1:Automatic");
    copy_text(g_server.connlabel, sizeof g_server.connlabel, "IRC");
    copy_text(g_server.conndata, sizeof g_server.conndata, "TCP;127.0.0.1;9090");
    /* Both games reserve directory index zero; selectable servers start at one. */
    g_server_entry = g_server;
    /* The prefix before ':' is a WOL locale, used for automatic selection. */
    snprintf(g_server_entry.name, sizeof g_server_entry.name, "%u:RA2Web", g_product_sku & 0xffu);
    g_server.next = (uint32_t)(uintptr_t)&g_server_entry;
    uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)&g_server };
    event_call(0, 2, values); /* IChatEvent::OnServerList */
}

static void emit_connection(uint32_t result, const char *message) {
    uint32_t values[] = { result, (uint32_t)(uintptr_t)(message ? message : "") };
    event_call(3, 2, values); /* IChatEvent::OnConnection */
}

/* True when the second token of a server line is the given numeric reply. */
static int is_numeric_reply(const char *line, const char *code) {
    const char *space = strchr(line, ' ');
    return space && strncmp(space + 1, code, 3) == 0 && space[4] == ' ';
}

static void collect_motd(const char *line) {
    if (is_numeric_reply(line, "375")) {
        g_motd[0] = '\0';
        g_motd_ready = 0;
        return;
    }
    if (is_numeric_reply(line, "372")) {
        const char *text = strstr(line, " :");
        if (!text) return;
        text += 2;
        if (text[0] == '-' && text[1] == ' ') text += 2;
        size_t used = strlen(g_motd);
        if (used && used + 1 < sizeof g_motd) g_motd[used++] = '\n';
        copy_text(g_motd + used, sizeof g_motd - used, text);
        return;
    }
    if (is_numeric_reply(line, "376")) g_motd_ready = 1;
}

static void emit_channel_list(void) {
    if (g_channel_list_lobby) {
        g_channel_list_lobby = 0;
        /* RA2Web creates global lobbies on JOIN. If no lobby of this edition
         * exists yet it has nothing to report, but the native directory still
         * needs the configured lobby so the game can find and join it. */
        char own[24];
        snprintf(own, sizeof own, "Lob_%u_", (unsigned)WOL_LOBBY_TYPE);
        int have_own = 0;
        for (uint32_t i = 0; i < g_channel_count; i++)
            if (strncmp(g_channels[i].name, own, strlen(own)) == 0) have_own = 1;
        if (!have_own) {
            memset(&g_lobby, 0, sizeof g_lobby);
            snprintf(g_lobby.name, sizeof g_lobby.name, "Lob_%u_0", (unsigned)WOL_LOBBY_TYPE);
            copy_text(g_lobby.topic, sizeof g_lobby.topic, "RA2Web");
            g_lobby.max_users = 100;
            g_lobby.official = 1;
            g_lobby.current_users = g_lobby_users;
            if (g_channel_count == 0) {
                uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)&g_lobby };
                event_call(5, 2, values); /* IChatEvent::OnChannelList */
                return;
            }
            /* Only quick-match lobbies exist so far: list the configured lobby too. */
            if (g_channel_count < sizeof g_channels / sizeof g_channels[0])
                g_channels[g_channel_count++] = g_lobby;
        }
    }
    for (uint32_t i = 0; i < g_channel_count; i++)
        g_channels[i].next = i + 1 < g_channel_count ? (uint32_t)(uintptr_t)&g_channels[i + 1] : 0;
    uint32_t values[] = { S_OK, g_channel_count ? (uint32_t)(uintptr_t)&g_channels[0] : 0 };
    event_call(5, 2, values); /* IChatEvent::OnChannelList */
}

static wol_channel *current_channel(void);

/* The virtual addresses the WOL layer hands the game. A peer whose entry is
 * missing (or whose address is 0) makes the game send to the LAN broadcast
 * instead and the match sits on "connecting" until it times out, so the table
 * is worth having in the log. */
static void log_users(const char *tag) {
    fprintf(stderr, "[wol] users(%s) n=%u", tag, g_user_count);
    for (uint32_t i = 0; i < g_user_count; i++) {
        uint32_t a = g_users[i].ipaddr;
        fprintf(stderr, " %s=%u.%u.%u.%u%s", g_users[i].name,
                a & 0xFF, (a >> 8) & 0xFF, (a >> 16) & 0xFF, (a >> 24) & 0xFF,
                strcmp(g_users[i].name, g_nick) == 0 ? "*" : "");
    }
    fprintf(stderr, "\n");
}

static void emit_user_list(void) {
    for (uint32_t i = 0; i < g_user_count; i++)
        g_users[i].next = i + 1 < g_user_count ? (uint32_t)(uintptr_t)&g_users[i + 1] : 0;
    wol_channel *channel = current_channel();
    if (channel) {
        /* Keep the channel record the game sees in step with its roster; the
         * native channel list shows this count next to the channel name. */
        channel->current_users = g_user_count;
        if (g_current_channel[0] == '#' && strncmp(g_current_channel + 1, "Lob_", 4) == 0)
            g_lobby_users = g_user_count;
    }
    if (!g_roster_wanted) {
        log_users("refresh"); /* Addresses and pings only; the game already knows. */
        return;
    }
    g_roster_wanted = 0;
    uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)channel,
        g_user_count ? (uint32_t)(uintptr_t)&g_users[0] : 0 };
    event_call(12, 3, values); /* IChatEvent::OnUserList */
    log_users("list");
}

static wol_channel *current_channel(void) {
    if (!g_current_channel[0]) return NULL;
    /* WOLAPI names omit the IRC # prefix; keep the active channel outside LIST storage. */
    const char *name = g_current_channel + (g_current_channel[0] == '#');
    if (strcmp(g_active_channel.name, name) != 0) {
        memset(&g_active_channel, 0, sizeof g_active_channel);
        copy_text(g_active_channel.name, sizeof g_active_channel.name, name);
        g_active_channel.type = strncmp(name, "Lob_", 4) == 0 ? 0 : (int32_t)g_channel_type;
        g_active_channel.max_users = 8;
    }
    return &g_active_channel;
}

/* RA2Web treats room topics as opaque strings. Preserve the native compatibility
 * record separately from the human topic inside a versioned envelope. */
static int metadata_number(const char **text, uint32_t *value, char delimiter) {
    if (**text < '0' || **text > '9') return 0;
    char *end;
    unsigned long long number = strtoull(*text, &end, 10);
    if (number > UINT32_MAX || *end != delimiter) return 0;
    *value = (uint32_t)number;
    *text = end + 1;
    return 1;
}

static void read_channel_metadata(wol_channel *channel, const char *text) {
    channel->ex_info[0] = '\0';
    const char *info = NULL;
    uint32_t reserved = 0, min_users = 0, max_users = 0, flags = 0;
    int extended = strncmp(text, "WOLAPI2:", 8) == 0;
    if (extended) {
        info = text + 8;
        if (!metadata_number(&info, &reserved, ',') || !metadata_number(&info, &min_users, ',') ||
            !metadata_number(&info, &max_users, ',') || !metadata_number(&info, &flags, ';') ||
            max_users < 2 || max_users > 9 || min_users > max_users) info = NULL;
    } else if (strncmp(text, "WOLAPI1:", 8) == 0) info = text + 8;
    if (info) {
        const char *end = strstr(info, "::");
        if (end) {
            size_t length = (size_t)(end - info);
            if (length >= sizeof channel->ex_info) length = sizeof channel->ex_info - 1;
            memcpy(channel->ex_info, info, length);
            channel->ex_info[length] = '\0';
            if (extended) {
                channel->reserved = reserved;
                channel->min_users = min_users;
                channel->max_users = max_users;
                /* Keep the password/private mode supplied by RA2Web's LIST. */
                channel->flags = (channel->flags & 0x180u) | flags;
            }
            text = end + 2;
        }
    }
    copy_text(channel->topic, sizeof channel->topic, text);
}

static void send_channel_metadata(void) {
    wol_channel *channel = current_channel();
    if (!channel) return;
    char line[WOL_LINE_CAP];
    if (channel->ex_info[0])
        snprintf(line, sizeof line, "topic %s :WOLAPI2:%u,%u,%u,%u;%s::%s", g_current_channel,
            channel->reserved, channel->min_users, channel->max_users, channel->flags,
            channel->ex_info, channel->topic);
    else snprintf(line, sizeof line, "topic %s :%s", g_current_channel, channel->topic);
    browser_send(line);
}

/* The native GAMEOPT options part has a fixed prefix followed by scenario
 * fields. Field 12 is the selected map's player-slot count (for example 2 for
 * a two-player map); the later MODE +l value is only the room limit. */
static int game_options_player_slots(const char *options, uint32_t *slots) {
    if (!options || !slots) return 0;
    const char *end = strchr(options, ':');
    if (!end) return 0;
    const char *field = options;
    for (unsigned index = 0; index < 12; index++) {
        const char *comma = memchr(field, ',', (size_t)(end - field));
        if (!comma) return 0;
        field = comma + 1;
    }
    const char *comma = memchr(field, ',', (size_t)(end - field));
    if (!comma || comma == field) return 0;
    uint32_t value = 0;
    for (const char *p = field; p < comma; p++) {
        if (*p < '0' || *p > '9') return 0;
        value = value * 10u + (uint32_t)(*p - '0');
        if (value > 8) return 0;
    }
    if (value < 2) return 0;
    *slots = value;
    return 1;
}

/* The channel's ex-info ("%d,%d,%d,%d,%d,%s": version, hash, AI players, a human on the
 * observer row, an open observer row, scenario; YR 0x0077E7A0, RA2 the same order at 39)
 * says whether the room holds an observer slot, open or taken. The game counts it in the
 * limit it asks for (MODE +l: the host, each Open row, and the observer row), so the map's
 * slot count caps only the players: without the extra seat a two-player map with an open
 * observer row listed as 1/1 and turned the second player away. */
static uint32_t ex_info_observer_seat(const char *info) {
    unsigned field = 0;
    for (const char *p = info; p && *p && field < 5; p++) {
        if (*p == ',') { field++; continue; }
        if ((field == 3 || field == 4) && *p >= '1' && *p <= '9') return 1;
    }
    return 0;
}

static uint32_t effective_player_limit(uint32_t requested) {
    const wol_channel *channel = g_current_channel[0] ? current_channel() : NULL;
    uint32_t seat = channel ? ex_info_observer_seat(channel->ex_info) : 0;
    if (g_map_player_slots >= 2 && g_map_player_slots <= 8 && requested > g_map_player_slots + seat)
        return g_map_player_slots + seat;
    return requested;
}

static void parse_room_line(const char *line) {
    if (g_channel_count >= sizeof g_channels / sizeof g_channels[0]) return;
    char copy[WOL_LINE_CAP];
    copy_text(copy, sizeof copy, line);
    char *topic = strstr(copy, " :");
    if (topic) { *topic = '\0'; topic += 2; }
    char *fields[16] = { 0 };
    uint32_t count = 0;
    for (char *field = strtok(copy, " \r\n"); field && count < 16; field = strtok(NULL, " \r\n"))
        fields[count++] = field;
    if (count < 11 || strcmp(fields[1], "322") != 0 || fields[3][0] != '#') return;
    /* A type-0 LIST contains every lobby; the native screen only knows this
     * edition's own lobbies (Lob_33_* for RA2, Lob_41_* for YR). */
    if (g_channel_list_lobby) {
        char prefix[24];
        snprintf(prefix, sizeof prefix, "Lob_%u_", (unsigned)WOL_LOBBY_TYPE);
        int own = strncmp(fields[3] + 1, prefix, strlen(prefix)) == 0;
#ifndef RA2_TARGET_GAME
        /* Yuri's Revenge Quick Match (sub_0079FC40, gamemd 0x79FC40) asks for this same
         * type-0 list and only proceeds if an entry starts with Lob_39_ or Lob_40_
         * (Lob_40_ unless the lobby mode word at 0xA8B244 is 2). */
        own = own || strncmp(fields[3] + 1, "Lob_39_", 7) == 0 || strncmp(fields[3] + 1, "Lob_40_", 7) == 0;
#else
        /* Red Alert 2 Quick Match (Game.exe ~0x759FFF) wants Lob_38_ (Lob_35_ when its
         * mode word at 0xA3D2A4 is 2). World Domination reads the same two lobbies. */
        own = own || strncmp(fields[3] + 1, "Lob_35_", 7) == 0 || strncmp(fields[3] + 1, "Lob_38_", 7) == 0;
#endif
        if (!own) return;
    }
    wol_channel *channel = &g_channels[g_channel_count++];
    memset(channel, 0, sizeof *channel);
    channel->current_users = (uint32_t)strtoul(fields[4], NULL, 10);
    /* RA2Web's reserved field is zero; capacity is not part of this reply. */
    channel->max_users = 8;
    channel->reserved = (uint32_t)strtoul(fields[5], NULL, 10);
    channel->type = (int32_t)strtol(fields[6], NULL, 10);
    channel->tournament = (uint32_t)strtoul(fields[7], NULL, 10);
    channel->latency = (int32_t)strtol(fields[9], NULL, 10);
    channel->flags = (uint32_t)strtoul(fields[10], NULL, 10);
    channel->min_users = 2;
    copy_text(channel->name, sizeof channel->name, fields[3] + 1);
    topic = strstr(fields[10], "::");
    read_channel_metadata(channel, topic ? topic + 2 : "");
}

static uint32_t virtual_ip(const char *name);

/* The index'th number of a list separated by `separator`; RA2Web sends 0 for "not
 * measured yet", and anything missing or malformed counts the same. */
static int32_t parse_ping(const char *text, char separator, unsigned index) {
    for (; index && text; index--) {
        text = strchr(text, separator);
        if (text) text++;
    }
    if (!text || *text < '0' || *text > '9') return -1;
    long ping = strtol(text, NULL, 10);
    return ping > 0 ? (int32_t)ping : -1;
}
static uint32_t g_game_name;
static char g_host_name[32];
/* The game's "game name": a UTF-16 string (0xA8D610 in Yuri's Revenge, room for 21 characters) that
 * the host's own Create copies its name into and a guest's user-list sink fills with the first other
 * user. Each IPX chat message (type 0x0C) carries its hash and the receiver drops a message whose
 * hash differs from its own (0x0048D8DD, gate byte 0xA8D60D). A game the matchbot made has no
 * client that ran Create: its host (the room operator) is a guest to the game like the other
 * player, so each player's name is the other's and no message from one is ever drawn by the
 * other (the score screen chat). Put the room operator's name there on every player.
 * The name holds 20 units (19 characters and the NUL; 0xA3F618 in RA2 too): the packet buffer starts
 * right after it (YR 0xA8D638, RA2 0xA3F640). A longer write overwrote the kind of whatever packet was
 * in the buffer, so this saw a change at every poll and a chat packet caught in between was dropped. */
#define GAME_NAME_UNITS 20u
static void apply_game_name(void) {
    if (!g_game_name || !g_host_name[0]) return;
    uint16_t wide[GAME_NAME_UNITS] = { 0 };
    for (uint32_t i = 0; i + 1 < GAME_NAME_UNITS && g_host_name[i]; i++) wide[i] = (uint8_t)g_host_name[i];
    for (uint32_t i = 0; i < GAME_NAME_UNITS; i++) {
        if (MEM16(g_game_name + 2 * i) == wide[i]) continue;
        fprintf(stderr, "[wol] game name set to the room host %s\n", g_host_name);
        for (uint32_t j = 0; j < GAME_NAME_UNITS; j++) MEM16(g_game_name + 2 * j) = wide[j];
        return;
    }
}

/* ---- Clans: the squad id of a user entry and WolChat::RequestSquadInfo (docs/wol/handoff-wolapi.md, "Clans") ----
 * RA2Web's user lists carry each player's clan id as a trailing number of the entry (`nick,0,ping,fresh,clan`;
 * a JOIN has `0,ping,op,fresh,clan`), and the clan id is the game's squad id (the user record's +0x14). The game
 * draws `[tag]` from the record's +0x57 and the tooltip from +0x2E, and for a squad whose tag it does not know it
 * calls RequestSquadInfo(id) (0 asks for the user's own squad). The server answers `squadinfo <id>` with
 * `311 <nick> <asked> <squad id> <tag> :<name>` (squad id 0 is a failure); the answer goes to the chat sink's
 * OnSquadInfo (ordinal 29, +0x80: hr, squad id, record with the name at +0x168 and the tag at +0x191). Answers are
 * kept per id for the connection, so the records the shim builds already carry the tag and the game asks once. */
#define WOL_SQUAD_CACHE 32u
#define WOL_SQUAD_PENDING 64u
#define WOL_SQUAD_NICKS 64u
typedef struct { uint32_t id; char tag[13], name[41]; int known; } squad_entry;
static squad_entry g_squads[WOL_SQUAD_CACHE];
static uint32_t g_squad_count;
/* The ids the game asked for, in its order, and whether the server has been asked for each. */
static uint32_t g_squad_pending[WOL_SQUAD_PENDING], g_squad_pending_count;
static uint8_t g_squad_sent[WOL_SQUAD_PENDING];
/* The last squad id seen for a nick, so a record built from a JOINGAME (no clan field) still has it. */
static struct { char name[10]; uint32_t id; } g_squad_nicks[WOL_SQUAD_NICKS];
static uint32_t g_squad_nick_next;
static uint8_t g_squad_record[0x200];

static squad_entry *squad_find(uint32_t id) {
    for (uint32_t i = 0; i < g_squad_count; i++)
        if (g_squads[i].id == id) return &g_squads[i];
    return NULL;
}

static squad_entry *squad_store(uint32_t id, const char *tag, const char *name, int known) {
    squad_entry *entry = squad_find(id);
    if (!entry) {
        if (g_squad_count == WOL_SQUAD_CACHE) { memmove(&g_squads[0], &g_squads[1], sizeof g_squads - sizeof g_squads[0]); g_squad_count--; }
        entry = &g_squads[g_squad_count++];
    }
    entry->id = id;
    entry->known = known;
    copy_text(entry->tag, sizeof entry->tag, tag);
    copy_text(entry->name, sizeof entry->name, name);
    return entry;
}

/* The nick's squad id, remembered; and the user record's tag and name from the cache. */
static void squad_remember(const char *name, uint32_t id) {
    for (uint32_t i = 0; i < WOL_SQUAD_NICKS; i++)
        if (!strcasecmp(g_squad_nicks[i].name, name)) { g_squad_nicks[i].id = id; return; }
    uint32_t slot = g_squad_nick_next++ % WOL_SQUAD_NICKS;
    copy_text(g_squad_nicks[slot].name, sizeof g_squad_nicks[slot].name, name);
    g_squad_nicks[slot].id = id;
}
static uint32_t squad_recall(const char *name) {
    for (uint32_t i = 0; i < WOL_SQUAD_NICKS; i++)
        if (!strcasecmp(g_squad_nicks[i].name, name)) return g_squad_nicks[i].id;
    return 0;
}
static void squad_apply(wol_user *user, uint32_t id) {
    user->squad_id = id;
    user->squad_name[0] = user->squad_abbrev[0] = '\0';
    squad_entry *entry = id ? squad_find(id) : NULL;
    if (entry && entry->known) {
        copy_text(user->squad_name, sizeof user->squad_name, entry->name);
        copy_text(user->squad_abbrev, sizeof user->squad_abbrev, entry->tag);
    }
}

/* The index'th comma-separated number of `text`; 0 when absent. */
static uint32_t parse_count(const char *text, unsigned index) {
    for (; index && text; index--) {
        text = strchr(text, ',');
        if (text) text++;
    }
    if (!text || *text < '0' || *text > '9') return 0;
    return (uint32_t)strtoul(text, NULL, 10);
}

/* OnSquadInfo for one pending request; `entry` NULL is a failure. */
static void squad_deliver(uint32_t asked, const squad_entry *entry) {
    memset(g_squad_record, 0, sizeof g_squad_record);
    if (entry) {
        copy_text((char *)g_squad_record + 0x168, 41, entry->name);
        copy_text((char *)g_squad_record + 0x191, 13, entry->tag);
    }
    uint32_t values[] = { entry ? S_OK : E_FAIL, entry ? entry->id : asked, (uint32_t)(uintptr_t)g_squad_record };
    fprintf(stderr, "[wol] squad %u -> %s%s%s\n", (unsigned)asked, entry ? entry->tag : "failed", entry ? " " : "", entry ? entry->name : "");
    event_call(29, 3, values); /* IChatEvent::OnSquadInfo */
}

static void squad_remove(uint32_t index) {
    memmove(&g_squad_pending[index], &g_squad_pending[index + 1], (g_squad_pending_count - index - 1) * sizeof g_squad_pending[0]);
    memmove(&g_squad_sent[index], &g_squad_sent[index + 1], g_squad_pending_count - index - 1);
    g_squad_pending_count--;
}

/* Answers the requests whose squad the cache knows (called from the pump, never inside the request). */
static void squad_flush(void) {
    for (uint32_t i = 0; i < g_squad_pending_count;) {
        uint32_t asked = g_squad_pending[i];
        squad_entry *entry = asked ? squad_find(asked) : NULL;
        if (!entry) { i++; continue; }
        squad_remove(i);
        squad_deliver(asked, entry->known ? entry : NULL);
    }
}

/* `311 <nick> <asked> <squad id> <tag> :<name>`. */
static void squad_reply(const char *line) {
    char nick[32], tag[24];
    unsigned asked, id;
    if (sscanf(line, ":%*s 311 %31s %u %u %23s", nick, &asked, &id, tag) != 4) return;
    const char *name = strstr(line, " :");
    squad_entry *entry = id ? squad_store(id, tag, name ? name + 2 : "", 1) : NULL;
    if (!id && asked) squad_store(asked, "", "", 0); /* unknown or disbanded: not asked again this connection */
    for (uint32_t i = 0; i < g_squad_pending_count;) {
        if (g_squad_pending[i] != asked) { i++; continue; }
        squad_remove(i);
        squad_deliver(asked, entry);
    }
    squad_flush();
}

/* The connection ended, or the server has no `squadinfo` (421): every request fails. */
static void squad_fail_all(void) {
    while (g_squad_pending_count) {
        uint32_t asked = g_squad_pending[0];
        squad_remove(0);
        squad_deliver(asked, NULL);
    }
}

/* ---- Buddies and Find (LB-15; docs/wol/handoff-wolapi.md) ----
 * IChat slots 55-57 (RequestBuddyList/Add/Delete) answer through IChatEvent ordinals 34-36, and slot 24
 * RequestFind(User*) through ordinal 23, as the vtables show (YR CChatEventSink at 0x007F76B4, RA2 at 0x007AF77C;
 * slot = ordinal + 3): 34 is the list sink (hr, User* chain; next at +0x20, name at +0x24); 35/36 are the add/delete
 * sinks (hr, User*; both return 0 and ignore the answer); 23 is the find sink (hr, Channel*). RequestFind has the
 * User's name at +0x24 only; the Buddy List asks for each buddy in turn and `/on <nick>` asks for one. The server
 * (docs/wol/tasks.md LB-15) answers in order, so a pending find is the oldest one. */
#define WOL_BUDDY_MAX 100u
#define WOL_FIND_PENDING 8u
#define WOL_FIND_NOT_ONLINE 0x00040130u
#define WOL_FIND_NO_CHANNEL 0x00040131u
#define WOL_FIND_DISABLED 0x00040132u
static wol_user g_buddies[WOL_BUDDY_MAX]; /* the list being collected from 610 lines, until 611 */
static uint32_t g_buddy_count;
static wol_user g_buddy_answer_user;       /* the user of an add/delete answer */
static wol_channel g_found_channel;        /* the channel of a find answer */
static char g_find_pending[WOL_FIND_PENDING][32];
static uint32_t g_find_pending_count;

static void buddy_reset(void) {
    g_buddy_count = 0;
    g_find_pending_count = 0;
}

static void buddy_name_user(wol_user *user, const char *name) {
    memset(user, 0, sizeof *user);
    copy_text(user->name, sizeof user->name, name);
}

/* 610 <me> <buddy>: one entry of the list. 611: the list is complete (OnBuddyList, ordinal 34). */
static void buddy_list_line(const char *line) {
    char name[32];
    if (sscanf(line, ":%*s 610 %*s %31s", name) != 1) return;
    if (g_buddy_count >= WOL_BUDDY_MAX) return;
    buddy_name_user(&g_buddies[g_buddy_count++], name);
}

static void buddy_list_end(void) {
    for (uint32_t i = 0; i < g_buddy_count; i++)
        g_buddies[i].next = i + 1 < g_buddy_count ? (uint32_t)(uintptr_t)&g_buddies[i + 1] : 0;
    uint32_t values[] = { S_OK, g_buddy_count ? (uint32_t)(uintptr_t)&g_buddies[0] : 0 };
    uint32_t count = g_buddy_count;
    g_buddy_count = 0;
    fprintf(stderr, "[wol] buddy list: %u\n", (unsigned)count);
    event_call(34, 2, values); /* IChatEvent: the buddy list */
}

/* 612/613 add, 614 delete: `<me> <nick> :text`. The game ignores both answers; they still arrive. */
static void buddy_change_event(const char *name, uint32_t ordinal, uint32_t result) {
    buddy_name_user(&g_buddy_answer_user, name);
    uint32_t values[] = { result, (uint32_t)(uintptr_t)&g_buddy_answer_user };
    event_call(ordinal, 2, values); /* IChatEvent: buddy added (35) / removed (36) */
}

static void buddy_change_reply(const char *line, uint32_t ordinal, uint32_t result) {
    char name[32];
    if (sscanf(line, ":%*s %*u %*s %31s", name) != 1) return;
    buddy_change_event(name, ordinal, result);
}

static void find_deliver(const char *name, uint32_t result, const char *channel, int type) {
    for (uint32_t i = 0; i < g_find_pending_count; i++) {
        if (strcasecmp(g_find_pending[i], name)) continue;
        memmove(g_find_pending[i], g_find_pending[i + 1], (g_find_pending_count - i - 1) * sizeof g_find_pending[0]);
        g_find_pending_count--;
        break;
    }
    if (result == S_OK) {
        memset(&g_found_channel, 0, sizeof g_found_channel);
        /* WOLAPI channel names omit the IRC # prefix. */
        copy_text(g_found_channel.name, sizeof g_found_channel.name, channel + (channel[0] == '#'));
        g_found_channel.type = type;
        g_found_channel.max_users = 8;
    }
    fprintf(stderr, "[wol] find %s: 0x%x %s\n", name, (unsigned)result, result == S_OK ? g_found_channel.name : "");
    uint32_t values[] = { result, result == S_OK ? (uint32_t)(uintptr_t)&g_found_channel : 0 };
    event_call(23, 2, values); /* IChatEvent: the find answer */
}

/* 615 <me> <nick> <found|offline|nochannel|hidden> <channel> <type> */
static void find_reply(const char *line) {
    char name[32], state[16], channel[48] = "";
    int type = 0;
    if (sscanf(line, ":%*s 615 %*s %31s %15s %47s %d", name, state, channel, &type) < 2) return;
    uint32_t result = WOL_FIND_NOT_ONLINE;
    if (!strcmp(state, "found") && channel[0] && channel[0] != '*') result = S_OK;
    else if (!strcmp(state, "nochannel")) result = WOL_FIND_NO_CHANNEL;
    else if (!strcmp(state, "hidden")) result = WOL_FIND_DISABLED;
    find_deliver(name, result, channel, type);
}

/* A server without these commands answers 421 <me> <command> :...: fail the request like the real service would. */
static int buddy_unknown_command(const char *line) {
    if (!is_numeric_reply(line, "421")) return 0;
    char name[32] = "";
    if (strstr(line, " buddylist ")) { uint32_t v[] = { E_FAIL, 0 }; event_call(34, 2, v); return 1; }
    if (strstr(line, " buddyadd ")) { buddy_change_event("", 35, E_FAIL); return 1; }
    if (strstr(line, " buddydel ")) { buddy_change_event("", 36, E_FAIL); return 1; }
    if (strstr(line, " find ")) {
        if (g_find_pending_count) copy_text(name, sizeof name, g_find_pending[0]);
        find_deliver(name, WOL_FIND_NOT_ONLINE, "", 0);
        return 1;
    }
    return 0;
}

static void parse_roster(const char *line) {
    char channel[48];
    if (sscanf(line, ":%*s 353 %*s %*s %47s", channel) != 1 || strcmp(channel, g_current_channel)) return;
    /* The native guest validates NET_GO against the WOL host's identity. The
     * host can already have left the chat room while that UDP packet is in flight. */
    if (g_session.game_id[0] && !strcmp(g_session.channel, g_current_channel)) return;
    if (g_channel_count == 0) (void)current_channel();
    g_user_count = 0;
    const char *names = strrchr(line, ':');
    if (!names) return;
    char copy[WOL_LINE_CAP];
    copy_text(copy, sizeof copy, names + 1);
    for (char *name = strtok(copy, " \r\n"); name && g_user_count < sizeof g_users / sizeof g_users[0]; name = strtok(NULL, " \r\n")) {
        uint32_t flags = *name == '@' ? 1u : 0u;
        while (*name == '@' || *name == '+' || *name == '%') name++;
        char *metadata = strchr(name, ',');
        if (metadata) *metadata = '\0';
        if (!*name) continue;
        g_user_ping[g_user_count] = metadata ? parse_ping(metadata + 1, ',', 1) : -1;
        wol_user *user = &g_users[g_user_count++];
        memset(user, 0, sizeof *user);
        copy_text(user->name, sizeof user->name, name);
        user->ipaddr = virtual_ip(name);
        user->flags = flags | (strcmp(name, g_nick) == 0 ? 0x8000u : 0u);
        /* nick,0,ping,fresh,clan: the clan id is the squad id. */
        uint32_t clan = metadata ? parse_count(metadata + 1, 3) : 0;
        squad_remember(user->name, clan);
        squad_apply(user, clan);
    }
    emit_user_list();
}

/* Internet play is relayed through RA2Web (server/src/gserv/NativeRelay.ts), which
 * addresses players by a virtual IPv4 address hashed from their nick: FNV-1a of
 * the lower-cased nick as 10.x.y.z, last byte never 0 or 255. Returned in network
 * order, the way the game hands a User's address to sendto. */
static uint32_t virtual_ip(const char *name) {
    uint32_t hash = 2166136261u;
    for (const char *c = name; *c; c++) {
        hash ^= (uint8_t)((*c >= 'A' && *c <= 'Z') ? *c + 32 : *c);
        hash *= 16777619u;
    }
    uint8_t low = (uint8_t)hash;
    if (low == 0 || low == 255) low ^= 1;
    uint8_t octets[4] = { 10, (uint8_t)(hash >> 16), (uint8_t)(hash >> 8), low };
    uint32_t address;
    memcpy(&address, octets, 4);
    return address;
}

/* Absent in the Node selftest, which links no Winsock layer. */
extern void hle_ws_udp_set_local_ip(uint32_t address) __attribute__((weak));

static wol_user *user_for_name(const char *name) {
    if (!name || !*name) name = g_nick;
    for (uint32_t i = 0; i < g_user_count; i++)
        if (strcmp(g_users[i].name, name) == 0) return &g_users[i];
    if (g_user_count >= sizeof g_users / sizeof g_users[0]) return NULL;
    g_user_ping[g_user_count] = -1;
    wol_user *user = &g_users[g_user_count++];
    memset(user, 0, sizeof *user);
    copy_text(user->name, sizeof user->name, name);
    user->ipaddr = virtual_ip(name);
    user->flags = strcmp(name, g_nick) == 0 ? 0x8000u : 0u;
    squad_apply(user, squad_recall(name));
    return user;
}

static wol_user *sender_user(const char *line) {
    char name[32];
    const char *start = line + (line[0] == ':');
    size_t length = strcspn(start, "! \r\n");
    if (length >= sizeof name) length = sizeof name - 1;
    memcpy(name, start, length); name[length] = '\0';
    return user_for_name(name);
}

static int channel_error(const char *line) {
    if (!g_creating_channel && !g_joining_channel) return 0;
    unsigned code;
    char target[48];
    if (sscanf(line, ":%*s %u %*s %47s", &code, target) != 2 || strcmp(target, g_current_channel)) return 0;
    uint32_t status;
    /* HRESULT branches observed in RA2/YR's native OnChannelJoin callbacks. */
    switch (code) {
        case 471: status = 0x8004006eu; break; /* channel full */
        case 475: status = 0x80040071u; break; /* bad password */
        case 403: case 478: status = 0x80040070u; break; /* game closed */
        case 474: status = 0x80040072u; break; /* banned */
        case 711: status = E_FAIL; break; /* duplicate/rate-limited creation */
        default: return 0;
    }
    wol_channel *channel = current_channel();
    int creating = g_creating_channel;
    g_creating_channel = g_joining_channel = 0;
    if (creating) {
        uint32_t values[] = { status, (uint32_t)(uintptr_t)channel };
        event_call(6, 2, values); /* IChatEvent::OnChannelCreate */
    } else {
        wol_user *user = user_for_name(g_nick);
        uint32_t values[] = { status, (uint32_t)(uintptr_t)channel, (uint32_t)(uintptr_t)user };
        event_call(7, 3, values); /* IChatEvent::OnChannelJoin */
    }
    /* A failure callback can itself issue a retry or return to the lobby. */
    if (!g_creating_channel && !g_joining_channel && !strcmp(target, g_current_channel))
        g_current_channel[0] = '\0';
    return 1;
}

static void disconnected(void) {
    if (!g_connected) return;
    g_connected = g_connection_pending = g_creating_channel = g_joining_channel = g_starting_game = 0;
    g_map_player_slots = g_requested_player_limit = 0;
    memset(&g_session, 0, sizeof g_session);
    g_current_channel[0] = '\0';
    g_user_count = g_channel_count = g_lobby_users = g_channel_list_lobby = 0;
    g_squad_count = 0;
    memset(g_squad_nicks, 0, sizeof g_squad_nicks);
    buddy_reset();
    uint32_t status[] = { 0x0004012fu };
    event_call(16, 1, status); /* IChatEvent::OnNetStatus: connection closed */
    squad_fail_all();
}

static void complete_channel_leave(wol_user *user) {
    wol_channel *channel = current_channel();
    char leaving[48];
    copy_text(leaving, sizeof leaving, g_current_channel);
    uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)channel, (uint32_t)(uintptr_t)user };
    event_call(8, 3, values); /* IChatEvent::OnChannelLeave */
    if (user && (user->flags & 0x8000u) && strcmp(leaving, g_current_channel) == 0)
        g_current_channel[0] = '\0';
}

/* A PRIVMSG, or a PAGE (RA2Web's announcements to a player outside the chat lobbies,
 * docs/wol/handoff-wolapi.md): the game's UTF-16 page sink (ordinal 41, YR 0x007A9550,
 * three arguments like the private one) shows "(sender) text" as a grey row during a
 * match, and in the transcript or the Page Received dialog outside one.
 *
 * A NOTICE is RA2Web's mark for a line shown without its sender (LB-9, LB-10; the bot's
 * announcements and join lines): to the channel it goes to the public sink, to the player
 * to the page sink, as a PRIVMSG or PAGE would, and g_bare_text holds its text while the
 * sink runs. The game formats the line with the sender as always; the lifted chat add
 * (web_chat_time) and the in-match page post (web_bare_page) then keep only the text
 * (docs/wol/handoff-wolapi.md, "Lines without the bot's name"). */
static const uint16_t *g_bare_text;

/* A line may start with an IRC colour code (0x03 and one or two digits, an optional ",bg"
 * ignored): RA2Web's bot colours (LB-12). The game takes a received line's colour from a
 * table of seven COLORREFs (YR 0x007EEF28, RA2 0x007A7360: default, public, private, two
 * action colours, operator, page white) and a match's page row from the colour scheme named
 * by a pointer (YR 0x00822724, RA2 0x007D83B4, "Grey"; ColorScheme::FindIndex at the post).
 * Both are read when the line is made, so the shim points them at the chosen colour while
 * the sink runs and puts them back after (docs/wol/handoff-wolapi.md, "Bot line colours"). */
#ifdef RA2_TARGET_GAME
#define WOL_CHAT_COLOURS 0x007A7360u
#define WOL_PAGE_SCHEME 0x007D83B4u
#define WOL_REPLY_TARGET 0x00B2AC48u
#else
#define WOL_CHAT_COLOURS 0x007EEF28u
#define WOL_PAGE_SCHEME 0x00822724u
#define WOL_REPLY_TARGET 0x00B77E30u
#endif
static const struct { uint32_t colorref; const char *scheme; } k_irc_colours[16] = {
    { 0xFFFFFFu, "LightGrey" }, /* 0 white */
    { 0xA0A0A0u, "Grey" },      /* 1 black: unreadable on the dark lists, so grey */
    { 0xFF6040u, "DarkBlue" },  /* 2 blue */
    { 0x40C040u, "Green" },     /* 3 green */
    { 0x4040FFu, "DarkRed" },   /* 4 red */
    { 0x4080C0u, "Red" },       /* 5 brown */
    { 0xFF80C0u, "Purple" },    /* 6 purple */
    { 0x2090FFu, "Orange" },    /* 7 orange */
    { 0x40FFFFu, "Gold" },      /* 8 yellow */
    { 0x80FF80u, "DarkGreen" }, /* 9 light green */
    { 0xC0C000u, "LightBlue" }, /* 10 teal */
    { 0xFFFF80u, "LightBlue" }, /* 11 light cyan */
    { 0xFFA080u, "DarkSky" },   /* 12 light blue */
    { 0xC080FFu, "Magenta" },   /* 13 pink */
    { 0xA0A0A0u, "Grey" },      /* 14 grey */
    { 0xD0D0D0u, "LightGrey" }, /* 15 light grey */
};

/* The colour code at the start of text, or -1; *rest is the text after it. */
static int irc_colour(const char *text, const char **rest) {
    *rest = text;
    if (text[0] != 3 || text[1] < '0' || text[1] > '9') return -1;
    int colour = text[1] - '0', n = 2;
    if (text[2] >= '0' && text[2] <= '9') colour = colour * 10 + (text[n++] - '0');
    if (text[n] == ',' && text[n + 1] >= '0' && text[n + 1] <= '9') {
        n += 2;
        if (text[n] >= '0' && text[n] <= '9') n++;
    }
    *rest = text + n;
    return colour < 16 ? colour : -1;
}

static void receive_chat(const char *line) {
    char sender[10], target[48], command[16];
    if (sscanf(line, ":%9[^! ]%*s %15s %47s", sender, command, target) != 3) return;
    int notice = !strcmp(command, "NOTICE");
    int public = target[0] == '#' && (notice || !strcmp(command, "PRIVMSG"));
    int page = !public && (notice || !strcmp(command, "PAGE"));
    if (!public && !page && strcmp(command, "PRIVMSG")) return;
    if (strcmp(target, public ? g_current_channel : g_nick)) {
        fprintf(stderr, "[wol] chat from %s to %s ignored: current %s is \"%s\"\n", sender, target,
            public ? "channel" : "nick", public ? g_current_channel : g_nick);
        return;
    }
    const char *text = strstr(line, " :");
    if (!text) return;
    int colour = irc_colour(text + 2, &text); /* text: what follows " :" and any colour code */
    /* An invitation to a game room ("\x01INVITE <room>\x01", from the page's FRIENDS tab) is for the
     * invited player's page (pm.ts shows it with a JOIN button), not for the game's chat. */
    if (!public && !strncmp(text, "\x01INVITE ", 8)) return;
    wol_user user = { 0 };
    copy_text(user.name, sizeof user.name, sender);
    for (uint32_t i = 0; i < g_user_count; i++)
        if (!strcmp(g_users[i].name, sender)) { user = g_users[i]; break; }
    user.next = 0; /* A whisper from outside the channel must not change its roster. */
    /* /r and /reply answer the last player who wrote to this one privately: the game keeps that
     * name in a 16-byte buffer (YR 0x00B77E30, RA2 0x00B2AC48) that only its ANSI page sink fills,
     * so a private PRIVMSG fills it here. Not from an operator (the bot: its replies and pages would
     * take /r away from the player) nor from a NOTICE (docs/wol/handoff-wolapi.md, "/r and /reply"). */
    /* In a match the operator is a player (the room's), not the bot, which only pages and notices there. */
    if (!public && !page && (!(user.flags & 1u) || ra2_wolapi_match_active()))
        copy_text((char *)(uintptr_t)WOL_REPLY_TARGET, 16, sender);
    /* In a match the private-message event (38) has no chat list to write into and the line is lost;
     * the page sink (41) draws it as an in-match row, "(sender) text". So a whisper (/page, /r) to a
     * player in a match is shown as a page; the wire line stays a PRIVMSG (the page's MESSAGES counts it). */
    if (!public && !page && ra2_wolapi_match_active()) page = 1;
    uint16_t wide[WOL_LINE_CAP];
    MAIN_THREAD_EM_ASM({
        var text = UTF8ToString($0);
        var at = $1 >> 1;
        for (var i = 0; i < text.length && i < 4095; i++) HEAPU16[at + i] = text.charCodeAt(i);
        HEAPU16[at + i] = 0;
    }, text, wide);
    g_bare_text = notice ? wide : NULL;
    uint32_t saved_colours[7], saved_scheme = 0;
    if (colour >= 0) {
        for (unsigned i = 0; i < 7; i++) {
            saved_colours[i] = MEM32(WOL_CHAT_COLOURS + 4u * i);
            MEM32(WOL_CHAT_COLOURS + 4u * i) = k_irc_colours[colour].colorref;
        }
        saved_scheme = MEM32(WOL_PAGE_SCHEME);
        MEM32(WOL_PAGE_SCHEME) = (uint32_t)(uintptr_t)k_irc_colours[colour].scheme;
    }
    if (page) {
        uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)&user, (uint32_t)(uintptr_t)wide };
        fprintf(stderr, "[wol] %s from %s\n", notice ? "notice" : "page", sender);
        event_call(41, 3, values); /* IChatEvent: the UTF-16 page */
    } else if (public) {
        uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)current_channel(), (uint32_t)(uintptr_t)&user, (uint32_t)(uintptr_t)wide };
        event_call(37, 4, values); /* IChatEvent::OnPublicUnicodeMessage */
    } else {
        uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)&user, (uint32_t)(uintptr_t)wide };
        event_call(38, 3, values); /* IChatEvent::OnPrivateUnicodeMessage */
    }
    g_bare_text = NULL;
    if (colour >= 0) {
        for (unsigned i = 0; i < 7; i++) MEM32(WOL_CHAT_COLOURS + 4u * i) = saved_colours[i];
        MEM32(WOL_PAGE_SCHEME) = saved_scheme;
    }
}

/* The chat lists' add (run_lift.py chat_time_patches: YR 0x005E2700, RA2 0x005C2C80) hands every
 * line of the lobby, game room, LAN and co-op lists here before it is wrapped into rows, the
 * player's own lines too: a zeroed 0x400-character UTF-16 buffer at text_va. A line that is not
 * blank gets the player's local time in front, "14:05 [nick] : hello", and the first one of a day
 * (and so of a session) a date row before it, "-- 21 Nov 2026 --", through the \n the row add
 * splits at (docs/wol/handoff-wolapi.md, "Chat times"). The launcher's Chat times switch
 * (localStorage "ra2-chat-time" "0") turns it off; Module.ra2WolChatTime and Module.ra2WolChatNow
 * override the switch and the clock for tests. */
/* A line formatted from a NOTICE's text (g_bare_text) keeps the text alone: whatever the
 * game put in front of it ("[YuriBOT] : ", "(YuriBOT) ") goes. Any other line is left. */
static void cut_to_bare_text(uint32_t text_va) {
    if (!g_bare_text || !text_va) return;
    uint16_t *line = (uint16_t *)(uintptr_t)text_va;
    size_t n = 0, m = 0;
    while (n < 0x3FF && line[n]) n++;
    while (g_bare_text[m]) m++;
    if (!m || m >= n || memcmp(line + n - m, g_bare_text, m * sizeof *line)) return;
    memmove(line, line + n - m, m * sizeof *line);
    line[m] = 0;
}

/* run_lift.py bare_page_patches: a page about to be posted as a match's grey row. */
void web_bare_page(uint32_t text_va) { cut_to_bare_text(text_va); }

/* run_lift.py chat_time_patches: on around the welcome runner's calls to the chat add
 * (CHAT_TIME_MOTD_CALLS), whose MOTD rows keep no time. Game thread only. */
static int g_chat_motd;
void web_chat_motd(int on) { g_chat_motd = on; }

void web_chat_time(uint32_t text_va) {
    if (!text_va) return;
    cut_to_bare_text(text_va);
    if (g_chat_motd) return;
    MAIN_THREAD_EM_ASM({
        var at = $0 >> 1;
        var cap = 0x3FF;
        var n = 0;
        while (n < cap && HEAPU16[at + n]) n++;
        var blank = true;
        for (var k = 0; k < n && blank; k++) blank = HEAPU16[at + k] <= 32;
        if (blank) return;
        var on = Module.ra2WolChatTime;
        if (on === undefined) {
            on = true;
            try { on = localStorage.getItem("ra2-chat-time") !== "0"; } catch (e) {}
        }
        if (!on) return;
        var now = Module.ra2WolChatNow ? Module.ra2WolChatNow() : new Date();
        var two = function(v) { return (v < 10 ? "0" : "") + v; };
        var stamp = two(now.getHours()) + ":" + two(now.getMinutes()) + " ";
        var day = now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate();
        if (Module.ra2WolChatDay !== day) {
            Module.ra2WolChatDay = day;
            var month = "JanFebMarAprMayJunJulAugSepOctNovDec".substr(now.getMonth() * 3, 3);
            stamp = "-- " + now.getDate() + " " + month + " " + now.getFullYear() + " --\n" + stamp;
        }
        var keep = Math.min(n, cap - stamp.length);
        HEAPU16.copyWithin(at + stamp.length, at, at + keep);
        for (var i = 0; i < stamp.length; i++) HEAPU16[at + i] = stamp.charCodeAt(i);
        HEAPU16[at + stamp.length + keep] = 0;
    }, text_va);
}

/* ---- Ladder and high-score records (INetUtil slots 4, 5, 12-14; INetUtilEvent slots 4 and 9) ----
 * The game asks the ladder service for the records of the names its lobby lists
 * (RequestLadderList with up to 20 names, then RequestHighscore for the same names) and for the
 * records around a name (RequestLadderSearch, the ladder screen). The page answers from RA2Web's
 * ladder routes (web/src/game/wol-ladder.ts); the answer line is turned into the game's own
 * record lists here and delivered from the game thread's pump through OnLadderList (slot 4) or
 * OnHighscore (slot 9). Layouts are the embedded type library's, in x86 offsets
 * (docs/wol/handoff-wolapi.md, "Ladder and high-score records"). */
typedef struct {
    int32_t sku, team_no, wins, losses, points, kills, rank, rung, disconnects, team_rung,
        provisional, last_game_date, win_streak, reserved1, reserved2;
    uint32_t next;
    char login_name[40];
    int32_t locale;
} wol_ladder;
typedef struct {
    int32_t sku, wins, losses, points, rank, accomplishments;
    uint32_t next;
    char login_name[40];
} wol_highscore;
_Static_assert(sizeof(wol_ladder) == 0x6C, "WOLAPI x86 Ladder layout");
_Static_assert(sizeof(wol_highscore) == 0x44, "WOLAPI x86 Highscore layout");

#define WOL_LADDER_MAX 64u
#ifdef RA2_TARGET_GAME
#define WOL_LADDER_SKU 16640u
#define WOL_INFO_FILE "wolinfo.ini"
#else
#define WOL_LADDER_SKU 18688u
#define WOL_INFO_FILE "wolinfoMD.ini"
#endif
static wol_ladder g_ladder_records[WOL_LADDER_MAX];
static wol_highscore g_score_records[WOL_LADDER_MAX];
static uint32_t g_ladder_id;
/* The player's own record is read again after a scored match: soon after the result was
 * stored, and again while the other players' reports can still arrive. */
static double g_self_refresh_due[3];

static void request_own_stats(void) {
    if (!g_connected || !g_nick[0]) return;
    char line[96];
    if (!++g_ladder_id) ++g_ladder_id;
    snprintf(line, sizeof line, "@ladder self %u %u %s", g_ladder_id, WOL_LADDER_SKU, g_nick);
    browser_send(line);
}

static void schedule_own_stats(void) {
    double now = emscripten_get_now();
    g_self_refresh_due[0] = now + 8000.0;
    g_self_refresh_due[1] = now + 25000.0;
    g_self_refresh_due[2] = now + 60000.0;
}

static void poll_own_stats(void) {
    double now = emscripten_get_now();
    for (unsigned i = 0; i < 3; i++) {
        if (!g_self_refresh_due[i] || now < g_self_refresh_due[i]) continue;
        g_self_refresh_due[i] = 0;
        request_own_stats();
    }
}

/* The game's keys are one string of names, each followed by a colon ("rkone:yuribot:"); hand
 * them on comma-separated, lower-cased. */
static void ladder_names(const char *keys, char *out, size_t capacity) {
    size_t used = 0;
    int pending_separator = 0;
    for (const char *p = keys ? keys : ""; *p && used + 2 < capacity; p++) {
        if (*p == ':' || *p == ',' || *p == ';' || *p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') {
            pending_separator = used > 0;
            continue;
        }
        if (pending_separator) { out[used++] = ','; pending_separator = 0; }
        out[used++] = (*p >= 'A' && *p <= 'Z') ? (char)(*p + 32) : *p;
    }
    out[used] = '\0';
}

static void request_ladder(const char *method, const char *keys, uint32_t sku, int high_score) {
    char names[WOL_LINE_CAP / 2], line[WOL_LINE_CAP];
    ladder_names(keys, names, sizeof names);
    fprintf(stderr, "[wol] %s sku=0x%x keys=\"%s\"\n", method, sku, names);
    if (!++g_ladder_id) ++g_ladder_id;
    snprintf(line, sizeof line, "@ladder %s %u %u %s", high_score ? "score" : "list", g_ladder_id,
        WOL_LADDER_SKU, names);
    browser_send(line);
}

/* INetUtil::RequestLadderList(host, port, keys, SKU, team, cond, sort) */
static void m_net_ladder_list(void) {
    request_ladder("RequestLadderList", ASTR(3), A32(4), 0);
    RET(S_OK, 8);
}
/* INetUtil::RequestLocaleLadderList(..., Locale): the same records; the locale is not used */
static void m_net_ladder_list_locale(void) {
    request_ladder("RequestLocaleLadderList", ASTR(3), A32(4), 0);
    RET(S_OK, 9);
}
/* INetUtil::RequestHighscore(host, port, keys, SKU) */
static void m_net_highscore(void) {
    request_ladder("RequestHighscore", ASTR(3), A32(4), 1);
    RET(S_OK, 5);
}
/* INetUtil::RequestLadderSearch(host, port, key, SKU, team, cond, sort, number, leading) */
static void ladder_search(const char *key_text, uint32_t sku, uint32_t number, uint32_t leading) {
    char key[40], line[WOL_LINE_CAP];
    ladder_names(key_text, key, sizeof key);
    fprintf(stderr, "[wol] RequestLadderSearch sku=0x%x key=\"%s\" number=%u leading=%u\n", sku, key, number, leading);
    if (!++g_ladder_id) ++g_ladder_id;
    snprintf(line, sizeof line, "@ladder search %u %u %u %u %s", g_ladder_id, WOL_LADDER_SKU,
        number > 100u ? 100u : number, leading > 100u ? 100u : leading, key);
    browser_send(line);
}
static void m_net_ladder_search(void) { ladder_search(ASTR(3), A32(4), A32(8), A32(9)); RET(S_OK, 10); }
static void m_net_ladder_search_locale(void) { ladder_search(ASTR(3), A32(4), A32(8), A32(9)); RET(S_OK, 11); }

/* One record token: name|rank|points|wins|losses|disconnects|badgePoints */
static int parse_ladder_token(char *token, char **name, int32_t v[6]) {
    char *save = NULL;
    *name = strtok_r(token, "|", &save);
    if (!*name) return 0;
    for (unsigned i = 0; i < 6; i++) {
        char *field = strtok_r(NULL, "|", &save);
        if (!field) return 0;
        v[i] = (int32_t)strtol(field, NULL, 10);
    }
    return 1;
}

/* The player's own numbers go into the persona file the welcome screen reads (the game loads
 * wolinfo.ini / wolinfoMD.ini afresh whenever it shows them): Rank, Points, Wins, Losses and
 * Disconnects of the nick's own section. The rest of the file is kept as it is. */
#define WOL_INI_CAP 65536u
static char g_ini_in[WOL_INI_CAP], g_ini_out[WOL_INI_CAP + 1024u];
static size_t g_ini_used;
static const char *const g_persona_keys[5] = { "Rank", "Points", "Wins", "Losses", "Disconnects" };

static void ini_put(const char *text, size_t length) {
    if (g_ini_used + length >= sizeof g_ini_out) return;
    memcpy(g_ini_out + g_ini_used, text, length);
    g_ini_used += length;
}
static void ini_put_missing(const char *eol, const int32_t value[5], const uint8_t done[5]) {
    char line[48];
    for (unsigned i = 0; i < 5; i++) {
        if (done[i]) continue;
        int length = snprintf(line, sizeof line, "%s=%d%s", g_persona_keys[i], (int)value[i], eol);
        ini_put(line, (size_t)length);
    }
}

/* The file's text with the nick's five stats set; returns the new length in g_ini_out. */
static size_t persona_stats_text(const char *text, size_t length, const char *nick, const int32_t value[5]) {
    const char *eol = memchr(text, '\r', length) ? "\r\n" : "\n";
    uint8_t done[5] = { 0 };
    int in_section = 0, found = 0;
    g_ini_used = 0;
    for (size_t at = 0; at < length;) {
        const char *line = text + at;
        const char *end = memchr(line, '\n', length - at);
        size_t whole = end ? (size_t)(end - line) + 1u : length - at;
        size_t body = whole;
        while (body && (line[body - 1] == '\n' || line[body - 1] == '\r')) body--;
        at += whole;
        if (body && line[0] == '[') {
            if (in_section) ini_put_missing(eol, value, done);
            const char *close = memchr(line, ']', body);
            size_t name_length = close ? (size_t)(close - line) - 1u : 0;
            in_section = close && name_length == strlen(nick) && !strncasecmp(line + 1, nick, name_length);
            if (in_section) found = 1;
            ini_put(line, whole);
            if (!end) ini_put(eol, strlen(eol));
            continue;
        }
        int replaced = 0;
        if (in_section) {
            for (unsigned i = 0; i < 5 && !replaced; i++) {
                size_t key_length = strlen(g_persona_keys[i]);
                if (body <= key_length || strncasecmp(line, g_persona_keys[i], key_length)) continue;
                size_t after = key_length;
                while (after < body && (line[after] == ' ' || line[after] == '\t')) after++;
                if (after >= body || line[after] != '=') continue;
                char fresh[48];
                int n = snprintf(fresh, sizeof fresh, "%s=%d%s", g_persona_keys[i], (int)value[i], eol);
                ini_put(fresh, (size_t)n);
                done[i] = 1;
                replaced = 1;
            }
        }
        if (!replaced) {
            ini_put(line, whole);
            if (!end) ini_put(eol, strlen(eol));
        }
    }
    if (in_section) ini_put_missing(eol, value, done);
    if (!found) {
        char header[48];
        int n = snprintf(header, sizeof header, "[%s]%s", nick, eol);
        ini_put(header, (size_t)n);
        ini_put_missing(eol, value, done);
    }
    return g_ini_used;
}

static void persona_store_stats(const char *nick, const int32_t value[5]) {
    char path[300] = "/game/" WOL_INFO_FILE, lower[32];
    DIR *dir = opendir("/game");
    if (dir) {
        struct dirent *entry;
        while ((entry = readdir(dir)))
            if (!strcasecmp(entry->d_name, WOL_INFO_FILE)) {
                snprintf(path, sizeof path, "/game/%s", entry->d_name);
                break;
            }
        closedir(dir);
    }
    size_t length = 0;
    FILE *file = fopen(path, "rb");
    if (file) {
        length = fread(g_ini_in, 1, WOL_INI_CAP - 1u, file);
        fclose(file);
    }
    for (unsigned i = 0; i < sizeof lower - 1u; i++) {
        lower[i] = nick[i] >= 'A' && nick[i] <= 'Z' ? (char)(nick[i] + 32) : nick[i];
        if (!nick[i]) break;
    }
    lower[sizeof lower - 1u] = '\0';
    size_t out = persona_stats_text(g_ini_in, length, lower, value);
    /* Writing over an existing file can append in the browser build; replace it. */
    remove(path);
    file = fopen(path, "wb");
    if (!file) return;
    fwrite(g_ini_out, 1, out, file);
    fclose(file);
    fprintf(stderr, "[wol] persona %s: rank %d points %d wins %d losses %d disconnects %d\n", lower,
        (int)value[0], (int)value[1], (int)value[2], (int)value[3], (int)value[4]);
}

/* `@wolapi ladder <kind> <id> <status> <total> <keyRung> <records...>` from the page. */
static void deliver_ladder(const char *line) {
    char copy[WOL_LINE_CAP], *save = NULL;
    copy_text(copy, sizeof copy, line);
    strtok_r(copy, " ", &save); /* @wolapi */
    strtok_r(NULL, " ", &save); /* ladder */
    const char *kind = strtok_r(NULL, " ", &save);
    char *id = strtok_r(NULL, " ", &save), *status_text = strtok_r(NULL, " ", &save);
    char *total_text = strtok_r(NULL, " ", &save), *rung_text = strtok_r(NULL, " ", &save);
    if (!kind || !id || !status_text || !total_text || !rung_text) return;
    uint32_t status = (uint32_t)strtoul(status_text, NULL, 10);
    int32_t total = (int32_t)strtol(total_text, NULL, 10), key_rung = (int32_t)strtol(rung_text, NULL, 10);
    unsigned count = 0;
    int32_t own[5] = { 0 };
    int have_own = 0;
    int self = !strcmp(kind, "self"), score = !strcmp(kind, "score");
    for (char *token = strtok_r(NULL, " ", &save); token && count < WOL_LADDER_MAX; token = strtok_r(NULL, " ", &save)) {
        char *name;
        int32_t v[6];
        if (!parse_ladder_token(token, &name, v)) continue;
        if (self) {
            if (!strcasecmp(name, g_nick)) {
                own[0] = v[0]; own[1] = v[1]; own[2] = v[2]; own[3] = v[3]; own[4] = v[4];
                have_own = 1;
            }
            continue;
        }
        if (score) {
            wol_highscore *record = &g_score_records[count];
            memset(record, 0, sizeof *record);
            record->sku = (int32_t)WOL_LADDER_SKU;
            record->wins = v[2];
            record->losses = v[3];
            record->points = v[5]; /* the badge's points */
            record->rank = v[0];
            copy_text(record->login_name, sizeof record->login_name, name);
            record->next = 0;
            if (count) g_score_records[count - 1].next = (uint32_t)(uintptr_t)record;
        } else {
            wol_ladder *record = &g_ladder_records[count];
            memset(record, 0, sizeof *record);
            record->sku = (int32_t)WOL_LADDER_SKU;
            record->wins = v[2];
            record->losses = v[3];
            record->points = v[1];
            /* The lobby reads +0x1C ("rung") as the rank it sorts and draws; +0x18 is the same place. */
            record->rank = v[0];
            record->rung = v[0];
            record->disconnects = v[4];
            copy_text(record->login_name, sizeof record->login_name, name);
            record->next = 0;
            if (count) g_ladder_records[count - 1].next = (uint32_t)(uintptr_t)record;
        }
        count++;
    }
    if (self) {
        if (have_own && status == S_OK) persona_store_stats(g_nick, own);
        return;
    }
    uint32_t sink = g_channel.sink;
    fprintf(stderr, "[wol] %s answer: %u records, status 0x%x, sink %s\n", kind, count, (unsigned)status, sink ? "set" : "none");
    if (!sink) return;
    uint32_t list = count ? (uint32_t)(uintptr_t)(score ? (void *)&g_score_records[0] : (void *)&g_ladder_records[0]) : 0;
    uint32_t args[] = { sink, status, list, (uint32_t)total, (uint32_t)(time(NULL)), (uint32_t)key_rung };
    /* INetUtilEvent::OnLadderList (slot 4) / OnHighscore (slot 9) */
    hle_call_guest(MEM32(MEM32(sink) + (score ? 9u : 4u) * 4u), 6, args);
}

static void handle_line(const char *line) {
    if (!strncmp(line, "@wolapi gameres ", 16)) {
        unsigned id, status; char extra;
        if (sscanf(line + 16, "%u %u %c", &id, &status, &extra) == 2) {
            complete_report(id, status);
            /* A stored result is scored soon after; read the own record again then. */
            if (!status) schedule_own_stats();
        }
        return;
    }
    if (!strncmp(line, "@wolapi ladder ", 15)) { deliver_ladder(line); return; }
    if (strstr(line, " 311 ")) { squad_reply(line); return; }
    if (strstr(line, " 421 ") && strstr(line, " squadinfo ")) { squad_fail_all(); return; }
    if (is_numeric_reply(line, "610")) { buddy_list_line(line); return; }
    if (is_numeric_reply(line, "611")) { buddy_list_end(); return; }
    if (is_numeric_reply(line, "612")) { buddy_change_reply(line, 35, S_OK); return; }
    if (is_numeric_reply(line, "613")) { buddy_change_reply(line, 35, E_FAIL); return; }
    if (is_numeric_reply(line, "614")) { buddy_change_reply(line, 36, S_OK); return; }
    if (is_numeric_reply(line, "615")) { find_reply(line); return; }
    if (buddy_unknown_command(line)) return;
    const char *command = strchr(line, ' ');
    if (channel_error(line)) return;
    if (strcmp(line, "@wolapi connected") == 0) {
        g_connected = 1;
        g_connection_pending = 0;
        /* The native screen prints OnConnection's `motd` argument in the chat box;
         * it does not show anything delivered through OnMessageOfTheDay. */
        emit_connection(S_OK, g_motd_ready ? g_motd : "Connected to RA2Web");
        g_motd_ready = 0;
        request_own_stats();
        return;
    }
    if (is_numeric_reply(line, "375") || is_numeric_reply(line, "372") || is_numeric_reply(line, "376")) {
        collect_motd(line);
        return;
    }
    if (strncmp(line, "@wolapi error ", 14) == 0) {
        if (g_connected) disconnected();
        else if (g_connection_pending) {
            g_connection_pending = 0;
            /* `@wolapi error 0x80040065 <message>`: the loader names the result the
             * game's OnConnection turns into its own text ("bad password", "banned").
             * Without a code it is a plain failure ("could not connect"). */
            const char *text = line + 14;
            char *end;
            uint32_t result = E_FAIL;
            if (text[0] == '0' && text[1] == 'x') {
                unsigned long code = strtoul(text, &end, 16);
                if (end == text + 10 && *end == ' ' && (code == 0x80040065ul || code == 0x80040072ul)) {
                    result = (uint32_t)code;
                    text = end + 1;
                }
            }
            emit_connection(result, text);
        }
        return;
    }
    if (!strcmp(line, "@wolapi disconnected")) { disconnected(); return; }
    if (command && (!strncmp(command, " PRIVMSG ", 9) || !strncmp(command, " PAGE ", 6) || !strncmp(command, " NOTICE ", 8))) { receive_chat(line); return; }
    if (command && !strncmp(command, " STARTG_ABORT ", 14)) {
        char channel[48]; unsigned reason;
        if (g_starting_game && sscanf(line, ":%*s STARTG_ABORT %47s :%u", channel, &reason) == 2 && !strcmp(channel, g_current_channel)) {
            g_starting_game = 0;
            memset(&g_session, 0, sizeof g_session);
            uint32_t values[] = { E_FAIL, (uint32_t)(uintptr_t)current_channel(), 0, 0 };
            event_call(20, 4, values);
        }
        return;
    }
    if (strstr(line, " 309 ") && g_locale_user.name[0]) {
        const char *locale = strstr(line, " :");
        if (locale) {
            g_locale_user.locale = (int32_t)strtol(locale + 2, NULL, 10);
            /* RA2Web carries the locale code after `; the leading 0 is not LOC_USA. */
            const char *code = strchr(locale + 2, '`');
            if (code) for (uint32_t i = 2; i < sizeof g_locales / sizeof g_locales[0]; i++)
                if (strcmp(code + 1, g_locales[i].code) == 0) { g_locale_user.locale = (int32_t)i; break; }
            uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)&g_locale_user };
            event_call(30, 2, values); /* IChatEvent::OnUserLocale */
        }
        return;
    }
    /* RPL 730: RA2Web scored a game this player was in; the own record changed. */
    if (strstr(line, " 730 ")) { request_own_stats(); return; }
    if (strstr(line, " 322 ")) { parse_room_line(line); return; }
    if (strstr(line, " 323 ")) { emit_channel_list(); return; }
    if (strstr(line, " 353 ")) { parse_roster(line); return; }
    if (strstr(line, " TOPIC ")) {
        const char *topic = strstr(line, " :");
        wol_channel *channel = current_channel();
        if (topic && channel) {
            read_channel_metadata(channel, topic + 2);
            uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)channel, (uint32_t)(uintptr_t)channel->topic };
            event_call(9, 3, values); /* IChatEvent::OnChannelTopic */
        }
        return;
    }
    if (strstr(line, " PART ")) {
        char target[48];
        if (sscanf(line, ":%*s PART %47s", target) != 1 || strcmp(target, g_current_channel)) return;
        size_t nick_length = strlen(g_nick);
        int own = line[0] == ':' && !strncmp(line + 1, g_nick, nick_length) &&
            (line[nick_length + 1] == '!' || line[nick_length + 1] == ' ');
        int match_room = g_session.game_id[0] && !strcmp(g_session.channel, g_current_channel);
        if (!own && match_room) return;
        /* RA2Web parts everyone from a started room once its host leaves. A guest
         * can still be waiting for NET_GO then, and RA2 takes leaving the room in
         * that wait as abandoning the start (Negotiate_Scenario_Transfer failed).
         * Only a leave the game asked for completes now; this one waits for it. */
        if (own && match_room && !g_match_leave_requested) {
            g_match_part_held = 1;
            fprintf(stderr, "[wol] holding the server's PART of %s until the game leaves it\n", g_current_channel);
            return;
        }
        complete_channel_leave(sender_user(line));
        return;
    }
    if (strstr(line, " JOINGAME ")) {
        const char *name = strrchr(line, ':');
        wol_user *user = sender_user(line);
        if (user) g_user_ping[user - g_users] = parse_ping(strstr(line, " JOINGAME ") + 10, ' ', 5);
        if (name && user && (user->flags & 0x8000u)) {
            copy_text(g_current_channel, sizeof g_current_channel, name + 1);
            g_joining_channel = 0;
            g_roster_wanted = 1;
            if (strncmp(name + 1, "#Lob_", 5) != 0)
                fprintf(stderr, "[wol] own join of game channel %s\n", name + 1);
        }
        wol_channel *channel = current_channel();
        if (g_creating_channel && user && (user->flags & 0x8000u)) {
            g_creating_channel = 0;
            user->flags |= 1u;
            uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)channel };
            event_call(6, 2, values); /* IChatEvent::OnChannelCreate */
            return;
        }
        uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)channel, (uint32_t)(uintptr_t)user };
        event_call(7, 3, values); /* IChatEvent::OnChannelJoin */
        return;
    }
    if (strstr(line, " JOIN ")) {
        const char *name = strrchr(line, ' ');
        if (name) copy_text(g_current_channel, sizeof g_current_channel, name + 1);
        const char *nick = line[0] == ':' ? line + 1 : g_nick;
        const char *bang = strchr(nick, '!');
        char user_name[32];
        size_t length = bang ? (size_t)(bang - nick) : strcspn(nick, " \r\n");
        if (length >= sizeof user_name) length = sizeof user_name - 1;
        memcpy(user_name, nick, length); user_name[length] = '\0';
        wol_channel *channel = current_channel();
        wol_user *user = user_for_name(user_name);
        if (user) {
            const char *metadata = strstr(line, " JOIN ") + 6;
            g_user_ping[user - g_users] = parse_ping(metadata + (*metadata == ':'), ',', 1);
            /* 0,ping,op,fresh,clan */
            uint32_t clan = parse_count(metadata + (*metadata == ':'), 4);
            squad_remember(user->name, clan);
            squad_apply(user, clan);
        }
        if (user && (user->flags & 0x8000u)) {
            g_joining_channel = 0;
            g_roster_wanted = 1;
        }
        uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)channel, (uint32_t)(uintptr_t)user };
        event_call(7, 3, values); /* IChatEvent::OnChannelJoin */
        return;
    }
    if (strstr(line, " GAMEOPT ")) {
        const char *options = strstr(line, " :");
        wol_channel *channel = current_channel();
        wol_user *user = sender_user(line);
        const char *target = strstr(line, " GAMEOPT ") + 9;
        /* A server-side match bot is not in the channel roster, so its GAMEOPT
         * has no native user object. Attribute it to the local player: the
         * event still needs a user, and the options themselves are what the
         * game caches for the match. */
        if (!user) user = user_for_name(g_nick);
        if (*target != '#') {
            uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)user,
                (uint32_t)(uintptr_t)(options ? options + 2 : "") };
            event_call(18, 3, values); /* IChatEvent::OnPrivateGameOptions */
            return;
        }
        uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)channel, (uint32_t)(uintptr_t)user,
            (uint32_t)(uintptr_t)(options ? options + 2 : "") };
        event_call(19, 4, values); /* IChatEvent::OnPublicGameOptions */
        return;
    }
    if (strstr(line, " STARTG ")) {
        ra2_wolapi_session session = { 0 };
        char timestamp[11], extra, *end;
        if (sscanf(line, ":%*s STARTG %47s :%255s :%63s %10[0-9] %127s %c",
            session.channel, session.gserv_url, session.game_id, timestamp, session.ticket, &extra) != 5)
            return;
        if (strcmp(session.channel, g_current_channel) != 0 ||
            (strncmp(session.gserv_url, "ws://", 5) && strncmp(session.gserv_url, "wss://", 6)) ||
            session.game_id[0] != 'g') return;
        unsigned long long number = strtoull(session.game_id + 1, &end, 10);
        unsigned long long time = strtoull(timestamp, NULL, 10);
        if (end == session.game_id + 1 || *end != '-' || !end[1] || !number || number > UINT32_MAX || time > UINT32_MAX)
            return;
        session.game_number = (uint32_t)number;
        session.timestamp = (uint32_t)time;
        invalidate_reports();
        g_session = session;
        g_match_leave_requested = g_match_part_held = g_pending_match_part = 0;
        log_users("startg");
        g_host_name[0] = '\0';
        for (uint32_t i = 0; i < g_user_count; i++)
            if (g_users[i].flags & 1u) { copy_text(g_host_name, sizeof g_host_name, g_users[i].name); break; }
        apply_game_name();
        g_starting_game = 0;
        wol_channel *channel = current_channel();
        uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)channel,
            g_user_count ? (uint32_t)(uintptr_t)&g_users[0] : 0, session.game_number };
        event_call(20, 4, values); /* IChatEvent::OnGameStart */
    }
}

static uint32_t g_no_router_flag, g_ipx_manager;
void ra2_wolapi_set_no_router_flag(uint32_t guest_address) { g_no_router_flag = guest_address; }
void ra2_wolapi_set_ipx_manager(uint32_t guest_address) { g_ipx_manager = guest_address; }
void ra2_wolapi_set_game_name(uint32_t guest_address) { g_game_name = guest_address; }

/* IPXManagerClass: connection pointers from +0x28, their count at +0x44; each
 * connection keeps its peer's address object at +0x4C, whose first word is a port. */
static void clear_connection_ports(void) {
    uint32_t count = MEM32(g_ipx_manager + 0x44);
    for (uint32_t i = 0; i < count && i < 8; i++) {
        uint32_t connection = MEM32(g_ipx_manager + 0x28 + 4 * i);
        if (connection) MEM16(connection + 0x4C) = 0;
    }
}

/* The session is reset between STARTG and Create_Connections, so keep it cleared. */
void ra2_wolapi_poll(void) {
    if (!g_session.game_id[0]) return;
    if (g_no_router_flag) MEM8(g_no_router_flag) = 0;
    if (g_ipx_manager) clear_connection_ports();
    apply_game_name();
}

static void pump_lines(void) {
    ra2_wolapi_poll();
    poll_own_stats();
    squad_flush();
    if (g_pending_server_list) {
        g_pending_server_list = 0;
        emit_server_list();
        /* RA2/YR wait for both the list and the directory connection status. */
        uint32_t status[] = { 0x0004012fu }; /* directory connection closed after listing */
        event_call(16, 1, status); /* IChatEvent::OnNetStatus */
    }
    if (g_pending_page_sent) {
        g_pending_page_sent = 0;
        uint32_t values[] = { S_OK };
        event_call(24, 1, values); /* IChatEvent: the page was sent */
    }
    if (g_pending_logout) {
        g_pending_logout = 0;
        wol_user *user = user_for_name(g_nick);
        uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)user };
        event_call(17, 2, values); /* IChatEvent::OnLogout */
        /* The game's log-off routine (wonline.cpp, TXT_WOL_LOGGING_OUT) sets a flag and
         * waits on an event that only OnNetStatus signals while that flag is set. */
        uint32_t status[] = { 0x0004012fu };
        event_call(16, 1, status); /* IChatEvent::OnNetStatus */
        g_current_channel[0] = '\0';
        buddy_reset();
        g_user_count = 0;
        g_channel_count = 0;
        g_lobby_users = 0;
        g_channel_list_lobby = 0;
        g_motd_ready = 0;
    }
    if (g_pending_match_part) {
        g_pending_match_part = 0;
        if (g_session.game_id[0] && !strcmp(g_session.channel, g_current_channel))
            complete_channel_leave(user_for_name(g_nick));
    }
    uint32_t read = __atomic_load_n(&g_line_read, __ATOMIC_RELAXED);
    /* Callbacks can synchronously enqueue another send failure. Process only
     * this snapshot so a retry cannot keep the game thread inside one pump. */
    uint32_t write = __atomic_load_n(&g_line_write, __ATOMIC_ACQUIRE);
    for (;;) {
        if (read == write) break;
        char line[WOL_LINE_CAP];
        copy_text(line, sizeof line, g_lines[read]);
        read = (read + 1u) % WOL_LINE_COUNT;
        __atomic_store_n(&g_line_read, read, __ATOMIC_RELEASE);
        handle_line(line);
    }
}

static void m_query_interface(void) {
    uint32_t self = A32(0), iid = A32(1), out = A32(2);
    wol_object *state = object_of(self);
    uint32_t result = 0;
    if (!out) RET(E_POINTER, 3);
    if (iid && memcmp(APTR(1), state->primary_iid, 16) == 0) result = state->chat;
    else if (iid && memcmp(APTR(1), IID_IConnectionPointContainer, 16) == 0) result = state->container;
    else if (iid && memcmp(APTR(1), IID_IConnectionPoint, 16) == 0 && self == state->point) result = state->point;
    else if (iid && memcmp(APTR(1), (const uint8_t *)"\0\0\0\0\0\0\0\0\xc0\0\0\0\0\0\0\x46", 16) == 0) result = state->chat;
    if (!result) { MEM32(out) = 0; RET(E_NOINTERFACE, 3); }
    MEM32(out) = result;
    MEM32(result + 4)++;
    RET(S_OK, 3);
}

static void m_add_ref(void) { RET(++MEM32(A32(0) + 4), 1); }
static void m_release(void) {
    uint32_t self = A32(0), count = MEM32(self + 4);
    if (count > 1) count--;
    MEM32(self + 4) = count;
    RET(count, 1);
}

static void m_find_connection_point(void) {
    uint32_t self = A32(0), iid = A32(1), out = A32(2);
    wol_object *state = object_of(self);
    if (!iid || !out) RET(E_POINTER, 3);
    if (memcmp(APTR(1), state->event_iid, 16) != 0) { MEM32(out) = 0; RET(E_NOINTERFACE, 3); }
    if (!state->point) {
        state->point = hle_com_new(g_point_vt, 12);
        MEM32(state->point + 8) = (uint32_t)(uintptr_t)state;
    }
    MEM32(state->point + 4)++;
    MEM32(out) = state->point;
    RET(S_OK, 3);
}

static void m_get_connection_interface(void) {
    wol_object *state = object_of(A32(0));
    uint32_t out = A32(1);
    if (!out) RET(E_POINTER, 2);
    memcpy(APTR(1), state->event_iid, 16);
    RET(S_OK, 2);
}

static void m_get_connection_container(void) {
    wol_object *state = object_of(A32(0));
    if (!A32(1)) RET(E_POINTER, 2);
    MEM32(A32(1)) = state->container;
    if (state->container) MEM32(state->container + 4)++;
    RET(S_OK, 2);
}

static void m_advise(void) {
    wol_object *state = object_of(A32(0));
    if (!A32(1) || !A32(2)) RET(E_POINTER, 3);
    if (state == &g_channel) invalidate_reports();
    state->sink = A32(1);
    state->cookie = 1;
    MEM32(A32(2)) = state->cookie;
    RET(S_OK, 3);
}

static void m_unadvise(void) {
    wol_object *state = object_of(A32(0));
    if (A32(1) != state->cookie || !state->cookie) RET(0x80040200u, 2);
    if (state == &g_channel) invalidate_reports();
    state->sink = 0;
    state->cookie = 0;
    RET(S_OK, 2);
}

static void m_stub_1(void) { RET(E_NOTIMPL, 1); }
static void m_stub_2(void) { RET(E_NOTIMPL, 2); }
static void m_stub_3(void) { RET(E_NOTIMPL, 3); }
static void m_stub_4(void) { RET(E_NOTIMPL, 4); }
/* WOLAPI's gametype table: the game turns each entry's bitmap name into a
 * gtNN.bmp surface. The browser has no gametype table, and returning
 * E_NOTIMPL left the caller's out parameters uninitialized; the game then fed
 * garbage to BSurface (memory access out of bounds on a later WOL login).
 * Clear every plausible out pointer and report no gametypes. */
static int wol_out_pointer(uint32_t p) { return p >= 0x10000u && p < 0x40000000u; }
static void m_chat_get_gametype_list(void) {
    uint32_t a = A32(1), b = A32(2);
    if (wol_out_pointer(a)) MEM32(a) = 0;
    if (wol_out_pointer(b)) MEM32(b) = 0;
    fprintf(stderr, "[wol] GetGametypeList %08X %08X\n", a, b);
    RET(S_OK, 2);
}
static void m_chat_get_gametype_info(void) {
    uint32_t a[6];
    for (int i = 0; i < 6; i++) {
        a[i] = A32((uint32_t)i + 1);
        if (wol_out_pointer(a[i])) MEM32(a[i]) = 0;
    }
    fprintf(stderr, "[wol] GetGametypeInfo %08X %08X %08X %08X %08X %08X\n",
            a[0], a[1], a[2], a[3], a[4], a[5]);
    RET(E_FAIL, 7);
}
static void m_stub_5(void) { RET(E_NOTIMPL, 5); }
static void m_stub_6(void) { RET(E_NOTIMPL, 6); }
static void m_stub_7(void) { RET(E_NOTIMPL, 7); }
static void m_idle_pump(void) { RET(S_OK, 1); }

static void m_chat_pump(void) { pump_lines(); RET(S_OK, 1); }
static void m_net_pump_pings(void);
static void m_net_pump(void) { pump_lines(); m_net_pump_pings(); RET(S_OK, 1); }
static uint32_t read_be32(const uint8_t *p) {
    return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3];
}
static void m_net_gameres_send(void) {
    const uint8_t *data = APTR(3);
    uint32_t length = A32(4), ptr = A32(3), number = 0;
    size_t heap_size = emscripten_get_heap_size();
    if (!ptr || ptr > heap_size || length < 4 || length > 32768 || length > heap_size - ptr) RET(E_POINTER, 5);
    if (((uint32_t)data[0] << 8 | data[1]) != length || data[2] || data[3]) RET(E_FAIL, 5);
    for (uint32_t at = 4; at < length;) {
        if (length - at < 8) RET(E_FAIL, 5);
        uint32_t size = (uint32_t)data[at + 6] << 8 | data[at + 7];
        uint32_t padded = (size + 3u) & ~3u;
        if (padded > length - at - 8) RET(E_FAIL, 5);
        if (!memcmp(data + at, "IDNO", 4)) {
            if (number || data[at + 4] || data[at + 5] != 6 || size != 4) RET(E_FAIL, 5);
            number = read_be32(data + at + 8);
        }
        at += 8 + padded;
    }
    if (!number) RET(E_FAIL, 5);
    unsigned slot;
    for (slot = 0; slot < 8 && g_reports[slot].id; ++slot) {}
    if (slot == 8) RET(E_FAIL, 5);
    if (!++g_report_id) ++g_report_id;
    uint32_t id = g_report_id;
    g_reports[slot].id = id;
    g_reports[slot].sink = g_channel.sink;
    g_reports[slot].generation = g_report_generation;
    /* The game frees/reuses data after return. This synchronous slice completes
     * before return and HTTP runs asynchronously on the main browser thread. */
    MAIN_THREAD_EM_ASM({
        if (Module.ra2WolReport) Module.ra2WolReport($0, $3, HEAPU8.slice($1, $1 + $2));
        else if (Module.ra2WolReceiveLine) Module.ra2WolReceiveLine("@wolapi gameres " + $0 + " 2147500037");
    }, id, data, length, number);
    RET(S_OK, 5);
}
static void m_chat_game_end(void) {
    /* No score in this notification. Retain STARTG and outstanding submissions. */
    RET(S_OK, 1);
}
static void m_chat_request_server_list(void) {
    g_product_sku = A32(1);
    g_pending_server_list = 1;
    RET(S_OK, 6);
}
static void m_chat_request_connection(void) {
    wol_server *server = (wol_server *)(uintptr_t)A32(1);
    if (!server) RET(E_POINTER, 4);
    invalidate_reports();
    memset(&g_session, 0, sizeof g_session);
    g_connected = g_starting_game = g_creating_channel = g_joining_channel = 0;
    g_connection_pending = 1;
    take_launch_login();
    copy_text(g_login, sizeof g_login, g_launch_nick[0] ? g_launch_nick : server->login);
    copy_text(g_password, sizeof g_password, server->password);
    copy_text(g_nick, sizeof g_nick, g_login);
    if (hle_ws_udp_set_local_ip) hle_ws_udp_set_local_ip(virtual_ip(g_nick));
    browser_start();
    RET(S_OK, 4);
}
static void m_chat_request_channel_list(void) {
    char line[80];
    uint32_t type = A32(1);
    if (type) g_channel_type = type;
    g_channel_list_lobby = type == 0;
    g_channel_count = 0;
    /* Type 0 is the native lobby (channel) list. Ask RA2Web so the game
     * receives each lobby's player count; if the server has no lobby yet,
     * emit_channel_list() exposes the configured one instead. */
    snprintf(line, sizeof line, "list %u %u", type, type);
    browser_send(line);
    RET(S_OK, 3);
}
static void m_chat_request_channel_create(void) {
    wol_channel *channel = (wol_channel *)(uintptr_t)A32(1);
    char line[160], name[48];
    if (!channel) RET(E_POINTER, 2);
    memset(&g_session, 0, sizeof g_session);
    g_starting_game = 0;
    copy_text(name, sizeof name, channel->name);
    if (name[0] != '#') {
        char prefixed[48];
        snprintf(prefixed, sizeof prefixed, "#%s", name);
        copy_text(name, sizeof name, prefixed);
    }
    copy_text(g_current_channel, sizeof g_current_channel, name);
    g_active_channel = *channel;
    g_active_channel.next = 0;
    g_map_player_slots = 0;
    g_requested_player_limit = channel->max_users >= 2 && channel->max_users <= 9
        ? channel->max_users : 4u;
    g_creating_channel = 1;
    g_joining_channel = 0;
    /* The seventh word is the room's tournament value (the Create dialog's Tournament box,
     * Channel +0x14); RA2Web keeps it and lists it back, and the game draws the trophy from it. */
    snprintf(line, sizeof line, "joingame %s 1 %u %u 0 0 %u 0%s%.8s", name,
        g_requested_player_limit,
        (uint32_t)channel->type, channel->tournament ? 1u : 0u,
        channel->key[0] ? " " : "", channel->key);
    browser_send(line);
    RET(S_OK, 2);
}
static void m_chat_request_channel_join(void) {
    wol_channel *channel = (wol_channel *)(uintptr_t)A32(1);
    char line[128], name[48];
    if (!channel) RET(E_POINTER, 2);
    memset(&g_session, 0, sizeof g_session);
    g_starting_game = 0;
    snprintf(name, sizeof name, "%s%s", channel->name[0] == '#' ? "" : "#", channel->name);
    copy_text(g_current_channel, sizeof g_current_channel, name);
    g_active_channel = *channel;
    g_active_channel.next = 0;
    copy_text(g_active_channel.name, sizeof g_active_channel.name, name + 1);
    g_map_player_slots = 0;
    g_requested_player_limit = channel->max_users >= 2 && channel->max_users <= 9
        ? channel->max_users : 8u;
    g_joining_channel = 1;
    g_creating_channel = 0;
    if (strncmp(name, "#Lob_", 5) == 0) snprintf(line, sizeof line, "join %s zotclot9", name);
    else snprintf(line, sizeof line, "joingame %s 0%s%.8s", name, channel->key[0] ? " " : "", channel->key);
    browser_send(line);
    RET(S_OK, 2);
}
static void m_chat_request_channel_leave(void) {
    char line[80];
    int match_room = g_session.game_id[0] && g_current_channel[0] &&
        !strcmp(g_session.channel, g_current_channel);
    if (match_room && g_match_part_held) {
        /* The server already parted us (the PART handler held it): complete
         * the leave from the next pump instead of sending a second part. */
        g_match_part_held = 0;
        g_pending_match_part = 1;
        RET(S_OK, 1);
    }
    if (match_room) g_match_leave_requested = 1;
    if (g_current_channel[0]) {
        snprintf(line, sizeof line, "part %s", g_current_channel);
        browser_send(line);
    }
    RET(S_OK, 1);
}
static void m_chat_request_user_list(void) {
    char line[80];
    if (g_current_channel[0]) {
        snprintf(line, sizeof line, "names %s", g_current_channel);
        browser_send(line);
        g_roster_wanted = 1;
    }
    RET(S_OK, 1);
}
static uint32_t send_chat(const wol_user *user, const void *message, int wide, int private) {
    if (!message || (private && !user)) return E_POINTER;
    if (!private && !g_current_channel[0]) {
        /* The post-match chat is typed into a room the game may already have left. */
        fprintf(stderr, "[wol] chat not sent: no current channel (match room %s, part held %d)\n",
            g_session.game_id[0] ? g_session.channel : "none", g_match_part_held);
        return E_FAIL;
    }
    size_t length = 0;
    for (; length < 1024; length++) {
        uint32_t ch = wide ? ((const uint16_t *)message)[length] : ((const unsigned char *)message)[length];
        if (!ch) break;
        if (ch == '\r' || ch == '\n') return E_FAIL;
    }
    if (length == 1024) return E_FAIL;
    char targets[512] = "";
    size_t used = 0;
    if (private) {
        for (unsigned i = 0; user && i < 32; i++, user = (const wol_user *)(uintptr_t)user->next) {
            if (!user->name[0] || !memchr(user->name, 0, sizeof user->name) || strcspn(user->name, " ,:\r\n") != strlen(user->name)) return E_FAIL;
            int n = snprintf(targets + used, sizeof targets - used, "%s%s", i ? "," : "", user->name);
            if (n < 0 || (size_t)n >= sizeof targets - used) return E_FAIL;
            used += (size_t)n;
        }
        if (user) return E_FAIL;
    } else copy_text(targets, sizeof targets, g_current_channel);
    /* The length and a leading '/' show what the chat box hands on (LB-0); the text itself stays out of the log. */
    uint32_t first = wide ? ((const uint16_t *)message)[0] : ((const unsigned char *)message)[0];
    fprintf(stderr, "[wol] chat sent to %s (%s, %zu chars%s%s, part held %d)\n", targets, private ? "private" : "public",
        length, wide ? " wide" : "", first == '/' ? ", leading /" : "", g_match_part_held);
    char line[WOL_LINE_CAP];
    snprintf(line, sizeof line, "privmsg %s :", targets);
    if (wide) browser_send_unicode(line, message);
    else {
        copy_text(line + strlen(line), sizeof line - strlen(line), message);
        browser_send(line);
    }
    return S_OK;
}
static void m_chat_request_public_message(void) { uint32_t result = send_chat(NULL, ASTR(1), 0, 0); RET(result, 2); }
static void m_chat_request_private_message(void) { uint32_t result = send_chat((const wol_user *)(uintptr_t)A32(1), ASTR(2), 0, 1); RET(result, 3); }
static void m_chat_request_public_unicode_message(void) { uint32_t result = send_chat(NULL, (void *)(uintptr_t)A32(1), 1, 0); RET(result, 2); }
static void m_chat_request_private_unicode_message(void) { uint32_t result = send_chat((const wol_user *)(uintptr_t)A32(1), (void *)(uintptr_t)A32(2), 1, 1); RET(result, 3); }
/* IChat::RequestUnicodePage (API+0xF8): the game's /page, /reply and /r (YR 0x0078A6B0 and
 * 0x0078A8F0, RA2 0x00746480 and 0x007466C0) and the Page dialog. It goes out as a private line,
 * so the other player sees it like any whisper. /r builds a one-name record on its stack and
 * leaves its next field unset, so only the first name is taken. The page-sent sink (ordinal 24,
 * YR 0x007A9800, RA2 0x00762E00) answers from the pump (docs/wol/handoff-wolapi.md, "/r and
 * /reply"). */
static void m_chat_request_unicode_page(void) {
    const wol_user *user = (const wol_user *)(uintptr_t)A32(1);
    if (!user) RET(E_POINTER, 3);
    wol_user one = *user;
    one.next = 0;
    uint32_t result = send_chat(&one, (void *)(uintptr_t)A32(2), 1, 1);
    if (result == S_OK) g_pending_page_sent = 1;
    RET(result, 3);
}
/* The "Logging off" dialog waits for IChatEvent::OnLogout; report it from the pump. */
static void m_chat_request_logout(void) {
    memset(&g_session, 0, sizeof g_session);
    g_connected = g_connection_pending = g_starting_game = 0;
    g_creating_channel = g_joining_channel = 0;
    browser_stop(); g_pending_logout = 1; RET(S_OK, 1);
}
static void m_chat_request_private_game_options(void) {
    const wol_user *user = (const wol_user *)(uintptr_t)A32(1);
    if (!user || !ASTR(2)) RET(E_POINTER, 3);
    for (uint32_t i = 0; user && i < 32; i++, user = (const wol_user *)(uintptr_t)user->next) {
        char line[WOL_LINE_CAP];
        snprintf(line, sizeof line, "gameopt %s :%s", user->name, ASTR(2));
        browser_send(line);
    }
    RET(S_OK, 3);
}
static void m_chat_request_public_game_options(void) {
    char line[WOL_LINE_CAP];
    const char *options = ASTR(1) ? ASTR(1) : "";
    uint32_t map_slots;
    if (game_options_player_slots(options, &map_slots)) {
        g_map_player_slots = map_slots;
        uint32_t limit = effective_player_limit(g_requested_player_limit ? g_requested_player_limit : 8u);
        wol_channel *channel = current_channel();
        int metadata_changed = channel && channel->max_users != limit;
        if (channel && channel->max_users != limit) {
            channel->max_users = limit;
        }
        /* RA2Web enforces MODE +l; apply the map's playable capacity as soon
         * as it is known, even if the native client sends its room limit later. */
        snprintf(line, sizeof line, "mode %s +l%u", g_current_channel, limit);
        browser_send(line);
        if (metadata_changed && channel->ex_info[0]) send_channel_metadata();
    }
    snprintf(line, sizeof line, "gameopt %s :%s", g_current_channel, options);
    browser_send(line);
    RET(S_OK, 2);
}
static void m_chat_request_public_action(void) { RET(S_OK, 2); }
static void m_chat_request_private_action(void) { RET(S_OK, 3); }
static void m_chat_request_game_start(void) {
    const wol_user *user = (const wol_user *)(uintptr_t)A32(1);
    if (!user) RET(E_POINTER, 2);
    if (!g_current_channel[0]) RET(E_FAIL, 2);
    char line[512];
    size_t used = (size_t)snprintf(line, sizeof line, "startg %s ", g_current_channel);
    for (uint32_t i = 0; user && i < 32; i++, user = (const wol_user *)(uintptr_t)user->next) {
        if (!user->name[0] || !memchr(user->name, '\0', sizeof user->name)) RET(E_FAIL, 2);
        int length = snprintf(line + used, sizeof line - used, "%s%s", i ? "," : "", user->name);
        if (length < 0 || (size_t)length >= sizeof line - used) RET(E_FAIL, 2);
        used += (size_t)length;
    }
    if (user) RET(E_FAIL, 2); /* Reject a cyclic/oversized list rather than start a partial roster. */
    memset(&g_session, 0, sizeof g_session);
    g_starting_game = 1;
    browser_send(line);
    RET(S_OK, 2);
}
static void m_chat_request_channel_topic(void) {
    wol_channel *channel = current_channel();
    if (!channel || !ASTR(1)) RET(E_POINTER, 2);
    copy_text(channel->topic, sizeof channel->topic, ASTR(1));
    send_channel_metadata();
    RET(S_OK, 2);
}
static void m_chat_set_channel_ex_info(void) {
    wol_channel *channel = current_channel();
    if (!channel || !ASTR(1)) RET(E_POINTER, 2);
    copy_text(channel->ex_info, sizeof channel->ex_info, ASTR(1));
    /* A seat for an observer changes the limit the game asked for before this ex-info. */
    if (g_requested_player_limit) {
        uint32_t limit = effective_player_limit(g_requested_player_limit);
        if (channel->max_users != limit) {
            char mode[96];
            channel->max_users = limit;
            snprintf(mode, sizeof mode, "mode %s +l%u", g_current_channel, limit);
            browser_send(mode);
        }
    }
    send_channel_metadata();
    RET(S_OK, 2);
}

/* The game turns a ping into IPX timing as ping * 60 / 1000 ticks, which must be at least 1. */
#define WOL_MIN_PATH_PING_MS 17

/* The game's estimate of the path to a peer: our round trip to RA2Web plus theirs.
 * -1 when either is not measured yet or the peer is not in the roster. The game
 * reads 1000 as "no answer", so a real 1000 ms is reported as 1001. */
static int32_t path_ping_ms(uint32_t ip) {
    int32_t own = -1, peer = -1;
    for (uint32_t i = 0; i < g_user_count; i++) {
        if (g_users[i].flags & 0x8000u) own = g_user_ping[i];
        if (g_users[i].ipaddr == ip) peer = g_user_ping[i];
    }
    if (own < 0 || peer < 0) return -1;
    int32_t total = own + peer;
    return total < WOL_MIN_PATH_PING_MS ? WOL_MIN_PATH_PING_MS : total == 1000 ? 1001 : total;
}

static void m_net_get_avg_ping(void) {
    if (!A32(2)) RET(E_POINTER, 3);
    int32_t ping = path_ping_ms(A32(1));
    MEM32(A32(2)) = (uint32_t)ping;
    RET(ping < 0 ? E_FAIL : S_OK, 3);
}

/* RequestPing results wait for NetUtil's own PumpMessages, which reports each one
 * through INetUtilEvent::OnPing (slot 3). The answer is the path ping at pump time. */
static struct { uint32_t ip, handle; } g_pings[32];
static uint32_t g_ping_count, g_ping_handle;

/* A dotted IPv4 quad in network byte order, the order of wol_user.ipaddr; 0 if malformed. */
static uint32_t parse_host_ip(const char *host) {
    uint8_t octets[4];
    for (unsigned i = 0; i < 4; i++) {
        if (i && *host++ != '.') return 0;
        unsigned value = 0, digits = 0;
        for (; *host >= '0' && *host <= '9' && digits < 4; host++, digits++)
            value = value * 10u + (unsigned)(*host - '0');
        if (!digits || digits > 3 || value > 255) return 0;
        octets[i] = (uint8_t)value;
    }
    if (*host) return 0;
    uint32_t ip;
    memcpy(&ip, octets, sizeof ip);
    return ip;
}

/* RequestPing(host, timeout, int *handle): the type library's host is a string. */
static void m_net_request_ping(void) {
    if (!ASTR(1) || !A32(3)) RET(E_POINTER, 4);
    if (g_ping_count >= sizeof g_pings / sizeof g_pings[0]) RET(E_FAIL, 4);
    g_ping_handle = g_ping_handle % 0x7fffffffu + 1u; /* a positive int: 1, 2, ... */
    g_pings[g_ping_count].ip = parse_host_ip(ASTR(1));
    g_pings[g_ping_count++].handle = g_ping_handle;
    MEM32(A32(3)) = g_ping_handle;
    RET(S_OK, 4);
}

static void m_net_pump_pings(void) {
    /* OnPing may ask for another ping; that one waits for the next pump. */
    uint32_t count = g_ping_count;
    struct { uint32_t ip, handle; } pings[sizeof g_pings / sizeof g_pings[0]];
    memcpy(pings, g_pings, count * sizeof pings[0]);
    g_ping_count = 0;
    for (uint32_t i = 0; i < count; i++) {
        uint32_t sink = g_channel.sink;
        if (!sink) continue;
        int32_t time = pings[i].ip ? path_ping_ms(pings[i].ip) : -1; /* 0: the host did not parse */
        uint32_t args[] = { sink, time < 0 ? E_FAIL : S_OK, (uint32_t)time, pings[i].ip, pings[i].handle };
        hle_call_guest(MEM32(MEM32(sink) + 3u * 4u), 5, args); /* INetUtilEvent::OnPing */
    }
}

/* IChat is IUnknown followed by the 64 methods from the embedded type library. */
static void m_chat_get_version(void) {
    if (!A32(1)) RET(E_POINTER, 2);
    MEM32(A32(1)) = 0x10010;
    RET(S_OK, 2);
}
/* The lobby's Help control asks WOLAPI for a URL, then hands it to the game's
 * own URL routine. The server has none, so give it the seeded support page:
 * web_url_patches maps that to the page dialog like every other game link. */
static const char g_help_url[] = "https://ra2web.invalid/support/help.html";
static void m_chat_get_help_url(void) {
    if (!A32(1)) RET(E_POINTER, 2);
    MEM32(A32(1)) = (uint32_t)(uintptr_t)g_help_url;
    RET(S_OK, 2);
}
static void m_chat_set_value(void) {
    copy_text(g_attribute_name, sizeof g_attribute_name, ASTR(1));
    copy_text(g_attribute_value, sizeof g_attribute_value, ASTR(2));
    RET(S_OK, 3);
}
static void m_chat_profile_value(void) { g_product_sku = A32(1); RET(S_OK, 2); }
static void m_chat_get_nick(void) {
    uint32_t slot = A32(1);
    if (!A32(2) || !A32(3)) RET(E_POINTER, 4);
    MEM32(A32(2)) = MEM32(A32(3)) = 0;
    take_launch_login();
    if (slot >= 11 || !g_saved_nicks[slot].nick[0]) RET(1, 4);
    MEM32(A32(2)) = (uint32_t)(uintptr_t)g_saved_nicks[slot].nick;
    MEM32(A32(3)) = (uint32_t)(uintptr_t)g_saved_nicks[slot].password;
    RET(S_OK, 4);
}
static void m_chat_set_nick(void) {
    uint32_t slot = A32(1);
    if (slot >= 11) RET(E_FAIL, 5);
    copy_text(g_saved_nicks[slot].nick, sizeof g_saved_nicks[slot].nick, ASTR(2));
    copy_text(g_saved_nicks[slot].password, sizeof g_saved_nicks[slot].password, ASTR(3));
    RET(S_OK, 5);
}
static void m_chat_get_lobby_count(void) { if (A32(1)) MEM32(A32(1)) = 1; RET(S_OK, 2); }
static void m_chat_get_locale_count(void) {
    if (!A32(1)) RET(E_POINTER, 2);
    MEM32(A32(1)) = sizeof g_locales / sizeof g_locales[0];
    RET(S_OK, 2);
}
static void m_chat_get_locale_string(void) {
    if (!A32(1)) RET(E_POINTER, 3);
    uint32_t locale = A32(2);
    MEM32(A32(1)) = locale < sizeof g_locales / sizeof g_locales[0]
        ? (uint32_t)(uintptr_t)g_locales[locale].name : 0;
    RET(locale < sizeof g_locales / sizeof g_locales[0] ? S_OK : E_FAIL, 3);
}
static void m_chat_request_user_locale(void) {
    const wol_user *user = (const wol_user *)(uintptr_t)A32(1);
    if (!user) RET(E_POINTER, 2);
    g_locale_user = *user;
    g_locale_user.next = 0;
    char line[64];
    snprintf(line, sizeof line, "getlocale %s", g_locale_user.name);
    browser_send(line);
    RET(S_OK, 2);
}
/* WolChat::RequestSquadInfo(id): 0 asks for the user's own squad. The answer is OnSquadInfo, always: the game
 * counts its requests and refills the player list when the last one is answered. */
static void m_chat_request_squad_info(void) {
    uint32_t id = A32(1);
    if (g_squad_pending_count == WOL_SQUAD_PENDING) RET(E_FAIL, 2);
    int sent = 0;
    for (uint32_t i = 0; i < g_squad_pending_count; i++)
        if (g_squad_pending[i] == id && g_squad_sent[i]) sent = 1;
    squad_entry *cached = id ? squad_find(id) : NULL;
    g_squad_pending[g_squad_pending_count] = id;
    g_squad_sent[g_squad_pending_count] = 0;
    if (!cached && !sent) {
        char line[32];
        snprintf(line, sizeof line, "squadinfo %u", (unsigned)id);
        browser_send(line);
        g_squad_sent[g_squad_pending_count] = 1;
    }
    g_squad_pending_count++;
    RET(S_OK, 2);
}
static void m_chat_raw_message(void) {
    const char *line = ASTR(1);
    if (line) {
        /* The native setup changes capacity with raw MODE +l after creation.
         * RA2Web expects the IRC form +lN; the game sends +l N. Clamp that
         * limit to the selected map's playable slots and keep LIST metadata in
         * step with what the server enforces. */
        char command[8], name[48], mode[8], extra;
        unsigned limit;
        if (sscanf(line, "%7s %47s %7s %u %c", command, name, mode, &limit, &extra) == 4 &&
            (!strcmp(command, "mode") || !strcmp(command, "MODE")) &&
            !strcmp(name, g_current_channel) && !strcmp(mode, "+l") && limit >= 2 && limit <= 9) {
            g_requested_player_limit = limit;
            limit = effective_player_limit(limit);
            wol_channel *channel = current_channel();
            int metadata_changed = channel && channel->max_users != limit;
            if (channel && channel->max_users != limit) {
                channel->max_users = limit;
            }
            char normalized[96];
            snprintf(normalized, sizeof normalized, "mode %s +l%u", name, limit);
            browser_send(normalized);
            if (metadata_changed && channel->ex_info[0]) send_channel_metadata();
        } else {
            browser_send(line);
        }
    }
    RET(S_OK, 2);
}
static void m_chat_get_attribute_value(void) {
    if (A32(2)) MEM32(A32(2)) = strcmp(ASTR(1) ? ASTR(1) : "", g_attribute_name) == 0
        ? (uint32_t)(uintptr_t)g_attribute_value : 0;
    RET(S_OK, 3);
}

/* Buddies and Find: each call sends one line and answers S_OK; the answer is an event from the pump
 * (buddy_list_end, buddy_change_reply, find_reply). RequestBuddyAdd/Delete/Find take a User* whose name is at +0x24. */
static int buddy_user_name(uint32_t pointer, char *name, size_t capacity) {
    const wol_user *user = (const wol_user *)(uintptr_t)pointer;
    if (!user) return 0;
    copy_text(name, capacity, user->name);
    if (!name[0]) return 0;
    for (const char *c = name; *c; c++) if ((unsigned char)*c <= ' ') return 0; /* a space would split the line */
    return 1;
}
static void m_chat_request_buddy_list(void) { browser_send("buddylist"); RET(S_OK, 1); }
static void m_chat_request_buddy_add(void) {
    char name[sizeof ((wol_user *)0)->name], line[48];
    if (!A32(1)) RET(E_POINTER, 2);
    if (!buddy_user_name(A32(1), name, sizeof name)) RET(E_FAIL, 2);
    snprintf(line, sizeof line, "buddyadd %s", name);
    browser_send(line);
    RET(S_OK, 2);
}
static void m_chat_request_buddy_delete(void) {
    char name[sizeof ((wol_user *)0)->name], line[48];
    if (!A32(1)) RET(E_POINTER, 2);
    if (!buddy_user_name(A32(1), name, sizeof name)) RET(E_FAIL, 2);
    snprintf(line, sizeof line, "buddydel %s", name);
    browser_send(line);
    RET(S_OK, 2);
}
/* WolChat::RequestFind(User*): the Buddy List asks for each buddy in turn, `/on <nick>` for one. */
static void m_chat_request_find(void) {
    char name[sizeof ((wol_user *)0)->name], line[48];
    if (!A32(1)) RET(E_POINTER, 2);
    if (!buddy_user_name(A32(1), name, sizeof name)) RET(E_FAIL, 2);
    if (g_find_pending_count == WOL_FIND_PENDING) { /* answers lost: forget the oldest */
        memmove(g_find_pending[0], g_find_pending[1], (WOL_FIND_PENDING - 1u) * sizeof g_find_pending[0]);
        g_find_pending_count--;
    }
    copy_text(g_find_pending[g_find_pending_count++], sizeof g_find_pending[0], name);
    snprintf(line, sizeof line, "find %s", name);
    browser_send(line);
    RET(S_OK, 2);
}
/* WolChat::SetFindPage(find, page): whether others may find this player and page them. */
static void m_chat_set_find_page(void) {
    char line[32];
    snprintf(line, sizeof line, "setfind %d %d", A32(1) != 0, A32(2) != 0);
    browser_send(line);
    RET(S_OK, 3);
}

#define CHAT_METHODS \
    { "WolChat::QueryInterface", m_query_interface }, { "WolChat::AddRef", m_add_ref }, { "WolChat::Release", m_release }, \
    { "WolChat::PumpMessages", m_chat_pump }, \
    { "WolChat::RequestServerList", m_chat_request_server_list }, { "WolChat::RequestConnection", m_chat_request_connection }, \
    { "WolChat::RequestChannelList", m_chat_request_channel_list }, { "WolChat::RequestChannelCreate", m_chat_request_channel_create }, \
    { "WolChat::RequestChannelJoin", m_chat_request_channel_join }, { "WolChat::RequestChannelLeave", m_chat_request_channel_leave }, \
    { "WolChat::RequestUserList", m_chat_request_user_list }, { "WolChat::RequestPublicMessage", m_chat_request_public_message }, \
    { "WolChat::RequestPrivateMessage", m_chat_request_private_message }, { "WolChat::RequestLogout", m_chat_request_logout }, \
    { "WolChat::RequestPrivateGameOptions", m_chat_request_private_game_options }, { "WolChat::RequestPublicGameOptions", m_chat_request_public_game_options }, \
    { "WolChat::RequestPublicAction", m_chat_request_public_action }, { "WolChat::RequestPrivateAction", m_chat_request_private_action }, \
    { "WolChat::RequestGameStart", m_chat_request_game_start }, { "WolChat::RequestChannelTopic", m_chat_request_channel_topic }, \
    { "WolChat::GetVersion", m_chat_get_version }, { "WolChat::RequestUserKick", m_stub_2 }, { "WolChat::RequestUserIP", m_stub_2 }, \
    { "WolChat::GetGametypeInfo", m_chat_get_gametype_info }, { "WolChat::RequestFind", m_chat_request_find }, { "WolChat::RequestPage", m_stub_3 }, \
    { "WolChat::SetFindPage", m_chat_set_find_page }, { "WolChat::SetSquelch", m_stub_3 }, { "WolChat::GetSquelch", m_stub_2 }, \
    { "WolChat::SetChannelFilter", m_stub_2 }, { "WolChat::RequestGameEnd", m_chat_game_end }, { "WolChat::SetLangFilter", m_stub_2 }, \
    { "WolChat::RequestChannelBan", m_stub_3 }, { "WolChat::GetGametypeList", m_chat_get_gametype_list }, { "WolChat::GetHelpURL", m_chat_get_help_url }, \
    { "WolChat::SetProductSKU", m_chat_profile_value }, { "WolChat::GetNick", m_chat_get_nick }, { "WolChat::SetNick", m_chat_set_nick }, \
    { "WolChat::GetLobbyCount", m_chat_get_lobby_count }, { "WolChat::RequestRawMessage", m_chat_raw_message }, \
    { "WolChat::GetAttributeValue", m_chat_get_attribute_value }, { "WolChat::SetAttributeValue", m_chat_set_value }, \
    { "WolChat::SetChannelExInfo", m_chat_set_channel_ex_info }, { "WolChat::StopAutoping", m_stub_1 }, { "WolChat::RequestSquadInfo", m_chat_request_squad_info }, \
    { "WolChat::RequestSetTeam", m_stub_2 }, { "WolChat::RequestSetLocale", m_stub_2 }, { "WolChat::RequestUserLocale", m_chat_request_user_locale }, \
    { "WolChat::RequestUserTeam", m_stub_2 }, { "WolChat::GetNickLocale", m_stub_3 }, { "WolChat::SetNickLocale", m_stub_3 }, \
    { "WolChat::GetLocaleString", m_chat_get_locale_string }, { "WolChat::GetLocaleCount", m_chat_get_locale_count }, { "WolChat::SetClientVersion", m_stub_2 }, \
    { "WolChat::SetCodepageFilter", m_stub_2 }, { "WolChat::RequestBuddyList", m_chat_request_buddy_list }, { "WolChat::RequestBuddyAdd", m_chat_request_buddy_add }, \
    { "WolChat::RequestBuddyDelete", m_chat_request_buddy_delete }, { "WolChat::RequestPublicUnicodeMessage", m_chat_request_public_unicode_message }, \
    { "WolChat::RequestPrivateUnicodeMessage", m_chat_request_private_unicode_message }, { "WolChat::RequestPublicUnicodeAction", m_stub_2 }, \
    { "WolChat::RequestPrivateUnicodeAction", m_stub_3 }, { "WolChat::RequestUnicodePage", m_chat_request_unicode_page }, \
    { "WolChat::RequestSetPlayerCount", m_stub_3 }, { "WolChat::RequestServerTime", m_stub_1 }, \
    { "WolChat::RequestInsiderStatus", m_stub_2 }, { "WolChat::RequestSetLocalIP", m_stub_1 }

#define SMALL_METHODS(prefix) \
    { prefix "::QueryInterface", m_query_interface }, { prefix "::AddRef", m_add_ref }, { prefix "::Release", m_release }, \
    { prefix "::Enum", m_stub_2 }, { prefix "::FindConnectionPoint", m_find_connection_point }

static uint32_t create_object(wol_object *state, uint32_t primary_vt, const uint8_t *iid, uint32_t *out) {
    if (!out) return E_POINTER;
    *out = 0;
    if (!iid || (memcmp(iid, state->primary_iid, 16) && memcmp(iid, IID_IConnectionPointContainer, 16)))
        return E_NOINTERFACE;
    if (!state->chat) {
        state->chat = hle_com_new(primary_vt, 12);
        state->container = hle_com_new(g_container_vt, 12);
        MEM32(state->chat + 8) = (uint32_t)(uintptr_t)state;
        MEM32(state->container + 8) = (uint32_t)(uintptr_t)state;
    }
    *out = memcmp(iid, IID_IConnectionPointContainer, 16) == 0 ? state->container : state->chat;
    return S_OK;
}

/* "YuriBOT: hello" rather than the game's "YuriBOT : hello": the received-line formats
 * (public "[%hs] : %s", private "%hs : %s", UTF-16 in the image's data; YR 0x0084AFB0 and
 * 0x0084AFC8, RA2 0x007FE064 and 0x007FE07C) lose the space before the colon, once, when the
 * game first makes its chat object. Each is changed only while it reads exactly as shipped
 * (docs/wol/handoff-wolapi.md, "Lines without the bot's name"). */
static void tighten_chat_formats(void) {
#ifdef RA2_TARGET_GAME
    static const uint32_t at[] = { 0x007FE064u, 0x007FE07Cu };
#else
    static const uint32_t at[] = { 0x0084AFB0u, 0x0084AFC8u };
#endif
    static const char *const shipped[] = { "[%hs] : %s", "%hs : %s" };
    for (unsigned k = 0; k < 2; k++) {
        uint16_t *format = (uint16_t *)(uintptr_t)at[k];
        size_t n = 0, space = 0;
        for (; shipped[k][n]; n++) {
            if (format[n] != (uint8_t)shipped[k][n]) break;
            if (shipped[k][n] == ' ' && shipped[k][n + 1] == ':') space = n;
        }
        if (shipped[k][n] || format[n] || !space) continue;
        memmove(format + space, format + space + 1, (n - space) * sizeof *format);
    }
}

static uint32_t create_chat(const uint8_t *iid, uint32_t *out) {
    static const win32hle_shim methods[] = { CHAT_METHODS, { 0, 0 } };
    tighten_chat_formats();
    if (!g_chat_vt) g_chat_vt = hle_com_vtable(methods);
    return create_object(&g_chat, g_chat_vt, iid, out);
}

static uint32_t create_channel(const uint8_t *iid, uint32_t *out) {
    static const win32hle_shim methods[] = {
        { "WolChannel::QueryInterface", m_query_interface }, { "WolChannel::AddRef", m_add_ref }, { "WolChannel::Release", m_release },
        { "WolChannel::RequestGameresSend", m_net_gameres_send }, { "WolChannel::RequestLadderSearch", m_net_ladder_search },
        { "WolChannel::RequestLadderList", m_net_ladder_list }, { "WolChannel::RequestPing", m_net_request_ping },
        { "WolChannel::PumpMessages", m_net_pump },
        { "WolChannel::GetAvgPing", m_net_get_avg_ping }, { "WolChannel::RequestNewNick", m_stub_7 },
        { "WolChannel::RequestAgeCheck", m_stub_5 }, { "WolChannel::RequestWDTState", m_stub_4 },
        { "WolChannel::RequestLocaleLadderList", m_net_ladder_list_locale }, { "WolChannel::RequestLocaleLadderSearch", m_net_ladder_search_locale },
        { "WolChannel::RequestHighscore", m_net_highscore }, { 0, 0 }
    };
    if (!g_channel_vt) g_channel_vt = hle_com_vtable(methods);
    return create_object(&g_channel, g_channel_vt, iid, out);
}

static uint32_t create_profile(const uint8_t *iid, uint32_t *out) {
    static const win32hle_shim methods[] = {
        { "WolProfile::QueryInterface", m_query_interface }, { "WolProfile::AddRef", m_add_ref }, { "WolProfile::Release", m_release },
        { "WolProfile::DownloadFile", m_stub_7 }, { "WolProfile::Abort", m_stub_1 },
        { "WolProfile::PumpMessages", m_idle_pump }, { 0, 0 }
    };
    if (!g_profile_vt) g_profile_vt = hle_com_vtable(methods);
    return create_object(&g_profile, g_profile_vt, iid, out);
}

void ra2_wolapi_register(void) {
    static const win32hle_shim container_methods[] = {
        SMALL_METHODS("WolContainer"), { 0, 0 }
    };
    static const win32hle_shim point_methods[] = {
        { "WolPoint::QueryInterface", m_query_interface }, { "WolPoint::AddRef", m_add_ref }, { "WolPoint::Release", m_release },
        { "WolPoint::GetConnectionInterface", m_get_connection_interface },
        { "WolPoint::GetConnectionPointContainer", m_get_connection_container },
        { "WolPoint::Advise", m_advise }, { "WolPoint::Unadvise", m_unadvise }, { "WolPoint::EnumConnections", m_stub_2 }, { 0, 0 }
    };
    if (!g_container_vt) g_container_vt = hle_com_vtable(container_methods);
    if (!g_point_vt) g_point_vt = hle_com_vtable(point_methods);
    hle_com_register_class(CLSID_WOL_CHAT, create_chat);
    hle_com_register_class(CLSID_WOL_CHANNEL, create_channel);
    hle_com_register_class(CLSID_WOL_PROFILE, create_profile);
}
