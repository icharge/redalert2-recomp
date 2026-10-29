#include <assert.h>
#include <stdio.h>
#include "video_modes.h"

int main(void) {
    assert(web_video_size_allowed(2560, 1440));
    assert(web_video_size_allowed(3840, 2160));
    assert(!web_video_size_allowed(3840, 1600));
    assert(!web_video_size_allowed(3200, 1800));
    puts("video modes selftest: ok");
    return 0;
}
