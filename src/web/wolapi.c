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
#include <stdio.h>
#include <emscripten.h>

#include "win32hle.h"
#include "wolapi.h"

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

#define WOL_LINE_CAP 4096u
#define WOL_LINE_COUNT 128u
static char g_lines[WOL_LINE_COUNT][WOL_LINE_CAP];
static volatile uint32_t g_line_write, g_line_read;
static wol_server g_server;
static wol_server g_server_entry;
static wol_channel g_channels[64];
static wol_channel g_lobby, g_active_channel;
static wol_user g_users[32];
static wol_user g_locale_user;
static uint32_t g_channel_count, g_user_count, g_channel_type = 45;
static uint32_t g_pending_server_list;
static uint32_t g_pending_channel_list;
static uint32_t g_pending_logout;
static uint32_t g_creating_channel;
static char g_login[64], g_password[64], g_nick[32], g_current_channel[48];
static struct { char nick[10], password[10]; } g_saved_nicks[11];
static char g_attribute_name[64], g_attribute_value[256];
/* The MOTD arrives (375/372.../376) before the bridge reports the connection;
 * hold it so the game sees OnConnection first, as it would from the real service. */
static char g_motd[1024];
static uint32_t g_motd_ready;
static uint32_t g_product_sku;
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

static void emit_server_list(void) {
    memset(&g_server, 0, sizeof g_server);
    g_server.gametype = (int32_t)g_product_sku;
    g_server.chattype = (int32_t)g_channel_type;
    copy_text(g_server.name, sizeof g_server.name, "-1:Automatic");
    copy_text(g_server.connlabel, sizeof g_server.connlabel, "IRC");
    copy_text(g_server.conndata, sizeof g_server.conndata, "TCP;127.0.0.1;19090");
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
    for (uint32_t i = 0; i < g_channel_count; i++)
        g_channels[i].next = i + 1 < g_channel_count ? (uint32_t)(uintptr_t)&g_channels[i + 1] : 0;
    uint32_t values[] = { S_OK, g_channel_count ? (uint32_t)(uintptr_t)&g_channels[0] : 0 };
    event_call(5, 2, values); /* IChatEvent::OnChannelList */
}

static wol_channel *current_channel(void);

static void emit_user_list(void) {
    for (uint32_t i = 0; i < g_user_count; i++)
        g_users[i].next = i + 1 < g_user_count ? (uint32_t)(uintptr_t)&g_users[i + 1] : 0;
    wol_channel *channel = current_channel();
    uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)channel,
        g_user_count ? (uint32_t)(uintptr_t)&g_users[0] : 0 };
    event_call(12, 3, values); /* IChatEvent::OnUserList */
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
static void read_channel_metadata(wol_channel *channel, const char *text) {
    channel->ex_info[0] = '\0';
    if (strncmp(text, "WOLAPI1:", 8) == 0) {
        const char *end = strstr(text + 8, "::");
        if (end) {
            size_t length = (size_t)(end - (text + 8));
            if (length >= sizeof channel->ex_info) length = sizeof channel->ex_info - 1;
            memcpy(channel->ex_info, text + 8, length);
            channel->ex_info[length] = '\0';
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
        snprintf(line, sizeof line, "topic %s :WOLAPI1:%s::%s", g_current_channel, channel->ex_info, channel->topic);
    else snprintf(line, sizeof line, "topic %s :%s", g_current_channel, channel->topic);
    browser_send(line);
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

static void parse_roster(const char *line) {
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
        wol_user *user = &g_users[g_user_count++];
        memset(user, 0, sizeof *user);
        copy_text(user->name, sizeof user->name, name);
        user->flags = flags | (strcmp(name, g_nick) == 0 ? 0x8000u : 0u);
    }
    emit_user_list();
}

static wol_user *user_for_name(const char *name) {
    if (!name || !*name) name = g_nick;
    for (uint32_t i = 0; i < g_user_count; i++)
        if (strcmp(g_users[i].name, name) == 0) return &g_users[i];
    if (g_user_count >= sizeof g_users / sizeof g_users[0]) return NULL;
    wol_user *user = &g_users[g_user_count++];
    memset(user, 0, sizeof *user);
    copy_text(user->name, sizeof user->name, name);
    user->flags = strcmp(name, g_nick) == 0 ? 0x8000u : 0u;
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

static void handle_line(const char *line) {
    if (strcmp(line, "@wolapi connected") == 0) {
        /* The native screen prints OnConnection's `motd` argument in the chat box;
         * it does not show anything delivered through OnMessageOfTheDay. */
        emit_connection(S_OK, g_motd_ready ? g_motd : "Connected to RA2Web");
        g_motd_ready = 0;
        return;
    }
    if (is_numeric_reply(line, "375") || is_numeric_reply(line, "372") || is_numeric_reply(line, "376")) {
        collect_motd(line);
        return;
    }
    if (strncmp(line, "@wolapi error ", 14) == 0) {
        emit_connection(E_FAIL, line + 14);
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
        wol_channel *channel = current_channel();
        wol_user *user = sender_user(line);
        char leaving[48];
        copy_text(leaving, sizeof leaving, g_current_channel);
        uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)channel, (uint32_t)(uintptr_t)user };
        event_call(8, 3, values); /* IChatEvent::OnChannelLeave */
        if (user && (user->flags & 0x8000u) && strcmp(leaving, g_current_channel) == 0)
            g_current_channel[0] = '\0';
        return;
    }
    if (strstr(line, " JOINGAME ")) {
        const char *name = strrchr(line, ':');
        wol_user *user = sender_user(line);
        if (name && user && (user->flags & 0x8000u))
            copy_text(g_current_channel, sizeof g_current_channel, name + 1);
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
        uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)channel, (uint32_t)(uintptr_t)user };
        event_call(7, 3, values); /* IChatEvent::OnChannelJoin */
        return;
    }
    if (strstr(line, " GAMEOPT ")) {
        const char *options = strstr(line, " :");
        wol_channel *channel = current_channel();
        wol_user *user = sender_user(line);
        const char *target = strstr(line, " GAMEOPT ") + 9;
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
        wol_channel *channel = current_channel();
        uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)channel,
            g_user_count ? (uint32_t)(uintptr_t)&g_users[0] : 0, 1 };
        event_call(20, 4, values); /* IChatEvent::OnGameStart */
    }
}

static void pump_lines(void) {
    if (g_pending_server_list) {
        g_pending_server_list = 0;
        emit_server_list();
        /* RA2/YR wait for both the list and the directory connection status. */
        uint32_t status[] = { 0x0004012fu }; /* directory connection closed after listing */
        event_call(16, 1, status); /* IChatEvent::OnNetStatus */
    }
    if (g_pending_channel_list) {
        g_pending_channel_list = 0;
        /* RA2Web creates global lobbies on JOIN and only lists game rooms.
         * Expose this configured lobby through the native directory interface. */
        memset(&g_lobby, 0, sizeof g_lobby);
        snprintf(g_lobby.name, sizeof g_lobby.name, "Lob_%u_0", g_channel_type);
        copy_text(g_lobby.topic, sizeof g_lobby.topic, "RA2Web");
        g_lobby.max_users = 100;
        g_lobby.official = 1;
        uint32_t values[] = { S_OK, (uint32_t)(uintptr_t)&g_lobby };
        event_call(5, 2, values);
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
        g_user_count = 0;
        g_channel_count = 0;
        g_motd_ready = 0;
    }
    uint32_t read = __atomic_load_n(&g_line_read, __ATOMIC_RELAXED);
    for (;;) {
        uint32_t write = __atomic_load_n(&g_line_write, __ATOMIC_ACQUIRE);
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
    state->sink = A32(1);
    state->cookie = 1;
    MEM32(A32(2)) = state->cookie;
    RET(S_OK, 3);
}

static void m_unadvise(void) {
    wol_object *state = object_of(A32(0));
    if (A32(1) != state->cookie || !state->cookie) RET(0x80040200u, 2);
    state->sink = 0;
    state->cookie = 0;
    RET(S_OK, 2);
}

static void m_stub_1(void) { RET(E_NOTIMPL, 1); }
static void m_stub_2(void) { RET(E_NOTIMPL, 2); }
static void m_stub_3(void) { RET(E_NOTIMPL, 3); }
static void m_stub_4(void) { RET(E_NOTIMPL, 4); }
static void m_stub_5(void) { RET(E_NOTIMPL, 5); }
static void m_stub_6(void) { RET(E_NOTIMPL, 6); }
static void m_stub_7(void) { RET(E_NOTIMPL, 7); }
static void m_stub_8(void) { RET(E_NOTIMPL, 8); }
static void m_stub_9(void) { RET(E_NOTIMPL, 9); }
static void m_stub_10(void) { RET(E_NOTIMPL, 10); }
static void m_stub_11(void) { RET(E_NOTIMPL, 11); }
static void m_idle_pump(void) { RET(S_OK, 1); }

static void m_chat_pump(void) { pump_lines(); RET(S_OK, 1); }
static void m_chat_request_server_list(void) {
    g_product_sku = A32(1);
    g_pending_server_list = 1;
    RET(S_OK, 6);
}
static void m_chat_request_connection(void) {
    wol_server *server = (wol_server *)(uintptr_t)A32(1);
    if (!server) RET(E_POINTER, 4);
    copy_text(g_login, sizeof g_login, server->login);
    copy_text(g_password, sizeof g_password, server->password);
    copy_text(g_nick, sizeof g_nick, g_login);
    browser_start();
    RET(S_OK, 4);
}
static void m_chat_request_channel_list(void) {
    char line[80];
    if (!A32(1)) { g_pending_channel_list = 1; RET(S_OK, 3); }
    g_channel_type = A32(1);
    g_channel_count = 0;
    snprintf(line, sizeof line, "list %u %u", g_channel_type, g_channel_type);
    browser_send(line);
    RET(S_OK, 3);
}
static void m_chat_request_channel_create(void) {
    wol_channel *channel = (wol_channel *)(uintptr_t)A32(1);
    char line[160], name[48];
    if (!channel) RET(E_POINTER, 2);
    copy_text(name, sizeof name, channel->name);
    if (name[0] != '#') {
        char prefixed[48];
        snprintf(prefixed, sizeof prefixed, "#%s", name);
        copy_text(name, sizeof name, prefixed);
    }
    copy_text(g_current_channel, sizeof g_current_channel, name);
    g_active_channel = *channel;
    g_active_channel.next = 0;
    g_creating_channel = 1;
    snprintf(line, sizeof line, "joingame %s 1 %u %u 0 0 0 0", name,
        channel->max_users >= 2 && channel->max_users <= 8 ? channel->max_users : 4u,
        (uint32_t)channel->type);
    browser_send(line);
    RET(S_OK, 2);
}
static void m_chat_request_channel_join(void) {
    wol_channel *channel = (wol_channel *)(uintptr_t)A32(1);
    char line[128], name[48];
    if (!channel) RET(E_POINTER, 2);
    snprintf(name, sizeof name, "%s%s", channel->name[0] == '#' ? "" : "#", channel->name);
    copy_text(g_current_channel, sizeof g_current_channel, name);
    if (strncmp(name, "#Lob_", 5) == 0) snprintf(line, sizeof line, "join %s zotclot9", name);
    else snprintf(line, sizeof line, "joingame %s 0", name);
    browser_send(line);
    RET(S_OK, 2);
}
static void m_chat_request_channel_leave(void) {
    char line[80];
    if (g_current_channel[0]) {
        snprintf(line, sizeof line, "part %s", g_current_channel);
        browser_send(line);
    }
    RET(S_OK, 1);
}
static void m_chat_request_user_list(void) {
    char line[80];
    if (g_current_channel[0]) { snprintf(line, sizeof line, "names %s", g_current_channel); browser_send(line); }
    RET(S_OK, 1);
}
static void m_chat_request_public_message(void) {
    char line[600];
    snprintf(line, sizeof line, "privmsg %s :%s", g_current_channel, ASTR(1) ? ASTR(1) : "");
    browser_send(line);
    RET(S_OK, 2);
}
static void m_chat_request_private_message(void) { RET(S_OK, 3); }
/* The "Logging off" dialog waits for IChatEvent::OnLogout; report it from the pump. */
static void m_chat_request_logout(void) {
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
    snprintf(line, sizeof line, "gameopt %s :%s", g_current_channel, ASTR(1) ? ASTR(1) : "");
    browser_send(line);
    RET(S_OK, 2);
}
static void m_chat_request_public_action(void) { RET(S_OK, 2); }
static void m_chat_request_private_action(void) { RET(S_OK, 3); }
static void m_chat_request_game_start(void) {
    char line[128];
    snprintf(line, sizeof line, "startg %s %s", g_current_channel, g_nick);
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
    send_channel_metadata();
    RET(S_OK, 2);
}

static void m_net_get_avg_ping(void) {
    if (!A32(2)) RET(E_POINTER, 3);
    MEM32(A32(2)) = 0xffffffffu; /* No native UDP measurement is available in this browser adapter. */
    RET(E_FAIL, 3);
}

/* IChat is IUnknown followed by the 64 methods from the embedded type library. */
static void m_chat_get_version(void) {
    if (!A32(1)) RET(E_POINTER, 2);
    MEM32(A32(1)) = 0x10010;
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
static void m_chat_raw_message(void) { if (ASTR(1)) browser_send(ASTR(1)); RET(S_OK, 2); }
static void m_chat_get_attribute_value(void) {
    if (A32(2)) MEM32(A32(2)) = strcmp(ASTR(1) ? ASTR(1) : "", g_attribute_name) == 0
        ? (uint32_t)(uintptr_t)g_attribute_value : 0;
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
    { "WolChat::GetGametypeInfo", m_stub_7 }, { "WolChat::RequestFind", m_stub_2 }, { "WolChat::RequestPage", m_stub_3 }, \
    { "WolChat::SetFindPage", m_stub_3 }, { "WolChat::SetSquelch", m_stub_3 }, { "WolChat::GetSquelch", m_stub_2 }, \
    { "WolChat::SetChannelFilter", m_stub_2 }, { "WolChat::RequestGameEnd", m_stub_1 }, { "WolChat::SetLangFilter", m_stub_2 }, \
    { "WolChat::RequestChannelBan", m_stub_3 }, { "WolChat::GetGametypeList", m_stub_2 }, { "WolChat::GetHelpURL", m_stub_2 }, \
    { "WolChat::SetProductSKU", m_chat_profile_value }, { "WolChat::GetNick", m_chat_get_nick }, { "WolChat::SetNick", m_chat_set_nick }, \
    { "WolChat::GetLobbyCount", m_chat_get_lobby_count }, { "WolChat::RequestRawMessage", m_chat_raw_message }, \
    { "WolChat::GetAttributeValue", m_chat_get_attribute_value }, { "WolChat::SetAttributeValue", m_chat_set_value }, \
    { "WolChat::SetChannelExInfo", m_chat_set_channel_ex_info }, { "WolChat::StopAutoping", m_stub_1 }, { "WolChat::RequestSquadInfo", m_stub_2 }, \
    { "WolChat::RequestSetTeam", m_stub_2 }, { "WolChat::RequestSetLocale", m_stub_2 }, { "WolChat::RequestUserLocale", m_chat_request_user_locale }, \
    { "WolChat::RequestUserTeam", m_stub_2 }, { "WolChat::GetNickLocale", m_stub_3 }, { "WolChat::SetNickLocale", m_stub_3 }, \
    { "WolChat::GetLocaleString", m_chat_get_locale_string }, { "WolChat::GetLocaleCount", m_chat_get_locale_count }, { "WolChat::SetClientVersion", m_stub_2 }, \
    { "WolChat::SetCodepageFilter", m_stub_2 }, { "WolChat::RequestBuddyList", m_stub_1 }, { "WolChat::RequestBuddyAdd", m_stub_2 }, \
    { "WolChat::RequestBuddyDelete", m_stub_2 }, { "WolChat::RequestPublicUnicodeMessage", m_stub_2 }, \
    { "WolChat::RequestPrivateUnicodeMessage", m_stub_3 }, { "WolChat::RequestPublicUnicodeAction", m_stub_2 }, \
    { "WolChat::RequestPrivateUnicodeAction", m_stub_3 }, { "WolChat::RequestUnicodePage", m_stub_3 }, \
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

static uint32_t create_chat(const uint8_t *iid, uint32_t *out) {
    static const win32hle_shim methods[] = { CHAT_METHODS, { 0, 0 } };
    if (!g_chat_vt) g_chat_vt = hle_com_vtable(methods);
    return create_object(&g_chat, g_chat_vt, iid, out);
}

static uint32_t create_channel(const uint8_t *iid, uint32_t *out) {
    static const win32hle_shim methods[] = {
        { "WolChannel::QueryInterface", m_query_interface }, { "WolChannel::AddRef", m_add_ref }, { "WolChannel::Release", m_release },
        { "WolChannel::RequestGameresSend", m_stub_5 }, { "WolChannel::RequestLadderSearch", m_stub_10 },
        { "WolChannel::RequestLadderList", m_stub_8 }, { "WolChannel::RequestPing", m_stub_4 },
        { "WolChannel::PumpMessages", m_idle_pump },
        { "WolChannel::GetAvgPing", m_net_get_avg_ping }, { "WolChannel::RequestNewNick", m_stub_7 },
        { "WolChannel::RequestAgeCheck", m_stub_5 }, { "WolChannel::RequestWDTState", m_stub_4 },
        { "WolChannel::RequestLocaleLadderList", m_stub_9 }, { "WolChannel::RequestLocaleLadderSearch", m_stub_11 },
        { "WolChannel::RequestHighscore", m_stub_5 }, { 0, 0 }
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
