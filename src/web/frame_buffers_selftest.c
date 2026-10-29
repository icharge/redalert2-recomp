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

static void publication_sequence_brackets_pixel_writes(void) {
    volatile uint32_t sequence = 8;
    uint32_t previous = frame_publish_begin(&sequence);
    assert(previous == 8 && sequence == 9);

    /* A page reading during this write must see an odd sequence. */
    uint8_t pixels[2] = {0};
    pixels[0] = 1;
    assert(sequence & 1);
    pixels[1] = 2;

    frame_publish_end(&sequence, previous);
    assert(sequence == 10 && !(sequence & 1));
}

/* What the presenter does for one frame: collect, take a buffer, "write" it, publish it. */
static uint8_t *make(frame_bufs_t *b, int reading, size_t bytes, int present_mode, int *index) {
    (void)present_mode; /* both page presenters announce readIndex regardless of present mode */
    frame_collect(b, reading);
    uint8_t *p = frame_acquire(b, reading, bytes);
    assert(p);
    *index = frame_index_of(b, p);
    assert(*index >= 0);
    frame_publish(b, *index);
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
    uint8_t *p0 = make(&b, -1, 100, 1, &i0);             /* first frame: index 0, now newest */
    assert(i0 == 0);
    uint8_t *p1 = make(&b, 0, 100, 1, &i1);              /* the page reads 0 and 0 is newest: not 0 */
    assert(i1 == 1 && p1 != p0);
    uint8_t *p2 = make(&b, 0, 100, 1, &i2);              /* newest 1, reading 0: only 2 is left */
    assert(i2 == 2 && p2 != p0 && p2 != p1);
    for (int i = 0; i < 3; i++) free(b.ptr[i]);
}

/* presentMode 1: the page announces its reads, so a replaced buffer is freed once its slot is released. */
static void resize_frees_only_after_release(void) {
    frame_bufs_t b = { .newest = -1 };
    frame_bufs_set_free_hook(counting_free);
    frees = 0;
    int ia, ib, ic, i;
    uint8_t *a = make(&b, -1, 100, 1, &ia);              /* 0 */
    uint8_t *bb = make(&b, -1, 100, 1, &ib);             /* 1 */
    uint8_t *c = make(&b, 0, 100, 1, &ic);               /* 2; newest is 2 */
    assert(ia == 0 && ib == 1 && ic == 2 && frees == 0);

    /* a frame twice the size: slot 0 gets a new buffer; the 100-byte one waits while slot 0 is newest */
    make(&b, 1, 400, 1, &i);                             /* the page reads slot 1; picks 0 */
    assert(i == 0 && b.ptr[0] != a && b.old[0] == a);
    assert(frees == 0);

    /* the next frame goes to slot 2: its old buffer waits while newest; slot 0 is released and a is freed */
    make(&b, 1, 400, 1, &i);
    assert(i == 2 && b.old[2] == c && b.old[0] == a && frees == 0);
    uint8_t *p0 = b.ptr[0];
    make(&b, 1, 400, 1, &i);
    assert(i == 0 && b.ptr[0] == p0 && b.old[2] == c && b.old[0] == NULL && frees == 1);

    /* the page reads 0: slot 2 is released and c is freed; the frame goes to slot 1, whose 100-byte buffer waits */
    make(&b, 0, 400, 1, &i);
    assert(i == 1 && b.old[2] == NULL && b.old[1] == bb && frees == 2);

    /* newest 1: the frame goes to slot 2, which has room; slot 1 waits while it is newest */
    make(&b, 0, 400, 1, &i);
    assert(i == 2 && b.old[1] == bb && frees == 2);

    /* newest 2: slot 1 is released and freed */
    make(&b, 0, 400, 1, &i);
    assert(i == 1 && b.old[1] == NULL && frees == 3);

    for (int k = 0; k < 3; k++) assert(b.old[k] == NULL);
    for (int k = 0; k < 3; k++) free(b.ptr[k]);
}

/* A pending buffer whose slot the page reads survives collect; frame_acquire frees nothing; the next collect
 * after the page moves on frees it. */
static void pending_reading_slot_survives_collect(void) {
    frame_bufs_t b = { .newest = -1 };
    frees = 0;
    int i;
    uint8_t *a = make(&b, -1, 100, 1, &i);               /* 0 */
    uint8_t *bb = make(&b, -1, 100, 1, &i);              /* 1 */
    make(&b, 0, 100, 1, &i);                             /* 2; newest 2 */
    make(&b, 1, 400, 1, &i);                             /* slot 0 replaced: a waits; newest 0 */
    assert(i == 0 && b.old[0] == a && frees == 0);

    make(&b, 0, 400, 1, &i);                             /* the page reads 0; picks 1, replacing bb; newest 1 */
    assert(i == 1 && b.old[0] == a && b.old[1] == bb && frees == 0);

    frame_collect(&b, 0);                                /* slot 0 is read: a survives */
    assert(b.old[0] == a && frees == 0);

    /* the page moves on to slot 2; slot 0 is released, but a frame_acquire alone frees nothing */
    frame_acquire(&b, 2, 100);
    assert(b.old[0] == a && frees == 0);
    frame_collect(&b, 2);                                /* the next collect frees a; slot 1 is newest and kept */
    assert(b.old[0] == NULL && frees == 1 && b.old[1] == bb);

    frame_collect(&b, 2);
    assert(frees == 1);
    for (int k = 0; k < 3; k++) free(b.ptr[k]);
    free(b.old[1]);
}

/* The 2D presenter announces reads too. A replaced slot stays alive while it
 * is newest or being read, then is reclaimed once both have moved elsewhere. */
static void rgba_resize_reclaims_after_release(void) {
    frame_bufs_t b = { .newest = -1 };
    frees = 0;
    int i;
    uint8_t *a = make(&b, -1, 100, 0, &i);               /* 0 */
    make(&b, -1, 100, 0, &i);                            /* 1 */
    make(&b, 0, 100, 0, &i);                             /* 2 */
    make(&b, 1, 400, 0, &i);                             /* slot 0 replaced: a waits */
    assert(i == 0 && b.old[0] == a);
    make(&b, 0, 400, 0, &i);                            /* slot 0 is still being read */
    assert(b.old[0] == a && frees == 0);
    make(&b, 1, 400, 0, &i);                            /* slot 0 released: old buffer is reclaimed */
    assert(b.old[0] == NULL && frees == 1);
    for (int k = 0; k < 3; k++) free(b.ptr[k]);
}

int main(void) {
    publication_sequence_brackets_pixel_writes();
    pick_skips_reading_and_newest();
    acquire_never_returns_the_read_buffer();
    resize_frees_only_after_release();
    pending_reading_slot_survives_collect();
    rgba_resize_reclaims_after_release();
    printf("frame_buffers selftest: ok\n");
    return 0;
}
