/*
 * Red Alert 2 and Yuri's Revenge - the browser host.
 *
 * src/linux/main.c on Emscripten: the same lifted C on pcrecomp's
 * runtime/win32hle, compiled to WebAssembly (docs/web). What is here is what
 * is specific to this game: where the image goes, the command line, the
 * hooks the lift calls, and the report of a fault.
 * What is not here, against the Linux host: signals (wasm has none; a fault is
 * a trap, reported by ra2_crash_report), the ffmpeg recorder (popen), and the
 * guest address space's reservation (it is the linker's: GLOBAL_BASE, see
 * docs/web/memory.md).
 */
#define _GNU_SOURCE
#include <stdint.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>
#include <sys/stat.h>
#include <pthread.h>
#include <emscripten.h>

#include "win32hle.h"
#include "pe_loader.h"
#include "host.h"
#include "recomp_target.h"
#include "launcher.h"
#include "web_api.h"
#include "thai_font.h"
extern const uint32_t ra2_entry_va;   /* recomp_dispatch.c */
extern int hle_ws_webrtc_pop(uint8_t *packet, uint32_t capacity);
extern int hle_ws_webrtc_push(const uint8_t *packet, uint32_t length);

#define RA2_IMAGE_BASE 0x00400000u

/* A shared-memory mailbox between the page's RTCPeerConnection and
 * win32hle's IPX socket shim. The game thread never touches this scratch
 * buffer; the page writes it before ra2_net_push and reads it after pop. */
#define RA2_NET_PACKET_MAX 580u              /* two socket numbers + 576-byte IPX datagram */
static uint8_t g_ra2_net_packet[RA2_NET_PACKET_MAX];
EMSCRIPTEN_KEEPALIVE uint32_t ra2_net_buffer(void) {
    return (uint32_t)(uintptr_t)g_ra2_net_packet;
}
EMSCRIPTEN_KEEPALIVE int ra2_net_pop(int capacity) {
    if (capacity < 0) return -1;
    if ((uint32_t)capacity > sizeof g_ra2_net_packet) capacity = sizeof g_ra2_net_packet;
    return hle_ws_webrtc_pop(g_ra2_net_packet, (uint32_t)capacity);
}
EMSCRIPTEN_KEEPALIVE int ra2_net_push(int length) {
    if (length < 0 || (uint32_t)length > sizeof g_ra2_net_packet) return -1;
    return hle_ws_webrtc_push(g_ra2_net_packet, (uint32_t)length);
}

static int g_debuglog, g_headless, g_fullscreen = -1;   /* -1: as ra2.ini says */
static const char *g_scale;
static const char *g_mod;              /* --mod NAME */
static int g_thai_font_fix;
static const char *g_thai_font_id;

/* ---- what the lift calls into ---------------------------------------------
 * run_lift.py PATCHES and HOOKS. */

/* The game's debug printf, compiled out of the retail build: --debuglog
 * prints it (arguments straight off the guest stack: a cdecl va_list on x86
 * is a pointer to the first variadic slot, and the guest is 32-bit). */
int  script_arg(int argc, char **argv, int i);   /* script.c */
int  script_active(void);
void script_log_line(const char *line);
void script_start(void);

void ra2_hook_debuglog(void) {
    if (g_debuglog || script_active()) {
        char buf[1024];
        const char *fmt = (const char *)(uintptr_t)MEM32(g_esp + 4);
        /* the guest's varargs are 4-byte slots, as i386's are: va_list is a
         * pointer to the first */
        va_list ap;
        char *first = (char *)(uintptr_t)(g_esp + 8);
        memcpy(&ap, &first, sizeof ap);
        vsnprintf(buf, sizeof buf, fmt, ap);
        size_t n = strlen(buf);
        script_log_line(buf);
        if (g_debuglog) fprintf(stderr, "[game] %s%s", buf, n && buf[n - 1] == '\n' ? "" : "\n");
    }
    g_esp += 4;                        /* ret */
}

/* HD voxels (src/runtime/hdvox.c): the lift's patches call it, and the
 * presenter shows its 2x picture. */
#include "hdvox.h"
#include "mods.h"
static int compose_hd(const uint8_t *px16, int pitch, int w, int h, uint32_t *out) {
    if (!ra2_vox_hd_on) return 0;
    hdvox_compose(px16, pitch, w, h, out);
    return 1;
}

/* ---- game-specific answers ------------------------------------------------ */

/* Message boxes print; headless, a question is answered No. */
static void ra2_MessageBoxA(void) {
    uint32_t type = A32(3), buttons = type & 0xF;
    uint32_t answer = g_headless && (buttons == 4 || buttons == 3) ? 7u : buttons == 4 || buttons == 3 ? 6u : 1u;
    fprintf(stderr, "[messagebox] %s: %s -> %u\n", ASTR(2) ? ASTR(2) : "", ASTR(1) ? ASTR(1) : "", answer);
    RET(answer, 4);
}

static const win32hle_shim g_ra2_shims[] = {
    { "MessageBoxA", ra2_MessageBoxA },
    { 0, 0 }
};

/* run_lift.py intercepts only Init.CPP's Exit confirmation call, before the
 * native dialog helper runs. The game thread waits for a browser reply while
 * releasing the guest machine lock; the browser uses this atomic mailbox and
 * never touches guest windows or registers. The original helper returns 0 for
 * OK and 1 for Cancel, so the caller keeps its normal exit/cancel branches. */
static uint32_t g_exit_confirm_serial;
static uint32_t g_exit_confirm_request, g_exit_confirm_answer;

uint32_t ra2_web_exit_confirmation(void) {
    uint32_t request = ++g_exit_confirm_serial;
    if (!request) request = ++g_exit_confirm_serial;
    __atomic_store_n(&g_exit_confirm_answer, 0, __ATOMIC_RELAXED);
    __atomic_store_n(&g_exit_confirm_request, request, __ATOMIC_RELEASE);
    char event[96];
    snprintf(event, sizeof event, "{\"e\":\"exitConfirm\",\"request\":%u}", request);
    web_event_json(event);

    hle_block_begin();
    uint32_t answer;
    while (!(answer = __atomic_load_n(&g_exit_confirm_answer, __ATOMIC_ACQUIRE)))
        usleep(10000);
    hle_block_end();
    return answer == 2 ? 0u : 1u;
}

EMSCRIPTEN_KEEPALIVE int ra2_exit_confirmation_reply(uint32_t request, int exit_game) {
    if (!request || (exit_game != 0 && exit_game != 1)) return 0;
    uint32_t expected = request;
    if (!__atomic_compare_exchange_n(&g_exit_confirm_request, &expected, 0, 0,
                                     __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) return 0;
    __atomic_store_n(&g_exit_confirm_answer, exit_game ? 2u : 1u, __ATOMIC_RELEASE);
    return 1;
}

/* WinMain checks that Blowfish.dll, the Westwood cipher's COM server, can be
 * created, and the MIX archives' headers are decrypted through it: its object
 * is served by blowfish.c. */
static const uint8_t CLSID_Blowfish[16] = { 0x10, 0xAD, 0x40, 0x14, 0xA8, 0x6A, 0xD1, 0x11,
                                            0xB6, 0xF9, 0x00, 0xA0, 0x24, 0xDD, 0xAF, 0xD1 };
uint32_t ra2_blowfish_create(const uint8_t *iid, uint32_t *out);

/* ---- faults ------------------------------------------------------------------ */
EMSCRIPTEN_KEEPALIVE void ra2_crash_report(const char *why);
void ra2_crash_report(const char *why) {
    fprintf(stderr, "\n=== %s ===\n  in lifted sub_%08X, last import %s\n", why, g_cur_func,
            g_cur_import ? g_cur_import : "(none)");
    fprintf(stderr, "  eax=%08X ecx=%08X edx=%08X ebx=%08X esp=%08X ebp=%08X esi=%08X edi=%08X\n",
            g_eax, g_ecx, g_edx, g_ebx, g_esp, g_ebp, g_esi, g_edi);
    fprintf(stderr, "last indirect calls (newest first):\n");
    for (int i = 1; i <= 40 && i <= (int)g_icall_trace_idx; i++) {
        uint32_t k = (g_icall_trace_idx - i) & (ICALL_TRACE_SIZE - 1);
        const char *nm = hle_name(g_icall_trace[k]);
        fprintf(stderr, "  0x%08X  from 0x%08X  %s\n", g_icall_trace[k], g_icall_from[k], nm ? nm : "");
    }
    fprintf(stderr, "guest stack at %08X:", g_esp);
    for (int k = 0; k < 64; k++) fprintf(stderr, "%s%08X", k % 8 ? " " : "\n  ", MEM32(g_esp + 4 * k));
    fprintf(stderr, "\n");
}

/* Every 100th frame shown, a checksum: a run's frames can be told apart
 * (the playtests count distinct ones) with no picture taken. */
static long g_shown;
static const char *g_dump_dir;        /* --dump-frames DIR: those frames as BMPs too */
static void dump_bmp(const uint8_t *px, int w, int h, int pitch, int bpp, long n) {
    char path[1024];
    snprintf(path, sizeof path, "%s/frame_%05ld.bmp", g_dump_dir, n);
    FILE *f = fopen(path, "wb");
    if (!f || bpp != 16) { if (f) fclose(f); return; }
    uint32_t row = (uint32_t)(w * 3 + 3) & ~3u, size = 54 + row * (uint32_t)h;
    uint8_t hdr[54] = { 'B', 'M' };
    memcpy(hdr + 2, &size, 4);
    hdr[10] = 54, hdr[14] = 40;
    memcpy(hdr + 18, &w, 4);
    memcpy(hdr + 22, &h, 4);
    hdr[26] = 1, hdr[28] = 24;
    fwrite(hdr, 1, 54, f);
    uint8_t *line = (uint8_t *)calloc(1, row);
    for (int y = h - 1; y >= 0; y--) {
        const uint16_t *s = (const uint16_t *)(px + (size_t)y * pitch);
        for (int x = 0; x < w; x++) {
            uint16_t p = s[x];
            line[3 * x] = (uint8_t)((p & 31) << 3), line[3 * x + 1] = (uint8_t)((p >> 5 & 63) << 2), line[3 * x + 2] = (uint8_t)((p >> 11) << 3);
        }
        fwrite(line, 1, row, f);
    }
    free(line);
    fclose(f);
}
static uint32_t checksum(const uint8_t *px, int w, int h, int pitch, int bpp) {
    uint32_t sum = 0;
    for (int y = 0; y < h; y += 4)
        for (int x = 0; x < w * bpp / 8; x += 16) sum = sum * 31 + px[(size_t)y * pitch + x];
    return sum;
}

/* The cursor, as on Windows (src/runtime/host.c, host_menu_cursor): the menus
 * are Win32 dialogs and use the Windows cursor the game sets; in a battle the
 * mouse is captured (WWMouseClass's +0x10 byte) and the game draws its own. */
#ifdef RA2_TARGET_GAME
#define RA2_MOUSE_VA 0x00B2AF5Cu   /* the mouse object (WWMouseClass), set by its constructor */
#else
#define RA2_MOUSE_VA 0x00B78164u
#endif
static int menus_use_windows_cursor(void) {
    uint32_t mouse = MEM32(RA2_MOUSE_VA);
    int game_draws_cursor = mouse && MEM8(mouse + 0x10);
    return !game_draws_cursor;
}

/* Without a recording, the same checksum lines at the same rate, from the
 * pump; and --dump-frames writes those frames as BMPs. */
/* --heartbeat S: a thread that is not the guest's says every S seconds what the machine is doing:
 * takes of the lock (a thread hogging it makes this race while the pumps stop), threads
 * waiting for it, the function it is in, and the pumps so far. A debugging aid. */
static volatile unsigned g_pumps;
static unsigned g_heartbeat_s;
static int g_dump_windows;                       /* --windows: the heartbeat also lists the windows */
static void *heartbeat(void *unused) {
    unsigned last = 0;
    (void)unused;
    for (;;) {
        sleep(g_heartbeat_s);
        unsigned takes;
        int waiters;
        uint32_t func;
        hle_machine_state(&takes, &waiters, &func);
        fprintf(stderr, "[heartbeat] takes %u (+%u) waiters %d in sub_%08X, last import %s, pumps %u\n", takes, takes - last,
                waiters, func, g_cur_import ? g_cur_import : "(none)", g_pumps);
        last = takes;
        if (g_dump_windows) hle_dump_windows();
    }
    return NULL;
}
static int g_trap_after;   /* --trap N: trap after N pumps, to see the crash report (docs/web/testing.md) */
static void frame_pump(void) {
    static uint32_t next;
    static int pumps;
    const uint8_t *px;
    const uint32_t *pal;
    int w, h, pitch, bpp;
    hle_screen_pump();
    ra2_launcher_poll();
    web_presenter_pump();
    g_pumps++;
    if (g_trap_after && ++pumps == g_trap_after) __builtin_trap();
    uint32_t now = hle_ticks_ms();
    if ((int32_t)(now - next) < 0 || !hle_dd_frame(&px, &w, &h, &pitch, &bpp, &pal, NULL)) return;
    next = now + 3333;
    fprintf(stderr, "[record] frame %ld checksum %08X game frame %u\n", g_shown * 100, checksum(px, w, h, pitch, bpp),
                MEM32(RA2_GAME_FRAME_VA));
    if (g_dump_dir) dump_bmp(px, w, h, pitch, bpp, g_shown);
    g_shown++;
}

static uint32_t exe_stamp(const char *path) {
    uint8_t head[4096] = { 0 };
    FILE *f = fopen(path, "rb");
    if (!f) return 0;
    size_t n = fread(head, 1, sizeof head, f);
    fclose(f);
    uint32_t nt = n >= 0x40 ? *(const uint32_t *)(head + 0x3C) : 0;
    return nt && nt < sizeof head - 12 ? *(const uint32_t *)(head + nt + 8) : 0;
}

/* Under Node (the headless runs, docs/web/testing.md) --game names a folder
 * on the real disk, put at /game on the main thread, since the game's own
 * thread has no file system of its own: by default mounted with NODEFS, the
 * files read in place; with --memfs copied into the in-memory file system,
 * only what the page's import would keep (docs/web/storage.md: the allowlist),
 * the way the files will be in a browser. */
static int g_memfs;
static const char *mount_node_game(const char *dir) {
    /* Module.ra2MountGame is in pre.js (a macro argument cannot hold its commas) */
    int ok = MAIN_THREAD_EM_ASM_INT({ return Module.ra2MountGame(UTF8ToString($0), $1); }, dir, g_memfs);
    return ok ? "/game" : dir;
}

/* a failure the page shows (protocol.md, the error event), and the log */
static int fail(const char *fmt, ...) {
    char msg[600];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof msg, fmt, ap);
    va_end(ap);
    fprintf(stderr, "%s\n", msg);
    web_event_error(msg);
    return 1;
}

/* The browser loader stages the explicitly selected font at game.fnt and
 * excludes imported and mod copies when the fix is enabled. Check that the
 * file the guest will actually open is a complete Thai-capable FNT. */
static int thai_font_check(void) {
    FILE *f = fopen("game.fnt", "rb");
    if (!f) return fail("selected Thai font is missing at game.fnt");
    uint8_t header[28];
    if (fread(header, 1, sizeof header, f) != sizeof header || memcmp(header, "fonT", 4)) {
        fclose(f);
        return fail("selected Thai font has an invalid FNT header");
    }
    uint32_t height = (uint32_t)header[12] | (uint32_t)header[13] << 8 |
                      (uint32_t)header[14] << 16 | (uint32_t)header[15] << 24;
    uint32_t count = (uint32_t)header[20] | (uint32_t)header[21] << 8 |
                     (uint32_t)header[22] << 16 | (uint32_t)header[23] << 24;
    uint32_t stride = (uint32_t)header[24] | (uint32_t)header[25] << 8 |
                      (uint32_t)header[26] << 16 | (uint32_t)header[27] << 24;
    if (height != 16 || !count || stride < 49) {
        fclose(f);
        return fail("selected Thai font has unsupported FNT dimensions");
    }
    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        return fail("cannot inspect selected Thai font");
    }
    long length = ftell(f);
    uint64_t expected = 28u + 0x20000u + (uint64_t)count * stride;
    if (length < 0 || (uint64_t)length != expected) {
        fclose(f);
        return fail("selected Thai font has a truncated glyph table");
    }
    static const unsigned first[] = { 0xA1, 0xDF, 0xE0 };
    static const unsigned last[] = { 0xDA, 0xDF, 0xFB };
    for (unsigned range = 0; range < 3; ++range) {
        for (unsigned code = first[range]; code <= last[range]; ++code) {
            if (fseek(f, 28 + (long)code * 2, SEEK_SET) != 0) {
                fclose(f);
                return fail("cannot read selected Thai font's CP874 map");
            }
            uint8_t map[2];
            if (fread(map, 1, sizeof map, f) != sizeof map) {
                fclose(f);
                return fail("selected Thai font has an incomplete CP874 map");
            }
            uint32_t glyph = (uint32_t)map[0] | (uint32_t)map[1] << 8;
            if (!glyph || glyph > count) {
                fclose(f);
                return fail("selected Thai font is missing CP874 glyph 0x%02X", code);
            }
        }
    }
    fclose(f);
    fprintf(stderr, "[thaifont] using selected font %s at game.fnt\n", g_thai_font_id);
    return 0;
}
static void on_exit_event(int code) { web_event_exit(code); }

int main(int argc, char **argv) {
    const char *game = "game";
    int run = 0;
    setvbuf(stderr, NULL, _IONBF, 0);
    /* --args FILE: more arguments, whitespace-separated, # to the end of a
     * line a comment (tools/lan's scripts), as the Windows host reads them. */
    for (int i = 1; i + 1 < argc; i++) {
        if (strcmp(argv[i], "--args")) continue;
        static char text[16384];
        static char *av[512];
        FILE *f = fopen(argv[i + 1], "rb");
        if (!f) { fprintf(stderr, "cannot read --args %s\n", argv[i + 1]); return 1; }
        size_t n = fread(text, 1, sizeof text - 1, f);
        fclose(f);
        text[n] = 0;
        int ac = 0;
        for (int k = 0; k < argc && ac < 500; k++) if (k != i && k != i + 1) av[ac++] = argv[k];
        for (char *p = text; *p && ac < 511;) {
            while (*p && strchr(" \t\r\n", *p)) p++;
            if (*p == '#') { while (*p && *p != '\n') p++; continue; }
            if (!*p) break;
            av[ac++] = p;
            while (*p && !strchr(" \t\r\n", *p)) p++;
            if (*p) *p++ = 0;
        }
        argc = ac, argv = av;
        break;
    }
    for (int i = 1; i < argc; i++) {
        int n = script_arg(argc, argv, i);
        if (n) { i += n - 1; continue; }
        if (!strcmp(argv[i], "--run")) run = 1;
        else if (!strcmp(argv[i], "--headless")) g_headless = 1;
        else if (!strcmp(argv[i], "--fullscreen")) g_fullscreen = 1;
        else if (!strcmp(argv[i], "--scale") && i + 1 < argc) g_scale = argv[++i];
        else if (!strcmp(argv[i], "--thai-font-fix")) g_thai_font_fix = 1;
        else if (!strcmp(argv[i], "--thai-font-id") && i + 1 < argc) g_thai_font_id = argv[++i];
        else if (!strcmp(argv[i], "--debuglog")) g_debuglog = 1;
        else if (!strcmp(argv[i], "--mute")) hle_dsound_set_master(0.0f);
        else if (!strcmp(argv[i], "--game") && i + 1 < argc) game = argv[++i];
        else if (!strcmp(argv[i], "--mod") && i + 1 < argc) g_mod = argv[++i];
        else if (!strcmp(argv[i], "--trace")) win32hle_trace = 1;
        else if (!strcmp(argv[i], "--memfs")) g_memfs = 1;
        else if (!strcmp(argv[i], "--windows")) g_dump_windows = 1;
        else if (!strcmp(argv[i], "--msgtrace") && i + 1 < argc) setenv("HLE_MSGTRACE", argv[++i], 1);
        else if (!strcmp(argv[i], "--env") && i + 1 < argc) putenv(strdup(argv[++i]));   /* --env NAME=VALUE: a debugging switch for the host or win32hle */
        else if (!strcmp(argv[i], "--heartbeat") && i + 1 < argc) g_heartbeat_s = (unsigned)strtoul(argv[++i], NULL, 0);
        else if (!strcmp(argv[i], "--trap") && i + 1 < argc) g_trap_after = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--hd-voxels")) hdvox_configure(1, NULL);
        else if (!strcmp(argv[i], "--hd-voxels-dump") && i + 1 < argc) {
            static char dir[PATH_MAX];               /* absolute: the run chdirs into the game folder */
            const char *p = argv[++i];
            if (p[0] == '/') snprintf(dir, sizeof dir, "%s", p);
            else { char cwd[PATH_MAX]; snprintf(dir, sizeof dir, "%s/%s", getcwd(cwd, sizeof cwd) ? cwd : ".", p); }
            hdvox_configure(1, dir);
        }
        else if (!strcmp(argv[i], "--exe") && i + 1 < argc) i++;   /* the Windows host's: here it is the game folder's Game.exe */
        else if (!strcmp(argv[i], "--dump-frames") && i + 1 < argc) {
            static char dir[PATH_MAX];
            if (!realpath(argv[++i], dir)) { fprintf(stderr, "no folder %s\n", argv[i]); return 1; }
            g_dump_dir = dir;                /* the run chdirs into the game folder */
        }
        else {
            printf("usage: ra2 [--run] [--headless | --fullscreen] [--scale sharp|smooth|crt|nearest|integer] [--game DIR] [--mod NAME|none] [--thai-font-fix --thai-font-id ID] [--debuglog] [--mute] [--trace] [--heartbeat S] [--memfs] [--trap N] [--dump-frames DIR] [--hd-voxels] [--hd-voxels-dump DIR]\n"
                   "           [--press DLG:CTRL@s] [--select DLG:CTRL=N@s] [--waitlog TEXT@s] [--move|--click x,y@s]\n"
                   "           [--key [c][s][a]+vk@s] [--wait VA@s] [--drag x1,y1,x2,y2@s]\n");
            return !strcmp(argv[i], "--help") || !strcmp(argv[i], "-h") ? 0 : 1;
        }
    }
    game = mount_node_game(game);
    char game_full[PATH_MAX], exe_host[PATH_MAX + 16];
    if (!realpath(game, game_full)) return fail("no game folder at %s", game);
    hle_set_drive('C', game_full);
    if (!hle_host_path("C:\\" RA2_EXE_NAME, exe_host, sizeof exe_host)) {
        return fail("no " RA2_EXE_NAME " in %s", game_full);
    }
    uint32_t stamp = exe_stamp(exe_host);
    if (stamp != RA2_EXE_STAMP) {
        return fail("%s is not the build this host was lifted from (PE timestamp 0x%08X, wanted 0x%08X). "
                    "Lift and build from the Steam release's " RA2_EXE_NAME " (README, Getting Started).", exe_host, stamp, RA2_EXE_STAMP);
    }

    win32hle_register(g_ra2_shims);    /* first: the game's own answers win */
    recomp_host_init();
    hle_com_register_class(CLSID_Blowfish, ra2_blowfish_create);
    printf(RA2_TITLE " recomp host (browser)\n  lifted functions in dispatch: %u\n", recomp_dispatch_count);

    pe_image img;
    if (recomp_pe_map(exe_host, &img) != 0 || img.base != RA2_IMAGE_BASE) {
        return fail("cannot map %s at 0x%08X", exe_host, RA2_IMAGE_BASE);
    }
    hle_module_add("C:\\" RA2_EXE_NAME, img.base, img.resource_rva, img.resource_size, 1);
    int unresolved = recomp_pe_bind(&img, hle_resolve_or_stub);
    printf("  mapped %s: 0x%08X-0x%08X, %d imports not implemented yet\n", exe_host, img.base, img.base + img.span, unresolved);
    hle_set_command_line("\"C:\\" RA2_EXE_NAME "\"");
    web_event_boot(RA2_TITLE, RA2_EXE_NAME, stamp);

    if (!run) {
        printf("\n(dry run: image mapped and bound; --run enters 0x%08X)\n", ra2_entry_va);
        return 0;
    }
    if (chdir(game_full) != 0) return fail("cannot enter %s", game_full);
    if (g_thai_font_fix && (!g_thai_font_id || !g_thai_font_id[0]))
        return fail("the Thai font fix is enabled without a selected font");
    if (g_thai_font_fix && thai_font_check() != 0) return 1;
    thai_font_set_enabled(g_thai_font_fix);
    web_settings_start(g_scale);
    hle_screen_cursor_hook = menus_use_windows_cursor;
    if (hle_screen_open(RA2_TITLE, g_fullscreen > 0, 1) != 0) return 1;
    web_presenter_start(menus_use_windows_cursor);
    mods_start(game_full, g_mod, web_settings_mod(), argc, argv, web_settings_save_mod);
    web_settings_event();
    hle_set_pump_hook(frame_pump);
    hle_screen_compose_hook = compose_hd;
    hle_on_exit = on_exit_event;
    ra2_launcher_start();
    script_start();
    if (g_heartbeat_s) {
        pthread_t t;
        pthread_create(&t, NULL, heartbeat, NULL);
        pthread_detach(t);
    }
    printf("  entering 0x%08X\n\n", ra2_entry_va);
    fflush(stdout);
    uint32_t rc = hle_call_guest(ra2_entry_va, 0, NULL);
    printf("\nentry returned eax=%08X\n", rc);
    hle_exit((int)rc);
    return 0;
}
