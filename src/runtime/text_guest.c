/*
 * Guest adapter for the CPU TTF text engine.
 *
 * Reads the proven font-object fields (see text_guest.h) from flat guest
 * memory, measures and draws a whole string through one shaped layout, and
 * max-composites the engine's A8 coverage into the 16-bit destination. Any
 * condition it cannot prove safe returns 0 so the original renderer runs.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "text_guest.h"

#ifdef RA2_TTF_TEXT
#include "text_engine.h"
#endif

/* Proven font-object offsets (YR asm 0x00434500 and sibling notes). */
#define FONT_PIXELS 0x0C
#define FONT_PITCH 0x10
#define FONT_LINEHEIGHT 0x1C
#define FONT_FOREGROUND 0x24
#define FONT_CLIP 0x30
#define FONT_CLIP_ENABLED 0x41

/* Style for the bundled Latin face, from the plan's fitted values. Tune with
 * visual QA; tests check consistency, not these exact numbers. */
#define STYLE_PX 12.6f
#define STYLE_WEIGHT 700.0f
#define STYLE_WIDTH 0.82f

#define TEXT_MAX_UNITS (16u * 1024u)
#define CACHE_ENTRIES 64u
#define CACHE_BYTES (8u * 1024u * 1024u)
#define REVEAL_TAIL 8

static TextGuestPixelFormat g_format = { 11, 5, 5, 6, 0, 5 }; /* RGB565 */
static int g_on;
static int g_env_checked;

static uint32_t rd32(uint32_t va) { uint32_t v; memcpy(&v, (const void *)(uintptr_t)va, 4); return v; }
static int32_t rds32(uint32_t va) { return (int32_t)rd32(va); }
static uint16_t rd16(uint32_t va) { uint16_t v; memcpy(&v, (const void *)(uintptr_t)va, 2); return v; }
static uint8_t rd8(uint32_t va) { return *(const uint8_t *)(uintptr_t)va; }

/* Tab and line breaks have layout meaning the original path owns, so the
 * adapter declines them for measuring, drawing and paragraphs alike. */
static int has_layout_control(const uint16_t *units, uint32_t count) {
    for (uint32_t i = 0; i < count; ++i)
        if (units[i] == 0x09 || units[i] == 0x0D || units[i] == 0x0A) return 1;
    return 0;
}

/* Copy the wide string out of guest memory. max_units 0 reads until NUL.
 * A cut that would leave a lone high surrogate drops that unit, so a
 * truncated supplementary character is never drawn as a replacement. */
static int read_units(uint32_t text_va, uint32_t max_units, uint16_t *out, uint32_t *count) {
    uint32_t limit = max_units ? max_units : TEXT_MAX_UNITS;
    if (limit > TEXT_MAX_UNITS) limit = TEXT_MAX_UNITS;
    uint32_t n = 0;
    for (;;) {
        uint16_t u = rd16(text_va + n * 2);
        if (u == 0) break;
        if (n == limit) {
            if (max_units == 0) return 0; /* no terminator within the cap: refuse */
            break;
        }
        out[n++] = u;
    }
    if (max_units && n == max_units && n > 0 && out[n - 1] >= 0xD800 && out[n - 1] <= 0xDBFF)
        n--;
    *count = n;
    return 1;
}

/* The destination of a draw: the pixels, their pitch in 16-bit units, and
 * the inclusive clip. Read from the font object once a surface is set up. */
typedef struct {
    uint32_t pixels;
    uint32_t pitch;
    int32_t l, t, r, b;
    uint16_t fg;
} Target;

static int read_target(uint32_t font_va, Target *tg) {
    tg->pixels = rd32(font_va + FONT_PIXELS);
    tg->pitch = rd32(font_va + FONT_PITCH);
    tg->l = rds32(font_va + FONT_CLIP);
    tg->t = rds32(font_va + FONT_CLIP + 4);
    tg->r = rds32(font_va + FONT_CLIP + 8);
    tg->b = rds32(font_va + FONT_CLIP + 12);
    tg->fg = rd16(font_va + FONT_FOREGROUND);
    if (!tg->pixels || !tg->pitch || !rd8(font_va + FONT_CLIP_ENABLED)) return 0;
    if (tg->l < 0 || tg->t < 0 || tg->l > tg->r || tg->t > tg->b) return 0;
    if ((uint32_t)tg->r >= tg->pitch) return 0;
    return 1;
}

#ifdef RA2_TTF_TEXT

typedef struct {
    uint16_t *units;
    uint32_t count;
    float px;
    float wrap;
    float line_height;
    int alignment;
    RA2TextLayout *layout;
    RA2TextMetrics metrics;
    size_t bytes;
    uint32_t stamp;
} CacheEntry;

static RA2TextEngine *g_engine;
static CacheEntry g_cache[CACHE_ENTRIES];
static uint32_t g_cache_used;
static size_t g_cache_bytes;
static uint32_t g_stamp;

static int ensure_engine(void) {
    if (!g_engine) g_engine = ra2_text_engine_create();
    return g_engine != NULL;
}

static void cache_drop(CacheEntry *e) {
    if (e->layout) ra2_text_layout_destroy(e->layout);
    free(e->units);
    g_cache_bytes -= e->bytes;
    memset(e, 0, sizeof *e);
}

static void cache_evict_one(void) {
    uint32_t oldest = 0;
    for (uint32_t i = 1; i < CACHE_ENTRIES; ++i)
        if (g_cache[i].layout && (!g_cache[oldest].layout || g_cache[i].stamp < g_cache[oldest].stamp))
            oldest = i;
    if (g_cache[oldest].layout) {
        cache_drop(&g_cache[oldest]);
        g_cache_used--;
    }
}

/* Find or build the one layout that measurement and drawing both use. The
 * cache copies the units; it never keeps a guest pointer. */
static CacheEntry *layout_for(const uint16_t *units, uint32_t count, float line_height,
                              float wrap, int alignment) {
    for (uint32_t i = 0; i < CACHE_ENTRIES; ++i) {
        CacheEntry *e = &g_cache[i];
        if (e->layout && e->count == count && e->px == STYLE_PX && e->line_height == line_height &&
            e->wrap == wrap && e->alignment == alignment && memcmp(e->units, units, (size_t)count * 2) == 0) {
            e->stamp = ++g_stamp;
            return e;
        }
    }

    RA2TextLayout *layout = NULL;
    if (ra2_text_layout_utf16_ex(g_engine, 0, units, count, STYLE_PX, wrap, line_height,
                                 (uint32_t)alignment, STYLE_WEIGHT, STYLE_WIDTH, &layout) != RA2_TEXT_OK || !layout)
        return NULL;
    RA2TextMetrics m;
    if (ra2_text_layout_get_metrics(layout, &m) != RA2_TEXT_OK) {
        ra2_text_layout_destroy(layout);
        return NULL;
    }
    size_t bytes = (size_t)count * 2 + (size_t)m.ink_width * m.ink_height + sizeof(CacheEntry);
    if (bytes > CACHE_BYTES) { /* too large to keep: decline */
        ra2_text_layout_destroy(layout);
        return NULL;
    }
    while (g_cache_used >= CACHE_ENTRIES || g_cache_bytes + bytes > CACHE_BYTES) {
        cache_evict_one();
        if (!g_cache_used) break;
    }
    for (uint32_t i = 0; i < CACHE_ENTRIES; ++i) {
        if (!g_cache[i].layout) {
            CacheEntry *e = &g_cache[i];
            e->units = malloc((size_t)(count ? count : 1) * 2);
            if (!e->units) { ra2_text_layout_destroy(layout); return NULL; }
            memcpy(e->units, units, (size_t)count * 2);
            e->count = count;
            e->px = STYLE_PX;
            e->wrap = wrap;
            e->line_height = line_height;
            e->alignment = alignment;
            e->layout = layout;
            e->metrics = m;
            e->bytes = bytes;
            e->stamp = ++g_stamp;
            g_cache_used++;
            g_cache_bytes += bytes;
            return e;
        }
    }
    ra2_text_layout_destroy(layout);
    return NULL;
}

/* Expand a channel of the 16-bit pixel to 8 bits, and pack back. */
static uint8_t chan8(uint16_t px, uint8_t shift, uint8_t bits) {
    uint32_t max = (1u << bits) - 1u;
    uint32_t c = ((uint32_t)px >> shift) & max;
    return (uint8_t)((c * 255u + max / 2u) / max);
}

static uint16_t chan_pack(uint8_t v8, uint8_t shift, uint8_t bits) {
    uint32_t max = (1u << bits) - 1u;
    return (uint16_t)((((uint32_t)v8 * max + 127u) / 255u) << shift);
}

static uint8_t blend8(uint8_t dst, uint8_t src, uint8_t a) {
    int v = dst + ((int)src - (int)dst) * (int)a / 255;
    return (uint8_t)(v < 0 ? 0 : v > 255 ? 255 : v);
}

/* Max-composite one shaped layout into the target, with its logical origin
 * at (x, y). Coverage is rendered for the ink box only; the origin places ink
 * at (0,0). Pixels outside the clip are never written. */
static int draw_layout(const Target *tg, const CacheEntry *e, int32_t x, int32_t y) {
    RA2TextMetrics m = e->metrics;
    if (m.ink_width == 0 || m.ink_height == 0) return 1;
    size_t area = (size_t)m.ink_width * m.ink_height;
    uint8_t *cover = calloc(area, 1);
    if (!cover) return 0;
    if (ra2_text_layout_render_mask(e->layout, cover, m.ink_width, m.ink_height, m.ink_width,
                                    -m.ink_x, -m.ink_y) != RA2_TEXT_OK) {
        free(cover);
        return 0;
    }
    uint8_t fr = chan8(tg->fg, g_format.r_shift, g_format.r_bits);
    uint8_t fgc = chan8(tg->fg, g_format.g_shift, g_format.g_bits);
    uint8_t fb = chan8(tg->fg, g_format.b_shift, g_format.b_bits);
    for (uint32_t j = 0; j < m.ink_height; ++j) {
        int32_t sy = y + m.ink_y + (int32_t)j;
        if (sy < tg->t || sy > tg->b) continue;
        for (uint32_t i = 0; i < m.ink_width; ++i) {
            uint8_t a = cover[(size_t)j * m.ink_width + i];
            int32_t sx = x + m.ink_x + (int32_t)i;
            if (!a || sx < tg->l || sx > tg->r) continue;
            uint16_t *dst = (uint16_t *)(uintptr_t)(tg->pixels + ((uint32_t)sy * tg->pitch + (uint32_t)sx) * 2u);
            uint16_t px = *dst;
            uint8_t dr = blend8(chan8(px, g_format.r_shift, g_format.r_bits), fr, a);
            uint8_t dg = blend8(chan8(px, g_format.g_shift, g_format.g_bits), fgc, a);
            uint8_t db = blend8(chan8(px, g_format.b_shift, g_format.b_bits), fb, a);
            *dst = (uint16_t)(chan_pack(dr, g_format.r_shift, g_format.r_bits) |
                              chan_pack(dg, g_format.g_shift, g_format.g_bits) |
                              chan_pack(db, g_format.b_shift, g_format.b_bits));
        }
    }
    free(cover);
    return 1;
}

#endif /* RA2_TTF_TEXT */

static void ensure_env_checked(void) {
    if (g_env_checked) return;
    g_env_checked = 1;
    const char *v = getenv("RA2_TTF_TEXT");
    if (v && v[0] == '1' && v[1] == 0) g_on = 1;
}

int text_guest_set_enabled(int on) {
    int prev;
    ensure_env_checked();
    prev = g_on;
#ifdef RA2_TTF_TEXT
    g_on = on != 0;
#else
    if (on) fprintf(stderr, "--ttf-text: this build has no CPU TTF text engine\n");
    g_on = 0;
#endif
    return prev;
}

int text_guest_enabled(void) {
    ensure_env_checked();
    return g_on;
}

void text_guest_set_pixel_format(const TextGuestPixelFormat *fmt) {
    if (fmt) g_format = *fmt;
}

int text_guest_measure(uint32_t font_va, uint32_t text_va, int32_t wrap_px,
                       int32_t *width_out, int32_t *height_out) {
    ensure_env_checked();
    if (!g_on) return 0;
#ifdef RA2_TTF_TEXT
    if (!font_va || !text_va || !width_out || !height_out || wrap_px < 0 || wrap_px > 16384)
        return 0;
    uint16_t units[TEXT_MAX_UNITS];
    uint32_t count = 0;
    if (!read_units(text_va, 0, units, &count)) return 0;
    if (has_layout_control(units, count)) return 0;
    if (!ensure_engine()) return 0;
    float line_height = (float)rd32(font_va + FONT_LINEHEIGHT);
    if (count == 0) {
        *width_out = 0;
        *height_out = (int32_t)line_height;
        return 1;
    }
    CacheEntry *e = layout_for(units, count, line_height, (float)wrap_px, 0);
    if (!e) return 0;
    *width_out = (int32_t)(e->metrics.advance_x + 0.5f);
    *height_out = (int32_t)(e->metrics.height + 0.5f);
    return 1;
#else
    (void)font_va; (void)text_va; (void)wrap_px; (void)width_out; (void)height_out;
    return 0;
#endif
}

int text_guest_label(uint32_t font_va, uint32_t text_va, int32_t x, int32_t y,
                     uint32_t max_units, int32_t reveal, int32_t *final_x) {
    ensure_env_checked();
    if (!g_on) return 0;
#ifdef RA2_TTF_TEXT
    if (!font_va || !text_va || !final_x || reveal < 0) return 0;

    Target tg;
    if (!read_target(font_va, &tg)) return 0;
    float line_height = (float)rd32(font_va + FONT_LINEHEIGHT);

    uint16_t units[TEXT_MAX_UNITS];
    uint32_t count = 0;
    if (!read_units(text_va, max_units, units, &count)) return 0;
    if (has_layout_control(units, count)) return 0;

    /* A positive reveal is plain TTF only after the highlight has passed. */
    if (reveal > 0 && (uint32_t)reveal < count + REVEAL_TAIL) return 0;
    if (!ensure_engine()) return 0;

    if (count == 0) {
        *final_x = x;
        return 1;
    }
    CacheEntry *e = layout_for(units, count, line_height, 0.0f, 0);
    if (!e) return 0;
    *final_x = x + (int32_t)(e->metrics.advance_x + 0.5f);
    return draw_layout(&tg, e, x, y);
#else
    (void)font_va; (void)text_va; (void)x; (void)y; (void)max_units; (void)reveal; (void)final_x;
    return 0;
#endif
}

int text_guest_paragraph(uint32_t font_va, uint32_t surface_va, uint32_t text_va,
                         int32_t x, int32_t y, int32_t wrap_px, int32_t max_height,
                         uint32_t align_flags, int32_t reveal, int32_t reveal_range,
                         TextGuestSurfaceFn setup, TextGuestSurfaceFn release, void *ctx) {
    ensure_env_checked();
    if (!g_on) return 0;
#ifdef RA2_TTF_TEXT
    if (!font_va || !surface_va || !text_va || !setup || !release) return 0;
    if (wrap_px < 0 || wrap_px > 16384 || max_height < 0 || reveal < 0 || reveal_range < 0) return 0;

    uint16_t units[TEXT_MAX_UNITS];
    uint32_t count = 0;
    if (!read_units(text_va, 0, units, &count)) return 0;
    if (count == 0 || has_layout_control(units, count)) return 0;
    /* A reveal is plain TTF only once every unit and the highlight have shown. */
    if (reveal > 0 && (uint32_t)reveal < count + (uint32_t)reveal_range + 1u) return 0;
    if (!ensure_engine()) return 0;

    /* The original paragraph (0x00434CD0) tests bit 0x1 for centre first, then
     * bit 0x2 for right; neither is left. */
    int alignment = (align_flags & 1u) ? 1 : (align_flags & 2u) ? 2 : 0;
    float line_height = (float)rd32(font_va + FONT_LINEHEIGHT);
    CacheEntry *e = layout_for(units, count, line_height, (float)wrap_px, alignment);
    if (!e) return 0;
    /* Declining a taller layout keeps the original's line-limit behaviour. */
    if (max_height > 0 && e->metrics.height > (float)max_height) return 0;

    /* The surface is set up only for a call we handle, and always released. */
    setup(font_va, surface_va, ctx);
    Target tg;
    int ok = read_target(font_va, &tg);
    if (ok) ok = draw_layout(&tg, e, x, y);
    release(font_va, surface_va, ctx);
    return ok;
#else
    (void)font_va; (void)surface_va; (void)text_va; (void)x; (void)y; (void)wrap_px;
    (void)max_height; (void)align_flags; (void)reveal; (void)reveal_range;
    (void)setup; (void)release; (void)ctx;
    return 0;
#endif
}
