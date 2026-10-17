/*
 * The launcher, played by the host (the Linux and browser hosts; the Windows
 * host does the same in src/runtime/host.c).
 *
 * Retail and Ares installs (not the Steam/EA exes, which have the check
 * patched out) bail with "Launcher not running" unless the launcher, RA2.exe
 * or RA2MD.exe, holds a named mutex when the game starts. The game then
 * signals a named event and waits for the launcher's answer: thread message
 * 0xBEEF, whose lParam is a file mapping holding the string the game checks.
 * Red Alert 2 re-checks it every 1024 frames and queues an event against the
 * player when it differs.
 */
#include <stdint.h>
#include <string.h>

#include "win32hle.h"
#include "recomp_target.h"
#include "launcher.h"

#define LAUNCHER_MESSAGE 0xBEEFu

static uint32_t g_event, g_map;

void ra2_launcher_start(void) {
    void *view = NULL;
    hle_named_mutex("48BC11BD-C4D7-466b-8A31-C6ABBAD47B3E");
    g_event = hle_named_event("D6E7FC97-64F9-4d28-B52C-754EDF721C6F");
    g_map = hle_make_mapping(4096, &view);
    if (!g_event || !g_map || !view) { g_event = g_map = 0; return; }
#ifdef RA2_TARGET_GAME
    strcpy((char *)view, "(c) 2000 Electronic Arts, Inc. All Rights Reserved");
#else
    strcpy((char *)view, "UIDATA,3DDATA,MAPS");
#endif
    /* Yuri's Revenge takes one at startup as well as after its signal */
    hle_post_message(0, LAUNCHER_MESSAGE, 0, g_map);
}

/* From the pump, on the game's thread (the message queue has no lock): each
 * time the game signals, the launcher answers again. */
void ra2_launcher_poll(void) {
    if (g_event && hle_event_take(g_event)) hle_post_message(0, LAUNCHER_MESSAGE, 0, g_map);
}
