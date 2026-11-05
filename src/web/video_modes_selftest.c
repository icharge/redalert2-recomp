#include <assert.h>
#include <stdio.h>
#include "video_modes.h"

int main(void) {
    assert(web_video_size_allowed(2560, 1440));
    assert(web_video_size_allowed(3840, 2160));
    /* "Match browser size" sends the window's size, which is not a catalog entry. */
    assert(web_video_size_allowed(1512, 982));
    assert(web_video_size_allowed(2580, 1080));
    assert(!web_video_size_allowed(319, 600));
    assert(!web_video_size_allowed(1920, 199));
    assert(!web_video_size_allowed(8193, 1080));
    puts("video modes selftest: ok");
    return 0;
}
