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
        memcpy(test_event_args[test_event_count++], args, count * sizeof *args);
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
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == 4 && test_event_method[3] == 0x10008);
    wol_channel *lobby = (wol_channel *)(uintptr_t)test_event_args[3][2];
    assert(lobby && lobby->type == 0 && strcmp(lobby->name, "Lob_41_0") == 0);
    uint32_t join_args[] = { (uint32_t)(uintptr_t)lobby };
    assert(invoke(g_chat.chat, 8, 1, join_args) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolLine === "join #Lob_41_0 zotclot9"; }));
    ra2_wolapi_receive_line(":testuser!local JOIN :0,0,0,1 #Lob_41_0");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_method[4] == 0x1000a);
    wol_user *joined = (wol_user *)(uintptr_t)test_event_args[4][3];
    assert(joined->flags & 0x8000); /* native OnChannelJoin distinguishes our own join */
    assert(strcmp(((wol_channel *)(uintptr_t)test_event_args[4][2])->name, "Lob_41_0") == 0);
    ra2_wolapi_receive_line(":wol 353 testuser = #Lob_41_0 :@testuser,0,1,1 other,0,0,1");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(g_user_count == 2 && strcmp(g_users[1].name, "other") == 0);
    assert((g_users[0].flags & 0x8001) == 0x8001);
    (void)user_for_name("other");
    assert(strcmp(g_users[0].name, "testuser") == 0);
    assert(invoke(g_chat.chat, 9, 0, NULL) == S_OK);
    ra2_wolapi_receive_line(":testuser!local PART #Lob_41_0");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == 7 && test_event_method[6] == 0x1000b);
    assert(strcmp(((wol_channel *)(uintptr_t)test_event_args[6][2])->name, "Lob_41_0") == 0);
    assert(!g_current_channel[0]);
    wol_channel room = { .type = 41, .max_users = 4 };
    strcpy(room.name, "testuser");
    uint32_t create_args[] = { (uint32_t)(uintptr_t)&room };
    assert(invoke(g_chat.chat, 7, 1, create_args) == S_OK);
    ra2_wolapi_receive_line(":testuser!local JOINGAME 0 0 0 0 0 1 0 :#testuser");
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(test_event_count == 8 && test_event_method[7] == 0x10009);
    assert(((wol_channel *)(uintptr_t)test_event_args[7][2])->type == 41);
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
    assert(EM_ASM_INT({ return Module.testWolLine.includes("WOLAPI1:65552,1234,0,8,0,::"); }));
    g_channel_count = 0;
    parse_room_line(":wol 322 testuser #host's_game 1 0 41 0 0 12 0::WOLAPI1:65552,1234,0,8,0,::mapname :0");
    assert(strcmp(g_channels[0].ex_info, "65552,1234,0,8,0,") == 0);
    assert(strcmp(g_channels[0].topic, "mapname") == 0);
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
    /* RequestLogout completes through OnLogout(status, user); the "Logging off" dialog waits for it. */
    uint32_t events_before_logout = test_event_count;
    EM_ASM({ Module.ra2WolStop = () => { Module.testWolStopped = true; }; });
    assert(invoke(g_chat.chat, 13, 0, NULL) == S_OK);
    assert(test_event_count == events_before_logout);
    assert(invoke(g_chat.chat, 3, 0, NULL) == S_OK);
    assert(EM_ASM_INT({ return Module.testWolStopped === true; }));
    /* OnLogout, then the OnNetStatus that signals the game's "Logging off" wait event. */
    assert(test_event_count == events_before_logout + 2);
    assert(test_event_method[events_before_logout] == 0x10014);
    assert(test_event_args[events_before_logout][1] == S_OK);
    assert(strcmp(((wol_user *)(uintptr_t)test_event_args[events_before_logout][2])->name, "testuser") == 0);
    assert(test_event_method[events_before_logout + 1] == 0x10013);
    puts("WOLAPI COM startup ABI: PASS");
    return 0;
}
