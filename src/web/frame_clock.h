#pragma once

#include <stdint.h>

/* A zero deadline is a valid wrapped timestamp. Keep initialization separate
 * so the first check does not interpret a large monotonic uptime as negative. */
static inline int web_fps_deadline_due(uint32_t now, uint32_t deadline, int started) {
    return !started || (int32_t)(now - deadline) >= 0;
}
