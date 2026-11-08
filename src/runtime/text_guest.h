#ifndef RA2_TEXT_GUEST_H
#define RA2_TEXT_GUEST_H

/*
 * Guest-facing adapter for the CPU TTF text engine (text_engine.h).
 *
 * Every uint32_t here is a guest virtual address. In the game the guest is
 * flat memory, so a VA is a host pointer. Callers pass the guest font object
 * (ECX in the lifted code); the adapter reads its proven fields directly.
 *
 * Each call either handles the string completely, or reports 0 so the caller
 * runs the original renderer. A handled call has measured and drawn the same
 * layout. It never writes outside the font clip and surface bounds.
 *
 * Same-thread: call from the game thread only, as the engine requires.
 */

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Channel layout of the 16-bit surface. Each field is a bit position and a
 * width. Native surfaces are 16bpp; RGB565 is the default. */
typedef struct TextGuestPixelFormat {
    uint8_t r_shift, r_bits;
    uint8_t g_shift, g_bits;
    uint8_t b_shift, b_bits;
} TextGuestPixelFormat;

/* Opt-in switch (--ttf-text, or RA2_TTF_TEXT=1 read once). Returns the
 * previous state. Without RA2_TTF_TEXT at compile time it stays off and
 * logs that the build lacks the engine. */
int text_guest_set_enabled(int on);
int text_guest_enabled(void);

void text_guest_set_pixel_format(const TextGuestPixelFormat *fmt);

/* Measure a wide string (wrap_px 0 = no wrap). On success, width is the
 * advance the matching label draw consumes; height is the logical height.
 * Returns 1 when handled, 0 to fall back. */
int text_guest_measure(uint32_t font_va, uint32_t text_va, int32_t wrap_px,
                       int32_t *width_out, int32_t *height_out);

/* Draw a settled label at (x, y). max_units 0 means until NUL. reveal 0
 * means fully visible. A positive reveal is handled only once it has
 * passed the highlight window; an active reveal falls back. final_x receives
 * x plus the advance. Returns 1 when handled, 0 to fall back. */
int text_guest_label(uint32_t font_va, uint32_t text_va, int32_t x, int32_t y,
                     uint32_t max_units, int32_t reveal, int32_t *final_x);

/* Surface setup or release at the proven addresses (004348F0/00434990 in YR).
 * The adapter calls setup before it reads the font's pixel, pitch and clip,
 * and release after drawing. The lifted layer supplies these. */
typedef void (*TextGuestSurfaceFn)(uint32_t font_va, uint32_t surface_va, void *ctx);

/* Paragraph draw. Wraps at wrap_px (0 = none), aligns by align_flags (bit 1
 * centre, bit 2 right), and draws at (x, y). Falls back (returns 0) for
 * control characters, a layout taller than max_height (0 = no limit), and an
 * active reveal. setup and release are called only once the call is handled. */
int text_guest_paragraph(uint32_t font_va, uint32_t surface_va, uint32_t text_va,
                         int32_t x, int32_t y, int32_t wrap_px, int32_t max_height,
                         uint32_t align_flags, int32_t reveal, int32_t reveal_range,
                         TextGuestSurfaceFn setup, TextGuestSurfaceFn release, void *ctx);

#ifdef __cplusplus
}
#endif

#endif
