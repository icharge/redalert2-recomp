/*
 * Three frame buffers for the picture the game publishes (presenter.c). The
 * page may be reading one of them while the game writes the next frame, so
 * the game writes the one that is neither the newest published nor the one the
 * page says it is reading (ra2_shared_t readIndex).
 *
 * The seqlock (protocol.md): frame_seq is odd while the game publishes a
 * picture and even when it is whole. After acquiring a writable buffer, the
 * game makes frame_seq odd before writing pixels, then writes the published
 * words (format, pitch, sizes, palette_ptr, framePtr, frameIndex), then makes
 * frame_seq even. The page checks the sequence again after copying pixels.
 * The page's reads (protocol.md): read frame_seq s1
 * and retry while it is odd; read the metadata, framePtr and frameIndex; store
 * readIndex = frameIndex (Atomics.store); read frame_seq s2 and retry if
 * s2 != s1; only then read the pixels; store -1 (or the next index) when done.
 * The page finishes any picture read before it stores presentMode, and uses
 * Atomics.load and Atomics.store on these words. The game uses sequentially
 * consistent atomics on them.
 *
 * Replaced buffers. A resize moves a slot to a bigger buffer and keeps the old
 * one in old[] until frame_collect sees that the page is no longer reading it
 * and it is no longer newest. Both presenters announce readIndex, independent
 * of presentMode, so this rule applies to RGBA and raw frames.
 *
 * frame_acquire never frees. The game calls frame_collect before frame_acquire
 * at each publish, with the same reading, so a slot it picks has nothing pending
 * before choosing a buffer to replace.
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
    uint8_t *old[3];        /* a slot's replaced buffer: freed when it is no longer read or newest */
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

/* Bracket writing the published picture and metadata with the shared seqlock. */
uint32_t frame_publish_begin(volatile uint32_t *sequence);
void frame_publish_end(volatile uint32_t *sequence, uint32_t previous);

/* Frees replaced buffers that are neither being read nor currently published. */
void frame_collect(frame_bufs_t *b, int reading);

#ifdef FRAME_BUFFERS_SELFTEST
/* The selftest counts the frees (its own build only). */
void frame_bufs_set_free_hook(void (*hook)(void *));
#endif
