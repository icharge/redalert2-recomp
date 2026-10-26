/*
 * Three frame buffers for the picture the game publishes (presenter.c). The
 * page may be reading one of them while the game writes the next frame, so
 * the game writes the one that is neither the newest published nor the one the
 * page says it is reading (ra2_shared_t readIndex). A buffer the frame outgrows
 * is kept until nothing reads it: frame_collect frees it, not frame_acquire.
 *
 * Only the game's thread calls these. Plain C with no Emscripten headers, so
 * frame_buffers_selftest.c runs under node.
 */
#pragma once
#include <stddef.h>
#include <stdint.h>

typedef struct {
    uint8_t *ptr[3];        /* the buffer of each slot, NULL until the slot is first used */
    size_t cap[3];          /* bytes ptr[i] holds */
    int newest;             /* the slot frame_publish last named; -1 before the first */
    uint8_t *old[3];        /* a slot's buffer replaced by a bigger one: freed by frame_collect */
} frame_bufs_t;

/* The slot that is neither newest nor reading (either may be -1). */
int frame_pick(int newest, int reading);

/* The buffer to write the next frame into, of at least `bytes` bytes, from a slot other than
 * `reading` and the newest. NULL if memory ran out. */
uint8_t *frame_acquire(frame_bufs_t *b, int reading, size_t bytes);

/* The slot whose buffer is p, or -1. */
int frame_index_of(const frame_bufs_t *b, const uint8_t *p);

/* Marks slot `index` as the newest published frame. */
void frame_publish(frame_bufs_t *b, int index);

/* Frees the replaced buffers that no slot reads or publishes any more. Called at each publish. */
void frame_collect(frame_bufs_t *b, int reading);

#ifdef FRAME_BUFFERS_SELFTEST
/* The selftest counts the frees (its own build only). */
void frame_bufs_set_free_hook(void (*hook)(void *));
#endif
