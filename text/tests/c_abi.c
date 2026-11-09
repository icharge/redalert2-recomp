#include "../../src/runtime/text_engine.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    RA2TextEngine *engine = ra2_text_engine_create();
    assert(engine != NULL);
    const uint16_t sample[] = { 'R', 'A', '2' };
    RA2TextLayout *layout = NULL;
    assert(ra2_text_layout_utf16(engine, 0, sample, 3, 24.0f, 0.0f, &layout) == RA2_TEXT_OK);
    assert(layout != NULL);
    RA2TextMetrics metrics;
    assert(ra2_text_layout_get_metrics(layout, &metrics) == RA2_TEXT_OK);
    assert(metrics.advance_x > 0.0f);
    assert(metrics.ink_width > 0 && metrics.ink_height > 0);
    assert(metrics.baseline > 0.0f);
    size_t retained_storage_bytes = 0;
    assert(ra2_text_layout_get_storage_bytes(layout, &retained_storage_bytes) == RA2_TEXT_OK);
    assert(retained_storage_bytes > 0);

    const uint32_t width = 128, height = 48, pitch = 136;
    uint8_t *pixels = (uint8_t *)calloc(height, pitch);
    assert(pixels != NULL);
    assert(ra2_text_layout_render_mask(layout, pixels, width, height, pitch, 3, 2) == RA2_TEXT_OK);
    int any_ink = 0;
    for (uint32_t y = 0; y < height; ++y)
        for (uint32_t x = 0; x < width; ++x)
            any_ink |= pixels[y * pitch + x] != 0;
    assert(any_ink);
    for (uint32_t y = 0; y < height; ++y)
        for (uint32_t x = width; x < pitch; ++x)
            assert(pixels[y * pitch + x] == 0);

    /* A progressive mask reveals the same full layout without reshaping or
     * shifting its metrics; all-visible must match the existing renderer. */
    uint8_t *prefix = (uint8_t *)calloc(height, pitch);
    assert(prefix != NULL);
    assert(ra2_text_layout_render_mask_prefix(layout, prefix, width, height, pitch, 3, 2, 0) == RA2_TEXT_OK);
    for (uint32_t i = 0; i < height * pitch; ++i) assert(prefix[i] == 0);
    assert(ra2_text_layout_render_mask_prefix(layout, prefix, width, height, pitch, 3, 2, SIZE_MAX) == RA2_TEXT_OK);
    assert(memcmp(prefix, pixels, height * pitch) == 0);
    free(prefix);

    /* A supplementary scalar occupies two UTF-16 units and appears atomically. */
    const uint16_t supplementary[] = { 0xD83D, 0xDE00 };
    RA2TextLayout *emoji = NULL;
    assert(ra2_text_layout_utf16(engine, 0, supplementary, 2, 24.0f, 0.0f, &emoji) == RA2_TEXT_OK);
    uint8_t emoji_mask[128 * 48] = {0};
    assert(ra2_text_layout_render_mask_prefix(emoji, emoji_mask, 128, 48, 128, 0, 0, 1) == RA2_TEXT_OK);
    for (size_t i = 0; i < sizeof emoji_mask; ++i) assert(emoji_mask[i] == 0);
    assert(ra2_text_layout_render_mask_prefix(emoji, emoji_mask, 128, 48, 128, 0, 0, 2) == RA2_TEXT_OK);
    any_ink = 0;
    for (size_t i = 0; i < sizeof emoji_mask; ++i) any_ink |= emoji_mask[i] != 0;
    assert(any_ink);
    ra2_text_layout_destroy(emoji);

    /* The prefix for "A B" is the first glyph of the full layout, and its
     * coordinates exactly match an independently rendered "A". */
    const uint16_t a_space_b[] = { 'A', ' ', 'B' };
    const uint16_t only_a[] = { 'A' };
    RA2TextLayout *full_latin = NULL, *just_a = NULL;
    assert(ra2_text_layout_utf16(engine, 0, a_space_b, 3, 24.0f, 0.0f, &full_latin) == RA2_TEXT_OK);
    assert(ra2_text_layout_utf16(engine, 0, only_a, 1, 24.0f, 0.0f, &just_a) == RA2_TEXT_OK);
    uint8_t latin_prefix[128 * 48] = {0}, latin_a[128 * 48] = {0};
    assert(ra2_text_layout_render_mask_prefix(full_latin, latin_prefix, 128, 48, 128, 0, 0, 1) == RA2_TEXT_OK);
    assert(ra2_text_layout_render_mask(just_a, latin_a, 128, 48, 128, 0, 0) == RA2_TEXT_OK);
    assert(memcmp(latin_prefix, latin_a, sizeof latin_a) == 0);
    ra2_text_layout_destroy(full_latin);
    ra2_text_layout_destroy(just_a);

    /* Thai base+combining vowel is one reveal unit; the mark never appears
     * without its base. */
    const uint16_t thai_cluster[] = { 0x0E01, 0x0E34, 'X' };
    RA2TextLayout *thai = NULL;
    assert(ra2_text_layout_utf16(engine, 0, thai_cluster, 3, 24.0f, 0.0f, &thai) == RA2_TEXT_OK);
    uint8_t thai_prefix[128 * 48] = {0};
    assert(ra2_text_layout_render_mask_prefix(thai, thai_prefix, 128, 48, 128, 0, 0, 1) == RA2_TEXT_OK);
    for (size_t i = 0; i < sizeof thai_prefix; ++i) assert(thai_prefix[i] == 0);
    assert(ra2_text_layout_render_mask_prefix(thai, thai_prefix, 128, 48, 128, 0, 0, 2) == RA2_TEXT_OK);
    any_ink = 0;
    for (size_t i = 0; i < sizeof thai_prefix; ++i) any_ink |= thai_prefix[i] != 0;
    assert(any_ink);
    ra2_text_layout_destroy(thai);

    /* Arabic reveals in source order while retaining full-layout RTL
     * positions: its first logical character is at the right of the run. */
    const uint16_t arabic[] = { 0x0633, 0x0644, 0x0627, 0x0645 };
    RA2TextLayout *arabic_layout = NULL;
    assert(ra2_text_layout_utf16(engine, 0, arabic, 4, 24.0f, 0.0f, &arabic_layout) == RA2_TEXT_OK);
    uint8_t arabic_full[128 * 48] = {0}, arabic_prefix[128 * 48] = {0};
    assert(ra2_text_layout_render_mask(arabic_layout, arabic_full, 128, 48, 128, 0, 0) == RA2_TEXT_OK);
    assert(ra2_text_layout_render_mask_prefix(arabic_layout, arabic_prefix, 128, 48, 128, 0, 0, 1) == RA2_TEXT_OK);
    int full_min_x = 128, full_max_x = -1, prefix_max_x = -1;
    for (int y = 0; y < 48; ++y) for (int x = 0; x < 128; ++x) {
        if (arabic_full[y * 128 + x]) { if (x < full_min_x) full_min_x = x; if (x > full_max_x) full_max_x = x; }
        if (arabic_prefix[y * 128 + x] && x > prefix_max_x) prefix_max_x = x;
    }
    assert(full_max_x > full_min_x && prefix_max_x > full_min_x + (full_max_x - full_min_x) / 2);
    ra2_text_layout_destroy(arabic_layout);

    /* Prefix drawing also uses the exact centered/wrapped full layout. */
    const uint16_t wrapped_text[] = { 'A', ' ', 'B', ' ', 'C', ' ', 'D' };
    RA2TextLayout *wrapped = NULL;
    assert(ra2_text_layout_utf16_ex(engine, 0, wrapped_text, 7, 24.0f, 38.0f, 24.0f, 1, 700.0f, 0.82f, &wrapped) == RA2_TEXT_OK);
    RA2TextMetrics wrapped_metrics_before, wrapped_metrics_after;
    assert(ra2_text_layout_get_metrics(wrapped, &wrapped_metrics_before) == RA2_TEXT_OK);
    uint8_t wrapped_prefix[128 * 64] = {0};
    assert(ra2_text_layout_render_mask_prefix(wrapped, wrapped_prefix, 128, 64, 128, 0, 0, 1) == RA2_TEXT_OK);
    assert(ra2_text_layout_get_metrics(wrapped, &wrapped_metrics_after) == RA2_TEXT_OK);
    assert(memcmp(&wrapped_metrics_before, &wrapped_metrics_after, sizeof wrapped_metrics_before) == 0);
    any_ink = 0;
    for (size_t i = 0; i < sizeof wrapped_prefix; ++i) any_ink |= wrapped_prefix[i] != 0;
    assert(any_ink);
    ra2_text_layout_destroy(wrapped);

    /* A layout clipped entirely outside the destination must not write. */
    memset(pixels, 0, height * pitch);
    assert(ra2_text_layout_render_mask(layout, pixels, width, height, pitch, -200, -200) == RA2_TEXT_OK);
    for (uint32_t i = 0; i < height * pitch; ++i) assert(pixels[i] == 0);

    /* A pitched surface view needs only its visible last row, not its trailing padding. */
    size_t minimal_size = (height - 1) * pitch + width;
    uint8_t *minimal = (uint8_t *)malloc(minimal_size);
    assert(minimal != NULL);
    memset(minimal, 0x40, minimal_size);
    assert(ra2_text_layout_render_mask(layout, minimal, width, height, pitch, 3, 2) == RA2_TEXT_OK);
    int increased_coverage = 0;
    for (size_t i = 0; i < minimal_size; ++i) {
        assert(minimal[i] >= 0x40);
        increased_coverage |= minimal[i] > 0x40;
    }
    assert(increased_coverage);
    free(minimal);

    free(pixels);
    ra2_text_layout_destroy(layout);

    /* Whitespace has no ink, but its logical advance still occupies the
     * retained union mask used by render_mask and must count toward caches. */
    const uint16_t spaces[] = { ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ' };
    layout = NULL;
    assert(ra2_text_layout_utf16(engine, 0, spaces, 8, 24.0f, 0.0f, &layout) == RA2_TEXT_OK);
    assert(layout != NULL);
    assert(ra2_text_layout_get_metrics(layout, &metrics) == RA2_TEXT_OK);
    assert(metrics.ink_width == 0 && metrics.ink_height == 0);
    assert(ra2_text_layout_get_storage_bytes(layout, &retained_storage_bytes) == RA2_TEXT_OK);
    assert(retained_storage_bytes > 0);
    uint8_t *white_prefix = (uint8_t *)calloc(64, 72);
    assert(white_prefix != NULL);
    assert(ra2_text_layout_render_mask_prefix(layout, white_prefix, 64, 64, 72, 0, 0, 0) == RA2_TEXT_OK);
    for (size_t i = 0; i < 64 * 72; ++i) assert(white_prefix[i] == 0);
    assert(ra2_text_layout_render_mask_prefix(layout, white_prefix, 64, 64, 72, 0, 0, SIZE_MAX) == RA2_TEXT_OK);
    for (size_t i = 0; i < 64 * 72; ++i) assert(white_prefix[i] == 0);
    free(white_prefix);
    ra2_text_layout_destroy(layout);
    ra2_text_engine_destroy(engine);
    puts("C ABI text harness: pass");
    return 0;
}
