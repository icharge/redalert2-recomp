#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include "frame_clock.h"

int main(void) {
    const uint32_t late_uptime = 2233232551u;

    assert(web_fps_deadline_due(late_uptime, 0, 0));
    assert(!web_fps_deadline_due(late_uptime, late_uptime + 1000u, 1));
    assert(web_fps_deadline_due(late_uptime + 1000u, late_uptime + 1000u, 1));
    assert(web_fps_deadline_due(0x20u, 0xfffffff0u, 1));
    assert(!web_fps_deadline_due(0xfffffff0u, 0x20u, 1));

    puts("frame clock selftest: ok");
    return 0;
}
