#ifndef RA2_TEXT_ENGINE_H
#define RA2_TEXT_ENGINE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct RA2TextEngine RA2TextEngine;
typedef struct RA2TextLayout RA2TextLayout;

enum {
    RA2_TEXT_OK = 0,
    RA2_TEXT_INVALID_ARGUMENT = 1,
    RA2_TEXT_INVALID_FONT = 2,
    RA2_TEXT_LIMIT_EXCEEDED = 3,
    RA2_TEXT_INTERNAL_ERROR = 4
};

typedef struct RA2TextMetrics {
    float advance_x;
    float advance_y;
    float width;
    float height;
    float baseline;
    int32_t ink_x;
    int32_t ink_y;
    uint32_t ink_width;
    uint32_t ink_height;
} RA2TextMetrics;

/* All handles are created/destroyed on the same thread. The engine owns registered font data.
   Inputs are capped at 16,384 UTF-16 code units and 128 MiB per font. Font size is 1..512 px;
   wrap width is 0..16,384 px. Layout masks are capped at 16,384 px per dimension and 16M pixels.
   Reuse a layout for repeated drawing; there is no per-frame font registration or layout cache. */
RA2TextEngine *ra2_text_engine_create(void);
void ra2_text_engine_destroy(RA2TextEngine *engine);

/* Register a TTF/OTF byte buffer. The bytes are copied before this call returns.
   Returns a stable positive id in out_font_id, or an RA2_TEXT_* error. */
int32_t ra2_text_engine_add_font(RA2TextEngine *engine,
                                const uint8_t *font_bytes,
                                size_t font_byte_len,
                                uint32_t *out_font_id);

/* UTF-16 code units; unpaired surrogates become U+FFFD. preferred_font_id 0 selects bundled
   Noto Sans and script fallback fonts. wrap_width_px 0 means no wrapping. */
int32_t ra2_text_layout_utf16(RA2TextEngine *engine,
                              uint32_t preferred_font_id,
                              const uint16_t *text,
                              size_t text_code_units,
                              float font_size_px,
                              float wrap_width_px,
                              RA2TextLayout **out_layout);

/* Extended layout. alignment: 0=left, 1=center, 2=right; line_height_px 0 uses font defaults;
   font_weight 0 uses normal; font_width_ratio 1 uses normal width. */
int32_t ra2_text_layout_utf16_ex(RA2TextEngine *engine,
                                 uint32_t preferred_font_id,
                                 const uint16_t *text,
                                 size_t text_code_units,
                                 float font_size_px,
                                 float wrap_width_px,
                                 float line_height_px,
                                 uint32_t alignment,
                                 float font_weight,
                                 float font_width_ratio,
                                 RA2TextLayout **out_layout);

int32_t ra2_text_layout_get_metrics(const RA2TextLayout *layout, RA2TextMetrics *out_metrics);

/* Writes A8 glyph coverage into a caller-owned buffer. origin_x/origin_y place the logical
   layout top-left in dst (negative ink bearings are retained). Pixels outside the destination
   are clipped; row_pitch is in bytes and must be at least dst_width. */
int32_t ra2_text_layout_render_mask(const RA2TextLayout *layout,
                                    uint8_t *dst,
                                    uint32_t dst_width,
                                    uint32_t dst_height,
                                    size_t row_pitch,
                                    int32_t origin_x,
                                    int32_t origin_y);
void ra2_text_layout_destroy(RA2TextLayout *layout);

#ifdef __cplusplus
}
#endif

#endif
