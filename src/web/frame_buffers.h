/*
 * Three frame buffers for the picture the game publishes (presenter.c). The
 * page may be reading one of them while the game writes the next frame, so
 * the game writes the one that is neither the newest published nor the one the
 * page says it is reading (ra2_shared_t readIndex).
 *
 * The page's reads, which Task 4 implements (protocol.md, words 1047 and 1048):
 * read frameIndex and framePtr; Atomics.store readIndex = that index; re-read
 * frameIndex and framePtr and retry if either changed; only then read the
 * pixels; store -1 when done. The page uses Atomics.load and Atomics.store on
 * these words. The game uses __ATOMIC_SEQ_CST on them and publishes in this
 * order: the pixels, then frame_ptr and frame_index, then frame_seq.
 *
 * Replaced buffers. A resize moves a slot to a bigger buffer and keeps the old
 * one in old[] until frame_collect frees it. frame_collect frees only when the
 * page announces its reads (presentMode 1). In presentMode 0 the page does not
 * set readIndex yet (the 2D presenter, Task 4), so a replaced buffer may still
 * be read: it is never freed, one leak per resize, as before this change. Task
 * 4 makes both presenters set readIndex; then presentMode 0 can free too.
 *
 * frame_acquire never frees. The game calls frame_collect before frame_acquire
 * at each publish, with the same reading, so a slot it picks has nothing pending
 * when it is mode 1.
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
    uint8_t *old[3];        /* a slot's buffer replaced by a bigger one: freed by frame_collect (mode 1 only) */
} frame_bufs_t;

/* The slot that is neither newest nor reading (either may be -1). */
int frame_pick(int newest, int reading);

/* The buffer to write the next frame into, of at least `bytes` bytes, from a slot other than
 * `reading` and the newest. A buffer it replaces goes to old[] and is not freed here. NULL if memory ran out. */
uint8_t *frame_acquire(frame_bufs_t *b, int reading, size_t bytes);

/* The slot whose buffer is p, or -1. */
int frame_index_of(const frame_bufs_t *b, const uint8_t *p);

/* Marks slot `index` as the newest published frame. */
void frame_publish(frame_bufs_t *b, int index);

/* Frees the replaced buffers that no slot reads or publishes any more. Frees nothing unless
 * page_announces_reads (presentMode 1): see the comment above. */
void frame_collect(frame_bufs_t *b, int reading, int page_announces_reads);

#ifdef FRAME_BUFFERS_SELFTEST
/* The selftest counts the frees (its own build only). */
void frame_bufs_set_free_hook(void (*hook)(void *));
#endif
