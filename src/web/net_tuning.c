/*
 * Browser-only command-delay tuning for Internet (WOL) matches. See
 * net_tuning.h for what the game's MaxAhead means and why it is held here.
 *
 * The measured ping the game is given is the path round trip through the
 * relay (own server round trip + the peer's), so one way is about half of it.
 * A command waits up to FrameSendRate frames for the next packet and then
 * MaxAhead - FrameSendRate frames of network margin. The profile starts at the
 * smallest of "what the measurement needs" and the requested delay, and the
 * frame hook holds it: the game's own timing events keep recomputing the
 * stock online floor (30 frames) and would otherwise undo it within a second.
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "recomp_types.h"
#include "net_tuning.h"

#define DEFAULT_DELAY_MS 90
#define MAX_AHEAD_LIMIT 30
#define SEND_RATE_FAST 2
#define WARMUP_FRAMES 240 /* 4 s at 60 fps: startup stalls are not the link */
#define BUMP_COOLDOWN_FRAMES 90

static const ra2_net_tuning_addrs *g_addrs;
static int g_enabled, g_armed;
static int g_delay_ms;
static int g_max_ahead, g_send_rate;
static uint32_t g_last_bump_frame;
static int g_bumps;

static int game_fps(void) {
    int fps = (int)MEM32(g_addrs->desired_frame_rate);
    return fps >= 20 && fps <= 120 ? fps : 60;
}

static int send_rate_for(int max_ahead) { return max_ahead >= 4 ? SEND_RATE_FAST : 1; }

static int ceiling_for(int fps, int delay_ms) {
    int frames = (fps * delay_ms) / 1000;
    if (frames < 2) frames = 2;
    return frames > MAX_AHEAD_LIMIT ? MAX_AHEAD_LIMIT : frames;
}

/* The largest ping in the game's 8-entry array; 0 and 1000 are its
 * "not available" sentinels (see Start_Game_Now). */
static int max_ping(void) {
    int worst = -1;
    for (int i = 0; i < 8; i++) {
        int32_t ping = (int32_t)MEM32(g_addrs->ping_array + 4u * (uint32_t)i);
        if (ping <= 0 || ping >= 1000) continue;
        if (ping > worst) worst = ping;
    }
    return worst;
}

int ra2_net_tuning_choose(int original, int path_ping_ms, int fps, int delay_ms) {
    if (fps < 20 || fps > 120) fps = 60;
    if (delay_ms <= 0) delay_ms = DEFAULT_DELAY_MS;
    int ceiling = ceiling_for(fps, delay_ms);
    if (original > 0 && ceiling > original) ceiling = original;

    int send = send_rate_for(ceiling);
    int tuned;
    if (path_ping_ms > 0 && path_ping_ms < 1000) {
        /* ceil(ping / 2 ms * fps / 1000) frames of one-way travel. */
        int one_way_frames = (path_ping_ms * fps + 1999) / 2000;
        tuned = send + one_way_frames + 1;
    } else {
        tuned = ceiling; /* no measurement yet: start at the requested target */
    }
    if (tuned > ceiling) tuned = ceiling;
    int floor = send + 2;
    if (floor > ceiling) floor = ceiling;
    if (tuned < floor) tuned = floor;
    if (tuned < 2) tuned = 2;
    if (original > 0 && tuned > original) tuned = original;
    return tuned;
}

void ra2_net_tuning_init(const ra2_net_tuning_addrs *addrs, int enabled, int delay_ms) {
    g_addrs = addrs;
    g_enabled = enabled && addrs != NULL;
    g_delay_ms = delay_ms > 0 ? delay_ms : DEFAULT_DELAY_MS;
    g_armed = 0;
    g_max_ahead = g_send_rate = 0;
    g_last_bump_frame = 0;
    g_bumps = 0;
}

int ra2_net_tuning_max_ahead(void) { return g_max_ahead; }
int ra2_net_tuning_send_rate(void) { return g_send_rate; }

static void bump(const char *what) {
    if (!g_armed || g_max_ahead >= MAX_AHEAD_LIMIT) return;
    uint32_t frame = MEM32(g_addrs->game_frame);
    if (frame < WARMUP_FRAMES) return;
    if (g_last_bump_frame && frame - g_last_bump_frame < BUMP_COOLDOWN_FRAMES) return;
    int old = g_max_ahead;
    g_max_ahead++;
    g_last_bump_frame = frame;
    g_bumps++;
    fprintf(stderr, "[net] %s at frame %u: MaxAhead %d -> %d frames (%d ms)\n",
            what, frame, old, g_max_ahead, g_max_ahead * 1000 / game_fps());
}

int ra2_net_tuning_on_debuglog(uint32_t fmt, uint32_t esp, int match_active) {
    const char *f = (const char *)(uintptr_t)fmt;
    if (!g_enabled || !g_addrs || !f) return -1;

    if (!strncmp(f, "PrecalcMaxAhead is", 18)) {
        if (!match_active) {
            g_armed = 0;
            return -1;
        }
        int original = (int)MEM32(g_addrs->max_ahead);
        int fps = game_fps();
        int ping = max_ping();
        int tuned = ra2_net_tuning_choose(original, ping, fps, g_delay_ms);
        g_max_ahead = tuned;
        g_send_rate = send_rate_for(tuned);
        g_last_bump_frame = 0;
        g_bumps = 0;
        g_armed = 1;
        MEM32(g_addrs->max_ahead) = (uint32_t)tuned;
        MEM32(g_addrs->frame_send_rate) = (uint32_t)g_send_rate;
        MEM32(g_addrs->precalc_max_ahead) = (uint32_t)tuned;
        fprintf(stderr,
                "[net] WOL command delay: max ping %d ms, MaxAhead %d -> %d frames "
                "(%d ms at %d fps), sending every %d frames\n",
                ping, original, tuned, tuned * 1000 / fps, fps, g_send_rate);
        if (esp) MEM32(esp + 8) = (uint32_t)tuned;
        return tuned;
    }

    if (!g_armed || !match_active) return -1;
    if (!strncmp(f, "Packet received too late", 24)) bump("late packet");
    else if (!strncmp(f, "Waiting for player", 17)) bump("waiting for a player");
    else if (!strncmp(f, "DoList: Moving event", 20)) bump("late event moved");
    return -1;
}

void ra2_net_tuning_frame(int match_active) {
    if (!g_enabled || !g_armed) return;
    if (!match_active) {
        g_armed = 0;
        return;
    }
    MEM32(g_addrs->max_ahead) = (uint32_t)g_max_ahead;
    MEM32(g_addrs->frame_send_rate) = (uint32_t)g_send_rate;
}
