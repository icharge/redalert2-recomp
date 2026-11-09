/*
 * Browser-only command-delay tuning for Internet (WOL) matches.
 *
 * RA2/YR schedule every order MaxAhead frames ahead of the frame it is applied
 * on, so the player sees MaxAhead / frame rate of input delay whether the link
 * is fast or not. The stock online value settles at 30 frames (500 ms at
 * 60 fps). For a relay match on a nearby server much of that is unnecessary.
 *
 * This module picks a smaller profile from the measured path round trip and
 * has the host's timing events carry it (MaxAhead and FrameSendRate), raising
 * MaxAhead one frame at a time if the game reports late packets or stalls. The
 * live Session values change only when such an event executes, on the same
 * frame for every player. It never runs outside a WOL match and is disabled by
 * --classic-latency.
 */
#pragma once
#include <stdint.h>

typedef struct {
    uint32_t max_ahead;          /* Session.MaxAhead, frames */
    uint32_t frame_send_rate;    /* Session.FrameSendRate, frames between sends */
    uint32_t precalc_max_ahead;  /* one-shot value carried in the timing event */
    uint32_t desired_frame_rate; /* Session.DesiredFrameRate (60 at Fastest) */
    uint32_t ping_array;         /* 8 x int32 milliseconds; 0/1000 = unknown */
    uint32_t game_frame;         /* the game's frame counter */
} ra2_net_tuning_addrs;

/* `enabled` is 0 for --classic-latency; `delay_ms` is the target command delay
 * (0 selects the default, 90 ms). */
void ra2_net_tuning_init(const ra2_net_tuning_addrs *addrs, int enabled, int delay_ms);

/* Called from the debug-log hook, before the line is printed. `esp` is the
 * guest stack of the hook: the format is at +4 and the first vararg at +8.
 * Recognises the start-of-match line and the late/stall lines. When it returns
 * >= 0 the vararg was rewritten so the printed "PrecalcMaxAhead is %d" matches
 * the value actually in effect. */
int ra2_net_tuning_on_debuglog(uint32_t fmt, uint32_t esp, int match_active);

/* Called once per frame with whether a WOL match is live; disarms after it.
 * It writes nothing: the live values are the game's own (see above). */
void ra2_net_tuning_frame(int match_active);

/* Pure profile choice, exposed for the selftest. `original` is the game's own
 * MaxAhead; the result is never above it. */
int ra2_net_tuning_choose(int original, int path_ping_ms, int fps, int delay_ms);

/* The host's timing events (Generate_Real_Timing_Event and the precalculated
 * one, run_lift.py net_timing_event_patches): the MaxAhead / FrameSendRate the
 * event will carry. Every player executes that event on the same frame, so this
 * is the only lockstep-safe way to change them. Returns `stock` when no tuned
 * WOL match is armed. */
uint32_t ra2_net_tuning_timing_max_ahead(uint32_t stock);
uint32_t ra2_net_tuning_timing_send_rate(uint32_t stock);

/* The send rate that goes with a MaxAhead: 2 frames for an even MaxAhead of 4 or
 * more, else 1. MaxAhead is always a multiple of it, as the game's own timing
 * events make it (Generate_Real_Timing_Event rounds up to the send rate). */
int ra2_net_tuning_send_rate_for(int max_ahead);

/* The profile currently held (0 before a match arms it). */
int ra2_net_tuning_max_ahead(void);
int ra2_net_tuning_send_rate(void);
