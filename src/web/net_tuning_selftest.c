/*
 * Self-test for net_tuning.c. Build with RECOMP_FLAT_MEMORY so a guest address
 * is the host address of the variable the test watches:
 *
 *   emcc src/web/net_tuning_selftest.c src/web/net_tuning.c \
 *       -I<pcrecomp>/runtime/recomp32 -DRECOMP_FLAT_MEMORY \
 *       -sENVIRONMENT=node -sEXIT_RUNTIME=1 -o build-web/net-tuning-selftest.js
 *   node build-web/net-tuning-selftest.js
 */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>

#include "net_tuning.h"

static uint32_t addr_of(const void *p) { return (uint32_t)(uintptr_t)p; }
static uint32_t fmt_of(const char *s) { return (uint32_t)(uintptr_t)s; }

int main(void) {
    /* Profile choice: the 90 ms target is 5 frames at 60 fps, but MaxAhead must
     * be a multiple of FrameSendRate (the game's own timing events round it up
     * the same way; 5 with a send every 2 frames desynchronised a match), so a
     * 2-frame send rate makes it 6 (100 ms). */
    assert(ra2_net_tuning_choose(40, 0, 60, 90) == 6);   /* no measurement: target */
    assert(ra2_net_tuning_choose(40, 17, 60, 90) == 4);  /* loopback/near relay */
    assert(ra2_net_tuning_choose(40, 60, 60, 90) == 6);
    assert(ra2_net_tuning_choose(40, 80, 60, 90) == 6);
    assert(ra2_net_tuning_choose(40, 118, 60, 90) == 6); /* the run that desynced at 5 */
    assert(ra2_net_tuning_choose(40, 150, 60, 90) == 6); /* capped at the target */
    assert(ra2_net_tuning_choose(40, 1000, 60, 90) == 6);/* sentinel = unknown */
    assert(ra2_net_tuning_choose(40, 60, 0, 90) == 6);   /* fps fallback */
    assert(ra2_net_tuning_choose(20, 17, 60, 90) == 4);  /* never above original */
    assert(ra2_net_tuning_choose(5, 60, 60, 90) == 5);   /* never above original: odd, so... */
    assert(ra2_net_tuning_send_rate_for(5) == 1);        /* ...it is sent every frame */
    assert(ra2_net_tuning_choose(3, 60, 60, 90) == 3);   /* never above original */
    assert(ra2_net_tuning_choose(40, 60, 30, 90) == 2);  /* 90 ms target at 30 fps */
    for (int original = 2; original <= 40; original++)
        for (int ping = 0; ping <= 400; ping += 7) {
            int tuned = ra2_net_tuning_choose(original, ping, 60, 90);
            assert(tuned % ra2_net_tuning_send_rate_for(tuned) == 0);
        }

    uint32_t max_ahead = 40, send_rate = 10, precalc = 40, fps = 60, frame = 0;
    int32_t pings[8] = { 17, 17, 0, 0, 0, 0, 0, 0 };
    ra2_net_tuning_addrs addrs = {
        addr_of(&max_ahead), addr_of(&send_rate), addr_of(&precalc),
        addr_of(&fps), addr_of(pings), addr_of(&frame),
    };

    ra2_net_tuning_init(&addrs, 1, 90);
    /* Not armed yet: the host's timing events keep the game's own values. */
    assert(ra2_net_tuning_timing_max_ahead(30) == 30);
    assert(ra2_net_tuning_timing_send_rate(5) == 5);

    /* The debug hook's guest stack: [0] return, [1] format, [2] first vararg. */
    uint32_t stack[3] = { 0, fmt_of("PrecalcMaxAhead is %d\n"), 40 };
    int printed = ra2_net_tuning_on_debuglog(stack[1], addr_of(stack), 1);
    assert(printed == 4 && stack[2] == 4);
    assert(precalc == 4);
    assert(ra2_net_tuning_max_ahead() == 4 && ra2_net_tuning_send_rate() == 2);
    /* Lockstep: the live values change only through a timing event, which every
     * player executes on the same frame. Writing them here, on one player's
     * own schedule, desynchronised matches (docs/web/network-performance.md). */
    assert(max_ahead == 40 && send_rate == 10);

    /* The host's timing events carry the profile instead of the stock values. */
    assert(ra2_net_tuning_timing_max_ahead(30) == 4);
    assert(ra2_net_tuning_timing_send_rate(5) == 2);
    assert(ra2_net_tuning_timing_send_rate(10) == 2);

    /* The frame hook never writes the live values. */
    max_ahead = 30;
    send_rate = 10;
    ra2_net_tuning_frame(1);
    assert(max_ahead == 30 && send_rate == 10);

    /* A startup stall is ignored. */
    frame = 10;
    ra2_net_tuning_on_debuglog(fmt_of("Packet received too late!\n"), 0, 1);
    assert(ra2_net_tuning_max_ahead() == 4);

    /* A late packet in play costs one send interval (2 frames, keeping MaxAhead
     * a multiple of the send rate), carried by the next timing event. */
    frame = 300;
    ra2_net_tuning_on_debuglog(fmt_of("Packet received too late!\n"), 0, 1);
    assert(ra2_net_tuning_max_ahead() == 6 && ra2_net_tuning_send_rate() == 2);
    assert(ra2_net_tuning_timing_max_ahead(30) == 6);
    assert(max_ahead == 30);

    /* Cooldown: the next one within 1.5 s does nothing. */
    frame = 320;
    ra2_net_tuning_on_debuglog(fmt_of("Waiting for player %d on frame %d\n"), 0, 1);
    assert(ra2_net_tuning_max_ahead() == 6);

    /* After the cooldown another late line raises it again. */
    frame = 500;
    ra2_net_tuning_on_debuglog(fmt_of("Waiting for player %d on frame %d\n"), 0, 1);
    assert(ra2_net_tuning_max_ahead() == 8);

    /* An event the game moves at a timing change is not a late packet: the move
     * is the game applying a new MaxAhead, not the link falling behind. */
    frame = 700;
    ra2_net_tuning_on_debuglog(fmt_of("DoList: Moving event from frame %d to frame %d\n"), 0, 1);
    assert(ra2_net_tuning_max_ahead() == 8);

    /* Leaving the match: timing events are the game's own again. */
    ra2_net_tuning_frame(0);
    assert(ra2_net_tuning_timing_max_ahead(30) == 30);
    assert(ra2_net_tuning_timing_send_rate(5) == 5);

    /* --classic-latency leaves everything alone. */
    ra2_net_tuning_init(&addrs, 0, 90);
    max_ahead = 40;
    send_rate = 10;
    precalc = 40;
    stack[2] = 40;
    printed = ra2_net_tuning_on_debuglog(stack[1], addr_of(stack), 1);
    assert(printed == -1 && stack[2] == 40);
    assert(max_ahead == 40 && send_rate == 10 && precalc == 40);
    ra2_net_tuning_frame(1);
    assert(max_ahead == 40);
    assert(ra2_net_tuning_timing_max_ahead(30) == 30);
    assert(ra2_net_tuning_timing_send_rate(5) == 5);

    /* A skirmish/campaign start (no WOL session) does not arm. */
    ra2_net_tuning_init(&addrs, 1, 90);
    max_ahead = 40;
    printed = ra2_net_tuning_on_debuglog(stack[1], addr_of(stack), 0);
    assert(printed == -1 && max_ahead == 40 && ra2_net_tuning_max_ahead() == 0);

    puts("net tuning: PASS");
    return 0;
}
