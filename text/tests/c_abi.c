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
    ra2_text_engine_destroy(engine);
    puts("C ABI text harness: pass");
    return 0;
}
