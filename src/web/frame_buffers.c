#include <stdlib.h>
#include "frame_buffers.h"

#ifdef FRAME_BUFFERS_SELFTEST
static void (*g_free)(void *) = free;
void frame_bufs_set_free_hook(void (*hook)(void *)) { g_free = hook ? hook : free; }
#define RELEASE(p) g_free(p)
#else
#define RELEASE(p) free(p)
#endif

int frame_pick(int newest, int reading) {
    for (int i = 0; i < 3; i++)
        if (i != newest && i != reading) return i;
    return 0;                           /* not reached: two excluded slots leave one of three */
}

uint8_t *frame_acquire(frame_bufs_t *b, int reading, size_t bytes) {
    int i = frame_pick(b->newest, reading);
    if (b->cap[i] >= bytes) return b->ptr[i];
    /* The replaced buffer waits in old[i] for frame_collect. If one still waits here, frame_collect freed nothing
     * (presentMode 0) and it is overwritten, which leaks it: the leak the ruling allows, one buffer per resize
     * for the session. */
    b->old[i] = b->ptr[i];
    b->ptr[i] = malloc(bytes);
    b->cap[i] = b->ptr[i] ? bytes : 0;
    return b->ptr[i];
}

int frame_index_of(const frame_bufs_t *b, const uint8_t *p) {
    for (int i = 0; i < 3; i++)
        if (b->ptr[i] == p) return i;
    return -1;
}

void frame_publish(frame_bufs_t *b, int index) { b->newest = index; }

void frame_collect(frame_bufs_t *b, int reading, int page_announces_reads) {
    if (!page_announces_reads) return;  /* presentMode 0: the page does not say what it reads, so nothing is freed */
    for (int i = 0; i < 3; i++) {
        if (!b->old[i] || i == b->newest || i == reading) continue;
        RELEASE(b->old[i]);
        b->old[i] = NULL;
    }
}
