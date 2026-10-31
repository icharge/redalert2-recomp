/* Run the real WOLAPI shims with a small x86 COM caller under Emscripten/Node.
 * This checks the external COM ABI and protocol callbacks without game assets.
 * See docs/web/testing.md for the build command.
 */
#include <assert.h>
#include "wolapi.c"

uint32_t g_eax, g_esp;
int win32hle_trace;
static recomp_func_t test_methods[512];
static uint32_t test_method_count;
static struct { uint8_t clsid[16]; uint32_t (*create)(const uint8_t *, uint32_t *); } test_classes[3];
static uint32_t test_class_count;
static uint32_t test_event_count, test_event_method[128], test_event_args[128][8];
static char test_event_text[128][4096];
static uint16_t test_event_wide[128][4096];
static uint32_t test_retry_results, test_retry_args[4];
static uint32_t invoke(uint32_t object, unsigned slot, int count, const uint32_t *args);

uint32_t hle_com_vtable(const win32hle_shim *methods) {
    uint32_t count = 0;
    while (methods[count].name) count++;
    uint32_t *vtable = calloc(count, sizeof *vtable);
    for (uint32_t i = 0; i < count; i++) {
        assert(test_method_count < 512);
        test_methods[test_method_count++] = methods[i].fn;
        vtable[i] = test_method_count;
    }
    return (uint32_t)(uintptr_t)vtable;
}
uint32_t hle_com_new(uint32_t vtable, uint32_t size) {
    uint32_t *object = calloc(1, size);
    object[0] = vtable;
    object[1] = 1;
    return (uint32_t)(uintptr_t)object;
}
void hle_com_register_class(const uint8_t *clsid, uint32_t (*create)(const uint8_t *, uint32_t *)) {
    assert(test_class_count < 3);
    memcpy(test_classes[test_class_count].clsid, clsid, 16);
    test_classes[test_class_count++].create = create;
}
uint32_t hle_call_guest(uint32_t method, int count, const uint32_t *args) {
    if (method >= 0x10000) {
        assert(test_event_count < 128 && count <= 8);
        test_event_method[test_event_count] = method;
        if (method == 0x10016 || method == 0x10015)
            copy_text(test_event_text[test_event_count], 4096, (char *)(uintptr_t)args[method == 0x10016 ? 4 : 3]);
        if (method == 0x10006)
            copy_text(test_event_text[test_event_count], 4096, (char *)(uintptr_t)args[2]);
        if (method == 0x10028 || method == 0x10029) {
            const uint16_t *text = (const uint16_t *)(uintptr_t)args[method == 0x10028 ? 4 : 3];
            for (unsigned i = 0; i < 4095 && text[i]; i++) test_event_wide[test_event_count][i] = text[i];
        }
        memcpy(test_event_args[test_event_count++], args, count * sizeof *args);
        if (method == 0x20005 && test_retry_results) {
            --test_retry_results;
            assert(invoke(g_channel.chat, 3, 4, test_retry_args) == S_OK);
            uint32_t retry_id = EM_ASM_INT({ return Module.testResult.id; });
            char retry_line[96]; snprintf(retry_line, sizeof retry_line, "@wolapi gameres %u %u", retry_id, E_FAIL);
            ra2_wolapi_receive_line(retry_line);
        }
        return S_OK;
    }
    uint32_t stack[32] = { 0 };
    assert(count < 31 && method > 0 && method <= test_method_count);
    memcpy(stack + 1, args, count * sizeof *args);
    uint32_t saved_stack = g_esp;
    g_esp = (uint32_t)(uintptr_t)stack;
    test_methods[method - 1]();
    assert(g_esp == (uint32_t)(uintptr_t)(stack + count + 1));
    uint32_t result = g_eax;
    g_esp = saved_stack;
    return result;
}
static uint32_t invoke(uint32_t object, unsigned slot, int count, const uint32_t *args) {
    uint32_t values[16] = { object };
    assert(count < 15);
    if (count) memcpy(values + 1, args, count * sizeof *args);
    return hle_call_guest(MEM32(MEM32(object) + slot * 4), count + 1, values);
}

int main(void) {
    /* Canonical Windows COM identities, independent of the implementation. */
    const uint8_t container_iid[16] = { 0x84,0xb2,0x96,0xb1,0xb4,0xba,0x1a,0x10,0xb6,0x9c,0,0xaa,0,0x34,0x1d,7 };
    const uint8_t point_iid[16] = { 0x86,0xb2,0x96,0xb1,0xb4,0xba,0x1a,0x10,0xb6,0x9c,0,0xaa,0,0x34,0x1d,7 };
    ra2_wolapi_register();
    assert(test_class_count == 3);
    for (uint32_t i = 0; i < test_class_count; i++) {
        wol_object *state = i == 0 ? &g_chat : i == 1 ? &g_channel : &g_profile;
        uint32_t object = 0, container = 0, point = 0, queried = 0;
        assert(test_classes[i].create(state->primary_iid, &object) == S_OK);
        uint32_t query[] = { (uint32_t)(uintptr_t)container_iid, (uint32_t)(uintptr_t)&container };
        assert(invoke(object, 0, 2, query) == S_OK && container != 0);
        uint32_t find[] = { (uint32_t)(uintptr_t)state->event_iid, (uint32_t)(uintptr_t)&point };
        assert(invoke(container, 4, 2, find) == S_OK && point != 0);
        uint32_t query_point[] = { (uint32_t)(uintptr_t)point_iid, (uint32_t)(uintptr_t)&queried };
        assert(invoke(point, 0, 2, query_point) == S_OK && queried == point);
    }
    uint32_t version = 0;
    uint32_t version_args[] = { (uint32_t)(uintptr_t)&version };
    assert(invoke(g_chat.chat, 20, 1, version_args) == S_OK && version >= 0x10010);
    assert(invoke(g_channel.chat, 7, 0, NULL) == S_OK);
    assert(invoke(g_profile.chat, 5, 0, NULL) == S_OK);
    emit_server_list();
    assert(strcmp(g_server.connlabel, "IRC") == 0);
    assert(g_server.next != 0); /* native menu reserves directory row zero */
    assert(strstr(((wol_server *)(uintptr_t)g_server.next)->name, ":RA2Web") != NULL);
    assert(strcmp(g_server.conndata, "TCP;127.0.0.1;19090") == 0);
    wol_server login_server = { 0 };
    strcpy(login_server.login, "testuser");
    strcpy(login_server.password, "testpass");
    uint32_t connect_args[] = { (uint32_t)(uintptr_t)&login_server, 30, 0 };
    assert(invoke(g_chat.chat, 5, 3, connect_args) == S_OK);
    assert(strcmp(g_login, "testuser") == 0 && strcmp(g_nick, "testuser") == 0);
    assert(strcmp(g_password, "testpass") == 0);
    uint32_t save_nick[] = { 1, (uint32_t)(uintptr_t)"savednick", (uint32_t)(uintptr_t)"savedpwd", 0 };
    assert(invoke(g_chat.chat, 37, 4, save_nick) == S_OK);
    uint32_t nick = 0, password = 0;
    uint32_t get_nick[] = { 1, (uint32_t)(uintptr_t)&nick, (uint32_t)(uintptr_t)&password };
    assert(invoke(g_chat.chat, 36, 3, get_nick) == S_OK);
    assert(strcmp((char *)(uintptr_t)nick, "savednick") == 0);
    assert(strcmp((char *)(uintptr_t)password, "savedpwd") == 0);
    get_nick[0] = 2;
    assert(invoke(g_chat.chat, 36, 3, get_nick) != S_OK && nick == 0 && password == 0);
    uint32_t sink_vt[48], sink[3], cookie;
    for (uint32_t slot = 0; slot < 48; slot++) sink_vt[slot] = 0x10000 + slot;
    sink[0] = (uint32_t)(uintptr_t)sink_vt;
    uint32_t advise[] = { (uint32_t)(uintptr_t)sink, (uint32_t)(uintptr_t)&cookie };
    assert(invoke(g_chat.point, 5, 2, advise) == S_OK);
    /* RA2 requests an untyped directory before ever specifying its game type.
     * It rejects the result unless its lobby name starts with Lob_33_. */
    EM_ASM({ Module.ra2WolSend = line => { Module.testWolLine = line; }; });
    char expected_lobby[16];
    snprintf(expected_lobby, sizeof expected_lobby, "Lob_%u_0", (unsigned)WOL_LOBBY_TYPE);
    uint32_t initial_lobby_args[] = { 0, 0 };
    assert(invoke(g_chat.chat, 6, 2, initial_lobby_args) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolLine === "list 0 0"; }));
    /* A lobby already in use is reported by the server with its player count. */
    ra2_wolapi_receive_line(":wol-ra2web 321 testuser 0 :Channel Users Name");
    char listed_lobby[96];
    snprintf(listed_lobby, sizeof listed_lobby,
             ":wol-ra2web 322 testuser #Lob_%u_0 2 0 0 0 0 0 0:: :0", (unsigned)WOL_LOBBY_TYPE);
    ra2_wolapi_receive_line(listed_lobby);
    ra2_wolapi_receive_line(":wol-ra2web 323 testuser 0 :End of /LIST");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == 1 && test_event_method[0] == 0x10008);
    wol_channel *initial_lobby = (wol_channel *)(uintptr_t)test_event_args[0][2];
    assert(strcmp(initial_lobby->name, expected_lobby) == 0);
    assert(initial_lobby->current_users == 2);
    /* Servers without a live lobby still get the configured one, so the game
     * can find and join it (RA2Web creates lobbies on JOIN). */
    test_event_count = 0;
    assert(invoke(g_chat.chat, 6, 2, initial_lobby_args) == S_OK);
    ra2_wolapi_receive_line(":wol-ra2web 321 testuser 0 :Channel Users Name");
    ra2_wolapi_receive_line(":wol-ra2web 323 testuser 0 :End of /LIST");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == 1 && test_event_method[0] == 0x10008);
    initial_lobby = (wol_channel *)(uintptr_t)test_event_args[0][2];
    assert(strcmp(initial_lobby->name, expected_lobby) == 0);
    test_event_count = 0;
    uint32_t discover[] = { 45, 0x10001, (uint32_t)(uintptr_t)"TibSun", (uint32_t)(uintptr_t)"TibPass99", 30 };
    assert(invoke(g_chat.chat, 4, 5, discover) == S_OK);
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == 2);
    assert(test_event_method[0] == 0x10003 && test_event_method[1] == 0x10013);
    assert(test_event_args[1][1] == 0x4012f);
    /* Login is followed by RequestUserLocale; the native menu waits for slot 33. */
    wol_user local_user = { 0 };
    strcpy(local_user.name, "testuser");
    uint32_t locale_args[] = { (uint32_t)(uintptr_t)&local_user };
    EM_ASM({ Module.ra2WolSend = line => { Module.testWolLine = line; }; });
    assert(invoke(g_chat.chat, 47, 1, locale_args) == S_OK);
    ra2_wolapi_receive_line(":wol-ra2web 309 testuser testuser :0`en-US");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == 3 && test_event_method[2] == 0x10021);
    wol_user *locale_user = (wol_user *)(uintptr_t)test_event_args[2][2];
    assert(strcmp(locale_user->name, "testuser") == 0 && locale_user->locale == 2);
    uint32_t locale_count = 0, locale_string = 0;
    uint32_t count_args[] = { (uint32_t)(uintptr_t)&locale_count };
    assert(invoke(g_chat.chat, 52, 1, count_args) == S_OK && locale_count == 38);
    uint32_t string_args[] = { (uint32_t)(uintptr_t)&locale_string, 28 };
    assert(invoke(g_chat.chat, 51, 2, string_args) == S_OK);
    assert(strcmp((char *)(uintptr_t)locale_string, "Thailand") == 0);
    uint32_t game_list_args[] = { 41, 1 }, lobby_list_args[] = { 0, 0 };
    assert(invoke(g_chat.chat, 6, 2, game_list_args) == S_OK);
    assert(invoke(g_chat.chat, 6, 2, lobby_list_args) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolLine === "list 0 0"; }));
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == 3); /* every LIST now waits for the server's reply */
    ra2_wolapi_receive_line(":wol 321 testuser 0 :Channel Users Name");
    ra2_wolapi_receive_line(":wol 323 testuser 0 :End of /LIST");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == 4 && test_event_method[3] == 0x10008);
    wol_channel *lobby = (wol_channel *)(uintptr_t)test_event_args[3][2];
    assert(lobby && lobby->type == 0 && strcmp(lobby->name, expected_lobby) == 0);
    uint32_t join_args[] = { (uint32_t)(uintptr_t)lobby };
    assert(invoke(g_chat.chat, 8, 1, join_args) == S_OK);
    snprintf(listed_lobby, sizeof listed_lobby, "join #Lob_%u_0 zotclot9", (unsigned)WOL_LOBBY_TYPE);
    assert(EM_ASM_INT({ return Module.testWolLine === UTF8ToString($0); }, (uint32_t)(uintptr_t)listed_lobby));
    char lobby_channel[24], lobby_line[96];
    snprintf(lobby_channel, sizeof lobby_channel, "#Lob_%u_0", (unsigned)WOL_LOBBY_TYPE);
    snprintf(lobby_line, sizeof lobby_line, ":testuser!local JOIN :0,0,0,1 %s", lobby_channel);
    ra2_wolapi_receive_line(lobby_line);
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_method[4] == 0x1000a);
    wol_user *joined = (wol_user *)(uintptr_t)test_event_args[4][3];
    assert(joined->flags & 0x8000); /* native OnChannelJoin distinguishes our own join */
    assert(strcmp(((wol_channel *)(uintptr_t)test_event_args[4][2])->name, expected_lobby) == 0);
    snprintf(lobby_line, sizeof lobby_line, ":wol 353 testuser = %s :@testuser,0,1,1 other,0,0,1", lobby_channel);
    ra2_wolapi_receive_line(lobby_line);
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(g_user_count == 2 && strcmp(g_users[1].name, "other") == 0);
    assert((g_users[0].flags & 0x8001) == 0x8001);
    (void)user_for_name("other");
    assert(strcmp(g_users[0].name, "testuser") == 0);
    assert(invoke(g_chat.chat, 9, 0, NULL) == S_OK);
    snprintf(lobby_line, sizeof lobby_line, ":testuser!local PART %s", lobby_channel);
    ra2_wolapi_receive_line(lobby_line);
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == 7 && test_event_method[6] == 0x1000b);
    assert(strcmp(((wol_channel *)(uintptr_t)test_event_args[6][2])->name, expected_lobby) == 0);
    assert(!g_current_channel[0]);
    wol_channel room = { .type = 41, .min_users = 1, .max_users = 4, .reserved = 0x600, .flags = 128 };
    strcpy(room.name, "testuser");
    strcpy(room.key, "locked");
    uint32_t create_args[] = { (uint32_t)(uintptr_t)&room };
    assert(invoke(g_chat.chat, 7, 1, create_args) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolLine === "joingame #testuser 1 4 41 0 0 0 0 locked"; }));
    ra2_wolapi_receive_line(":testuser!local JOINGAME 0 0 0 0 0 1 0 :#testuser");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == 8 && test_event_method[7] == 0x10009);
    assert(((wol_channel *)(uintptr_t)test_event_args[7][2])->type == 41);
    /* STARTG tickets are sent only to the listed players, including guests. */
    wol_user start_users[2] = { 0 };
    strcpy(start_users[0].name, "testuser");
    strcpy(start_users[1].name, "other");
    start_users[0].next = (uint32_t)(uintptr_t)&start_users[1];
    uint32_t start_args[] = { (uint32_t)(uintptr_t)&start_users[0] };
    assert(invoke(g_chat.chat, 18, 1, start_args) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolLine === "startg #testuser testuser,other"; }));
    start_users[1].next = (uint32_t)(uintptr_t)&start_users[0];
    assert(invoke(g_chat.chat, 18, 1, start_args) == E_FAIL);
    assert(EM_ASM_INT({ return Module.testWolLine === "startg #testuser testuser,other"; }));
    start_users[1].next = 0;
    start_args[0] = 0;
    assert(invoke(g_chat.chat, 18, 1, start_args) == E_POINTER);
    const char binary_options[] = "test,\x80\xca\xff,end";
    uint32_t options_args[] = { (uint32_t)(uintptr_t)binary_options };
    assert(invoke(g_chat.chat, 15, 1, options_args) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolLine.endsWith("test," + String.fromCharCode(128,202,255) + ",end"); }));
    uint32_t room_list[] = { 41, 1 };
    assert(invoke(g_chat.chat, 6, 2, room_list) == S_OK);
    ra2_wolapi_receive_line(":wol 322 testuser #host's_game 1 0 41 0 0 12 0::roomtopic :0");
    ra2_wolapi_receive_line(":wol 323 testuser 41 :End of /LIST");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(g_channel_count == 1 && strcmp(g_channels[0].name, "host's_game") == 0);
    assert(g_channels[0].max_users >= 2 && g_channels[0].latency == 12);
    assert(strcmp(g_channels[0].topic, "roomtopic") == 0);
    ra2_wolapi_receive_line(":other!local GAMEOPT #testuser :test,\x80\xca\xff,end");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_method[9] == 0x10016);
    assert(strcmp(((wol_user *)(uintptr_t)test_event_args[9][3])->name, "other") == 0);
    assert(strcmp(test_event_text[9], binary_options) == 0);
    ra2_wolapi_receive_line(":other!local GAMEOPT testuser :privateopts");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_method[10] == 0x10015);
    uint32_t info_args[] = { (uint32_t)(uintptr_t)"65552,1234,0,8,0," };
    assert(invoke(g_chat.chat, 42, 1, info_args) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolLine.includes("WOLAPI2:1536,1,4,128;65552,1234,0,8,0,::"); }));
    g_channel_count = 0;
    parse_room_line(":wol 322 testuser #host's_game 1 0 41 0 0 12 0::WOLAPI1:65552,1234,0,8,0,::mapname :0");
    assert(strcmp(g_channels[0].ex_info, "65552,1234,0,8,0,") == 0);
    wol_channel protected_room = { .flags = 384, .max_users = 8 };
    read_channel_metadata(&protected_room, "WOLAPI2:0,1,6,0;25,123,0,0,0,MAP::");
    assert(protected_room.flags == 384); /* server password/private mode survives native extras */
    assert(strcmp(g_channels[0].topic, "mapname") == 0);
    const uint32_t resolution_flags[] = { 0x200u, 0x400u };
    for (unsigned i = 0; i < sizeof resolution_flags / sizeof resolution_flags[0]; i++) {
        uint32_t flags = 128u | resolution_flags[i];
        wol_channel online_room = { .type = 41, .min_users = 1, .max_users = 4,
                                    .reserved = 0x600, .flags = flags };
        strcpy(online_room.name, "testuser");
        uint32_t online_create[] = { (uint32_t)(uintptr_t)&online_room };
        assert(invoke(g_chat.chat, 7, 1, online_create) == S_OK);
        assert(invoke(g_chat.chat, 42, 1, info_args) == S_OK);
        char metadata_line[96];
        snprintf(metadata_line, sizeof metadata_line, "WOLAPI2:1536,1,4,%u;", flags);
        assert(EM_ASM_INT({ return Module.testWolLine.includes(UTF8ToString($0)); },
                          (uint32_t)(uintptr_t)metadata_line));
        char listed_room[256];
        snprintf(listed_room, sizeof listed_room,
                 ":wol 322 testuser #host's_game 1 0 41 0 0 12 0::WOLAPI2:1536,1,4,%u;"
                 "65552,1234,0,8,0,::mapname :0", flags);
        g_channel_count = 0;
        parse_room_line(listed_room);
        assert(g_channel_count == 1 && g_channels[0].flags == flags);
    }
    g_channel_count = 0;
    parse_room_line(":wol 322 testuser #host's_game 1 0 41 0 0 12 0::WOLAPI2:1536,1,7,128;65552,1234,0,8,0,::mapname :0");
    assert(g_channels[0].reserved == 0x600 && g_channels[0].min_users == 1);
    assert(g_channels[0].max_users == 7 && g_channels[0].flags == 128);
    assert(g_channels[0].current_users == 1);
    assert(strcmp(g_channels[0].ex_info, "65552,1234,0,8,0,") == 0);
    wol_channel selected = g_channels[0];
    selected.next = 0x12345678;
    strcpy(selected.key, "secret");
    uint32_t selected_join[] = { (uint32_t)(uintptr_t)&selected };
    assert(invoke(g_chat.chat, 8, 1, selected_join) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolLine === "joingame #host's_game 0 secret"; }));
    assert(current_channel()->reserved == 0x600 && current_channel()->max_users == 7);
    assert(current_channel()->flags == 128 && current_channel()->next == 0);
    const char *bad_metadata[] = {
        "WOLAPI2:4294967296,1,7,128;info::map",
        "WOLAPI2:0,8,7,128;info::map",
        "WOLAPI2:0,1,99,128;info::map",
        "WOLAPI2:0,1,7,-1;info::map",
        "WOLAPI2:0,1,7,128;missing-terminator"
    };
    for (unsigned i = 0; i < sizeof bad_metadata / sizeof bad_metadata[0]; i++) {
        wol_channel invalid = { .max_users = 8 };
        read_channel_metadata(&invalid, bad_metadata[i]);
        assert(invalid.max_users == 8 && invalid.reserved == 0 && invalid.flags == 0);
        assert(!invalid.ex_info[0]);
    }
    /* Return to our original room for the following handoff tests. */
    selected_join[0] = (uint32_t)(uintptr_t)&room;
    assert(invoke(g_chat.chat, 8, 1, selected_join) == S_OK);
    assert(invoke(g_chat.chat, 42, 1, info_args) == S_OK);
    uint32_t limit_args[] = { (uint32_t)(uintptr_t)"mode #testuser +l 6" };
    assert(invoke(g_chat.chat, 39, 1, limit_args) == S_OK);
    assert(current_channel()->max_users == 6);
    assert(EM_ASM_INT({ return Module.testWolLine.includes("WOLAPI2:1536,1,6,128;"); }));
    assert(EM_ASM_INT({ return !Module.testWolLine.includes("locked"); }));
    /* Native OnChannelJoin has distinct HRESULT branches for these failures. */
    const struct { const char *reply; uint32_t status; } join_errors[] = {
        { ":wol 475 testuser #testuser :bad key", 0x80040071u },
        { ":wol 471 testuser #testuser :full", 0x8004006eu },
        { ":wol 478 testuser #testuser :closed", 0x80040070u },
        { ":wol 474 testuser #testuser :banned", 0x80040072u }
    };
    for (unsigned i = 0; i < sizeof join_errors / sizeof join_errors[0]; i++) {
        uint32_t before = test_event_count;
        assert(invoke(g_chat.chat, 8, 1, selected_join) == S_OK);
        ra2_wolapi_receive_line(join_errors[i].reply);
        assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
        assert(test_event_count == before + 1 && test_event_method[before] == 0x1000a);
        assert(test_event_args[before][1] == join_errors[i].status);
        assert(!g_current_channel[0]);
    }
    uint32_t before_create_error = test_event_count;
    assert(invoke(g_chat.chat, 7, 1, create_args) == S_OK);
    ra2_wolapi_receive_line(":wol 711 testuser #elsewhere :unrelated creation failure");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == before_create_error);
    ra2_wolapi_receive_line(":wol 711 testuser #testuser :duplicate game");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == before_create_error + 1 && test_event_method[before_create_error] == 0x10009);
    assert(test_event_args[before_create_error][1] == E_FAIL && !g_current_channel[0]);
    assert(invoke(g_chat.chat, 8, 1, selected_join) == S_OK);
    ra2_wolapi_receive_line(":testuser!local JOINGAME 0 0 0 0 0 1 0 :#testuser");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    uint32_t events_before_start = test_event_count;
    ra2_wolapi_receive_line(":wol STARTG #testuser :ws://127.0.0.1:19090/gserv :g42-example 1792844361 test-ticket");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == events_before_start + 1);
    assert(test_event_method[events_before_start] == 0x10017);
    assert(test_event_args[events_before_start][4] == 42); /* server's instance counter, not a fixed 1 */
    const ra2_wolapi_session *session = ra2_wolapi_current_session();
    assert(session && strcmp(session->game_id, "g42-example") == 0);
    assert(strcmp(session->gserv_url, "ws://127.0.0.1:19090/gserv") == 0);
    assert(strcmp(session->ticket, "test-ticket") == 0 && session->timestamp == 1792844361u);
    ra2_wolapi_receive_line(":wol STARTG #other :ws://127.0.0.1:19090/gserv :g43-example 1792844361 wrong-room");
    ra2_wolapi_receive_line(":wol STARTG #testuser :ws://127.0.0.1:19090/gserv :broken");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == events_before_start + 1);
    /* The host leaves WOL while the guest still waits for NET_GO over UDP.
     * Its identity must survive the lobby PART/NAMES replies after STARTG. */
    uint32_t match_users = g_user_count, match_events = test_event_count;
    ra2_wolapi_receive_line(":other!local PART #testuser");
    ra2_wolapi_receive_line(":wol 353 testuser = #testuser :@testuser,0,1,1");
    ra2_wolapi_receive_line(":wol 353 testuser = #unrelated :outsider,0,1,1");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == match_events && g_user_count == match_users);
    ra2_wolapi_receive_line(":testuser!local PART #testuser");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == match_events + 1 && !g_current_channel[0]);
    assert(g_session.game_id[0]); /* Keep the gameplay patches running after leaving WOL. */
    assert(invoke(g_chat.chat, 8, 1, selected_join) == S_OK);
    assert(!g_session.game_id[0]); /* A new lobby/room ends the previous match's roster lock. */
    ra2_wolapi_receive_line(":testuser!local JOINGAME 0 0 0 0 0 1 0 :#testuser");
    ra2_wolapi_receive_line(":wol 353 testuser = #testuser :@testuser,0,1,1 other,0,1,1");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(g_user_count == 2 && test_event_count == match_events + 3);
    /* The MOTD is held until the connection event, then passed as OnConnection's motd text. */
    uint32_t events_before_motd = test_event_count;
    ra2_wolapi_receive_line(":wol-ra2web 375 testuser :- wol-ra2web MOTD");
    ra2_wolapi_receive_line(":wol-ra2web 372 testuser :- Welcome");
    ra2_wolapi_receive_line(":wol-ra2web 372 testuser :- Have fun");
    ra2_wolapi_receive_line(":wol-ra2web 376 testuser :- End of /MOTD command.");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == events_before_motd);
    ra2_wolapi_receive_line("@wolapi connected");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == events_before_motd + 1);
    assert(test_event_method[events_before_motd] == 0x10006);
    assert(strcmp(test_event_text[events_before_motd], "Welcome\nHave fun") == 0);
    /* Chat uses the real Unicode callbacks without putting whisper senders in the roster. */
    uint32_t before_chat = test_event_count, before_users = g_user_count;
    ra2_wolapi_receive_line(":other!local PRIVMSG #testuser :hello world");
    ra2_wolapi_receive_line(":stranger!local PRIVMSG testuser :\xe0\xb8\xaa\xe0\xb8\xa7\xe0\xb8\xb1\xe0\xb8\xaa\xe0\xb8\x94\xe0\xb8\xb5");
    ra2_wolapi_receive_line(":other!local PRIVMSG #elsewhere :ignore");
    ra2_wolapi_receive_line(":stranger!local PRIVMSG another :ignore");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == before_chat + 2 && g_user_count == before_users);
    assert(test_event_method[before_chat] == 0x10028);
    assert(test_event_wide[before_chat][0] == 'h' && test_event_wide[before_chat][10] == 'd');
    assert(test_event_method[before_chat + 1] == 0x10029);
    assert(test_event_wide[before_chat + 1][0] == 0x0e2a && test_event_wide[before_chat + 1][5] == 0x0e35);
    wol_user recipient = { 0 };
    strcpy(recipient.name, "other");
    uint32_t whisper_args[] = { (uint32_t)(uintptr_t)&recipient, (uint32_t)(uintptr_t)"hi there" };
    assert(invoke(g_chat.chat, 12, 2, whisper_args) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolLine === "privmsg other :hi there"; }));
    uint16_t greeting[] = { 'h', 'i', ' ', 0x0e2a, 0 };
    uint32_t wide_args[] = { (uint32_t)(uintptr_t)greeting };
    assert(invoke(g_chat.chat, 58, 1, wide_args) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolLine === "privmsg #testuser :hi \u0e2a"; }));
    uint32_t wide_private[] = { (uint32_t)(uintptr_t)&recipient, (uint32_t)(uintptr_t)greeting };
    assert(invoke(g_chat.chat, 59, 2, wide_private) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolLine === "privmsg other :hi \u0e2a"; }));
    recipient.next = (uint32_t)(uintptr_t)&recipient;
    assert(invoke(g_chat.chat, 12, 2, whisper_args) == E_FAIL);
    recipient.next = 0;
    whisper_args[1] = (uint32_t)(uintptr_t)"hello\r\npart #testuser";
    assert(invoke(g_chat.chat, 12, 2, whisper_args) == E_FAIL);
    /* An aborted pending start must clear the previous ticket and notify the native wait. */
    start_args[0] = (uint32_t)(uintptr_t)&start_users[0];
    assert(invoke(g_chat.chat, 18, 1, start_args) == S_OK);
    assert(ra2_wolapi_current_session() == NULL);
    uint32_t before_abort = test_event_count;
    ra2_wolapi_receive_line(":wol STARTG_ABORT #elsewhere :2");
    ra2_wolapi_receive_line(":wol STARTG_ABORT #testuser :2");
    ra2_wolapi_receive_line(":wol STARTG_ABORT #testuser :2");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == before_abort + 1 && test_event_method[before_abort] == 0x10017);
    assert(test_event_args[before_abort][1] == E_FAIL && test_event_args[before_abort][4] == 0);
    /* RequestLogout completes through OnLogout(status, user); the "Logging off" dialog waits for it. */
    uint32_t events_before_logout = test_event_count;
    EM_ASM({ Module.ra2WolStop = () => { Module.testWolStopped = true; }; });
    assert(invoke(g_chat.chat, 13, 0, NULL) == S_OK);
    assert(ra2_wolapi_current_session() == NULL);
    assert(test_event_count == events_before_logout);
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolStopped === true; }));
    /* OnLogout, then the OnNetStatus that signals the game's "Logging off" wait event. */
    assert(test_event_count == events_before_logout + 2);
    assert(test_event_method[events_before_logout] == 0x10014);
    assert(test_event_args[events_before_logout][1] == S_OK);
    assert(strcmp(((wol_user *)(uintptr_t)test_event_args[events_before_logout][2])->name, "testuser") == 0);
    {   /* the relay's address for this nick: NativeRelay.ts nativeVirtualIp("testuser") = 10.195.82.18 */
        const uint8_t expected[4] = { 10, 195, 82, 18 };
        assert(memcmp(&((wol_user *)(uintptr_t)test_event_args[events_before_logout][2])->ipaddr, expected, 4) == 0);
    }
    assert(test_event_method[events_before_logout + 1] == 0x10013);
    ra2_wolapi_receive_line("@wolapi connected");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    strcpy(g_current_channel, "#testuser");
    g_session.game_id[0] = 'g';
    strcpy(g_session.channel, g_current_channel);
    uint32_t before_disconnect = test_event_count;
    ra2_wolapi_receive_line("@wolapi disconnected");
    ra2_wolapi_receive_line("@wolapi disconnected");
    ra2_wolapi_receive_line("@wolapi error WOL connection is not open.");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == before_disconnect + 1);
    assert(test_event_method[before_disconnect] == 0x10013 && test_event_args[before_disconnect][1] == 0x4012f);
    assert(!g_current_channel[0] && !g_user_count && ra2_wolapi_current_session() == NULL);
    assert(invoke(g_chat.chat, 5, 3, connect_args) == S_OK);
    uint32_t before_login_failure = test_event_count;
    ra2_wolapi_receive_line("@wolapi error Login failed");
    ra2_wolapi_receive_line("@wolapi error Duplicate error");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == before_login_failure + 1 && test_event_method[before_login_failure] == 0x10006);
    assert(test_event_args[before_login_failure][1] == E_FAIL && !strcmp(test_event_text[before_login_failure], "Login failed"));
    /* INetUtil result transport: copy opaque bytes immediately; complete later
     * on INetUtilEvent slot 5, never the IChat sink at the same ordinal. */
    uint32_t result_vtable[8] = { 0 };
    result_vtable[5] = 0x20005;
    uint32_t result_sink[] = { (uint32_t)(uintptr_t)result_vtable };
    uint32_t result_cookie = 0;
    uint32_t result_advise[] = { (uint32_t)(uintptr_t)result_sink, (uint32_t)(uintptr_t)&result_cookie };
    assert(invoke(g_channel.point, 5, 2, result_advise) == S_OK);
    EM_ASM({ Module.ra2WolReport = function(id, game, bytes) {
        Module.testResult = ({ id: id, game: game, bytes: bytes });
    }; });
    uint8_t result_packet[] = { 0,28,0,0, 'I','D','N','O',0,6,0,4,0,0,0,1,
        'I','N','B','0',0,20,0,3,0,255,128,0 };
    uint32_t result_send[] = { (uint32_t)(uintptr_t)"retired.invalid", 1234, (uint32_t)(uintptr_t)result_packet, sizeof result_packet };
    uint32_t result_events = test_event_count;
    assert(invoke(g_channel.chat, 3, 4, result_send) == S_OK);
    assert(test_event_count == result_events);
    result_packet[25] = 1;
    assert(EM_ASM_INT({ return Module.testResult.game === 1 && Module.testResult.bytes[25] === 255 && Module.testResult.bytes[26] === 128; }));
    uint32_t result_id = EM_ASM_INT({ return Module.testResult.id; });
    char result_line[96]; snprintf(result_line, sizeof result_line, "@wolapi gameres %u 0", result_id);
    ra2_wolapi_receive_line(result_line);
    assert(test_event_count == result_events);
    assert(invoke(g_channel.chat, 7, 0, NULL) == S_OK);
    assert(test_event_count == result_events + 1 && test_event_method[result_events] == 0x20005);
    assert(test_event_args[result_events][0] == (uint32_t)(uintptr_t)result_sink && test_event_args[result_events][1] == S_OK);
    ra2_wolapi_receive_line(result_line);
    assert(invoke(g_channel.chat, 7, 0, NULL) == S_OK && test_event_count == result_events + 1);
    result_send[3] = 32769;
    assert(invoke(g_channel.chat, 3, 4, result_send) != S_OK);
    result_send[3] = sizeof result_packet;
    assert(invoke(g_channel.chat, 3, 4, result_send) == S_OK);
    result_id = EM_ASM_INT({ return Module.testResult.id; });
    snprintf(result_line, sizeof result_line, "@wolapi gameres %u %u", result_id, E_FAIL);
    ra2_wolapi_receive_line(result_line);
    assert(invoke(g_channel.chat, 7, 0, NULL) == S_OK);
    assert(test_event_count == result_events + 2 && test_event_args[result_events + 1][1] == E_FAIL);
    assert(invoke(g_channel.chat, 3, 4, result_send) == S_OK);
    result_id = EM_ASM_INT({ return Module.testResult.id; });
    uint32_t unadvise_result[] = { result_cookie };
    assert(invoke(g_channel.point, 6, 1, unadvise_result) == S_OK);
    assert(invoke(g_channel.point, 5, 2, result_advise) == S_OK);
    snprintf(result_line, sizeof result_line, "@wolapi gameres %u 0", result_id);
    ra2_wolapi_receive_line(result_line);
    assert(invoke(g_channel.chat, 7, 0, NULL) == S_OK && test_event_count == result_events + 2);
    strcpy(g_session.game_id, "g1-test");
    assert(invoke(g_chat.chat, 30, 0, NULL) == S_OK);
    assert(!strcmp(g_session.game_id, "g1-test"));
    /* A native failed-send callback may request the next send immediately.
     * An unavailable browser context must not make one pump spin forever. */
    memcpy(test_retry_args, result_send, sizeof test_retry_args);
    assert(invoke(g_channel.chat, 3, 4, result_send) == S_OK);
    result_id = EM_ASM_INT({ return Module.testResult.id; });
    snprintf(result_line, sizeof result_line, "@wolapi gameres %u %u", result_id, E_FAIL);
    ra2_wolapi_receive_line(result_line);
    test_retry_results = 3;
    assert(invoke(g_channel.chat, 7, 0, NULL) == S_OK);
    assert(test_retry_results == 2);
    test_retry_results = 0;
    invalidate_reports();
    puts("WOLAPI COM startup ABI: PASS");
    return 0;
}
