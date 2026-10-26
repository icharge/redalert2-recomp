/*
 * frame_buffers selftest: the three-buffer rule behind the raw publish (frame_buffers.h).
 * Built and run under node as docs/web/testing.md says; prints "frame_buffers selftest: ok".
 */
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include "frame_buffers.h"

static int frees;
static void counting_free(void *p) { frees++; free(p); }

/* What the game does for one frame: take a buffer, "write" it, publish it, collect. */
static uint8_t *make(frame_bufs_t *b, int reading, size_t bytes, int *index) {
    uint8_t *p = frame_acquire(b, reading, bytes);
    assert(p);
    *index = frame_index_of(b, p);
    assert(*index >= 0);
    frame_publish(b, *index);
    frame_collect(b, reading);
    return p;
}

static void pick_skips_reading_and_newest(void) {
    assert(frame_pick(0, 1) == 2);
    assert(frame_pick(2, 0) == 1);
    int both = frame_pick(1, 1);
    assert(both == 0 || both == 2);
    int none = frame_pick(-1, -1);
    assert(none >= 0 && none <= 2);
}

static void acquire_never_returns_the_read_buffer(void) {
    frame_bufs_t b = { .newest = -1 };
    int i0, i1, i2;
    uint8_t *p0 = make(&b, -1, 100, &i0);                /* first frame: index 0, now newest */
    assert(i0 == 0);
    uint8_t *p1 = make(&b, 0, 100, &i1);                 /* the page reads 0 and 0 is newest: not 0 */
    assert(i1 == 1 && p1 != p0);
    uint8_t *p2 = make(&b, 0, 100, &i2);                 /* newest 1, reading 0: only 2 is left */
    assert(i2 == 2 && p2 != p0 && p2 != p1);
    for (int i = 0; i < 3; i++) free(b.ptr[i]);
}

static void resize_frees_only_after_release(void) {
    frame_bufs_t b = { .newest = -1 };
    frame_bufs_set_free_hook(counting_free);
    frees = 0;
    int ia, ib, ic, i;
    uint8_t *a = make(&b, -1, 100, &ia);                 /* 0 */
    uint8_t *bb = make(&b, -1, 100, &ib);                /* 1 */
    uint8_t *c = make(&b, 0, 100, &ic);                  /* 2; newest is 2 */
    assert(ia == 0 && ib == 1 && ic == 2 && frees == 0);

    /* a frame twice the size: slot 0 gets a new buffer, the 100-byte one is kept while slot 0 is newest */
    make(&b, 1, 400, &i);                                /* the page reads slot 1; picks 0 */
    assert(i == 0 && b.ptr[0] != a && b.old[0] == a);
    assert(frees == 0);

    /* the next frame moves on to slot 2: its old buffer is pending while newest, slot 0 is released */
    make(&b, 1, 400, &i);
    assert(i == 2 && b.old[2] == c);
    assert(b.old[0] == NULL && frees == 1);              /* a is freed once slot 0 was neither newest nor read */
    assert(b.ptr[2] != c);

    /* slot 0 again, now the same size: no new buffer, and slot 2's old one goes */
    uint8_t *p0 = b.ptr[0];
    make(&b, 1, 400, &i);
    assert(i == 0 && b.ptr[0] == p0);
    assert(b.old[2] == NULL && frees == 2);

    /* the page reads slot 0: the frame goes to slot 1, whose 100-byte buffer is pending while newest */
    make(&b, 0, 400, &i);
    assert(i == 1 && b.old[1] == bb && frees == 2);
    make(&b, 0, 400, &i);                                /* newest 1: picks 2; reading 0 blocks slot 0 */
    assert(i == 2 && b.old[1] == NULL && frees == 3);

    for (int k = 0; k < 3; k++) assert(b.old[k] == NULL);
    for (int k = 0; k < 3; k++) free(b.ptr[k]);
}

int main(void) {
    pick_skips_reading_and_newest();
    acquire_never_returns_the_read_buffer();
    resize_frees_only_after_release();
    printf("frame_buffers selftest: ok\n");
    return 0;
}
