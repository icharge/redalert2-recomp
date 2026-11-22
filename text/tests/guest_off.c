#include "../../src/runtime/text_guest.h"

#include <assert.h>
#include <stdio.h>
#ifdef _WIN32
#include <stdlib.h>
#else
#include <stdlib.h>
#endif

int main(void) {
#ifdef _WIN32
    assert(_putenv("RA2_TTF_TEXT=1") == 0);
#else
    assert(setenv("RA2_TTF_TEXT", "1", 1) == 0);
#endif
    assert(text_guest_enabled() == 0);
    assert(text_guest_set_enabled(1) == 0);
    assert(text_guest_enabled() == 0);
    puts("guest adapter feature-off harness: pass");
    return 0;
}
