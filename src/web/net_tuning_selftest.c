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
    /* Profile choice: under 100 ms at 60 fps (5 frames = 83 ms). */
    assert(ra2_net_tuning_choose(40, 0, 60, 90) == 5);   /* no measurement: target */
    assert(ra2_net_tuning_choose(40, 17, 60, 90) == 4);  /* loopback/near relay */
    assert(ra2_net_tuning_choose(40, 60, 60, 90) == 5);
    assert(ra2_net_tuning_choose(40, 80, 60, 90) == 5);
    assert(ra2_net_tuning_choose(40, 150, 60, 90) == 5); /* capped at the target */
    assert(ra2_net_tuning_choose(40, 1000, 60, 90) == 5);/* sentinel = unknown */
    assert(ra2_net_tuning_choose(40, 60, 0, 90) == 5);   /* fps fallback */
    assert(ra2_net_tuning_choose(20, 17, 60, 90) == 4);  /* never above original */
    assert(ra2_net_tuning_choose(3, 60, 60, 90) == 3);   /* never above original */
    assert(ra2_net_tuning_choose(40, 60, 30, 90) == 2);  /* 90 ms target at 30 fps */

    uint32_t max_ahead = 40, send_rate = 10, precalc = 40, fps = 60, frame = 0;
    int32_t pings[8] = { 17, 17, 0, 0, 0, 0, 0, 0 };
    ra2_net_tuning_addrs addrs = {
        addr_of(&max_ahead), addr_of(&send_rate), addr_of(&precalc),
        addr_of(&fps), addr_of(pings), addr_of(&frame),
    };

    ra2_net_tuning_init(&addrs, 1, 90);
    /* The debug hook's guest stack: [0] return, [1] format, [2] first vararg. */
    uint32_t stack[3] = { 0, fmt_of("PrecalcMaxAhead is %d\n"), 40 };
    int printed = ra2_net_tuning_on_debuglog(stack[1], addr_of(stack), 1);
    assert(printed == 4 && stack[2] == 4);
    assert(max_ahead == 4 && send_rate == 2 && precalc == 4);
    assert(ra2_net_tuning_max_ahead() == 4 && ra2_net_tuning_send_rate() == 2);

    /* The game's timing event raises them; the frame hook puts them back. */
    max_ahead = 30;
    send_rate = 10;
    ra2_net_tuning_frame(1);
    assert(max_ahead == 4 && send_rate == 2);

    /* A startup stall is ignored. */
    frame = 10;
    ra2_net_tuning_on_debuglog(fmt_of("Packet received too late!\n"), 0, 1);
    assert(ra2_net_tuning_max_ahead() == 4);

    /* A late packet in play costs one frame. */
    frame = 300;
    ra2_net_tuning_on_debuglog(fmt_of("Packet received too late!\n"), 0, 1);
    assert(ra2_net_tuning_max_ahead() == 5);
    max_ahead = 40;
    ra2_net_tuning_frame(1);
    assert(max_ahead == 5);

    /* Cooldown: the next one within 1.5 s does nothing. */
    frame = 320;
    ra2_net_tuning_on_debuglog(fmt_of("Waiting for player %d on frame %d\n"), 0, 1);
    assert(ra2_net_tuning_max_ahead() == 5);

    /* After the cooldown another late line raises it again. */
    frame = 500;
    ra2_net_tuning_on_debuglog(fmt_of("DoList: Moving event from frame %d to frame %d\n"), 0, 1);
    assert(ra2_net_tuning_max_ahead() == 6);
    max_ahead = 40;
    ra2_net_tuning_frame(1);
    assert(max_ahead == 6);

    /* Leaving the match stops the clamp. */
    ra2_net_tuning_frame(0);
    max_ahead = 30;
    ra2_net_tuning_frame(1);
    assert(max_ahead == 30);

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

    /* A skirmish/campaign start (no WOL session) does not arm. */
    ra2_net_tuning_init(&addrs, 1, 90);
    max_ahead = 40;
    printed = ra2_net_tuning_on_debuglog(stack[1], addr_of(stack), 0);
    assert(printed == -1 && max_ahead == 40 && ra2_net_tuning_max_ahead() == 0);

    puts("net tuning: PASS");
    return 0;
}
