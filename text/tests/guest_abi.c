/*
 * Guest adapter behavior, run against the real Rust engine.
 *
 * The harness is a 32-bit program, so a guest virtual address is a host
 * pointer (flat memory, as in the game). Font objects are fake, but their
 * offsets come from the proven YR/RA2 assembly contract:
 *   +0x0C destination pixels, +0x10 pitch in 16-bit pixels, +0x1C native
 *   line height, +0x24 foreground RGB, +0x30..+0x3C inclusive clip
 *   (left, top, right, bottom), +0x41 clipping enabled.
 * Each buffer is surrounded by canary bytes so writes outside the allowed
 * region fail the assertions instead of passing silently.
 */
#include "../../src/runtime/text_guest.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FONT_SIZE 0x80
#define OFF_PIXELS 0x0C
#define OFF_PITCH 0x10
#define OFF_LINEHEIGHT 0x1C
#define OFF_FG 0x24
#define OFF_CLIP 0x30
#define OFF_CLIP_ENABLED 0x41

#define GUARD 64
#define CANARY 0xA5

typedef struct {
    uint8_t *alloc;   /* guarded allocation */
    uint8_t *pixels;  /* visible surface, guest-addressable */
    uint32_t bytes;   /* visible bytes */
    uint8_t *font;    /* fake font object */
    uint32_t width, height, pitch;
} Fixture;

static uint32_t va(const void *p) { return (uint32_t)(uintptr_t)p; }

static void put32(uint8_t *base, unsigned off, uint32_t v) { memcpy(base + off, &v, 4); }
static void put16(uint8_t *base, unsigned off, uint16_t v) { memcpy(base + off, &v, 2); }
static void put8(uint8_t *base, unsigned off, uint8_t v) { base[off] = v; }
static void put_clip(uint8_t *font, int32_t l, int32_t t, int32_t r, int32_t b) {
    int32_t c[4] = { l, t, r, b };
    memcpy(font + OFF_CLIP, c, sizeof c);
}

static Fixture make_fixture(uint32_t width, uint32_t height, uint32_t pitch, uint16_t fg) {
    Fixture f;
    f.width = width;
    f.height = height;
    f.pitch = pitch;
    f.bytes = pitch * height * 2;
    f.alloc = malloc(f.bytes + 2 * GUARD);
    assert(f.alloc != NULL);
    memset(f.alloc, CANARY, f.bytes + 2 * GUARD);
    f.pixels = f.alloc + GUARD;
    memset(f.pixels, 0, f.bytes);

    f.font = calloc(1, FONT_SIZE);
    assert(f.font != NULL);
    put32(f.font, OFF_PIXELS, va(f.pixels));
    put32(f.font, OFF_PITCH, pitch);
    put32(f.font, OFF_LINEHEIGHT, 16);
    put16(f.font, OFF_FG, fg);
    put_clip(f.font, 0, 0, (int32_t)width - 1, (int32_t)height - 1);
    put8(f.font, OFF_CLIP_ENABLED, 1);
    return f;
}

static void free_fixture(Fixture *f) {
    free(f->alloc);
    free(f->font);
}

static int guards_intact(const Fixture *f) {
    for (int i = 0; i < GUARD; ++i) {
        if (f->alloc[i] != CANARY) return 0;
        if (f->alloc[GUARD + f->bytes + i] != CANARY) return 0;
    }
    return 1;
}

/* Count bytes that changed from zero, and check they lie inside [l..r]x[t..b]. */
static int changed_pixels(const Fixture *f, int l, int t, int r, int b, int *outside) {
    int changed = 0;
    *outside = 0;
    for (uint32_t y = 0; y < f->height; ++y) {
        for (uint32_t x = 0; x < f->pitch; ++x) {
            uint16_t px;
            memcpy(&px, f->pixels + (y * f->pitch + x) * 2, 2);
            if (!px) continue;
            changed++;
            if ((int)x < l || (int)x > r || (int)y < t || (int)y > b) (*outside)++;
        }
    }
    return changed;
}

static uint16_t units_of(const char *ascii, uint16_t *out) {
    uint16_t n = 0;
    for (; ascii[n]; ++n) out[n] = (uint16_t)(unsigned char)ascii[n];
    out[n] = 0;
    return n;
}

static void set_565(void) {
    TextGuestPixelFormat fmt = { 11, 5, 5, 6, 0, 5 };
    text_guest_set_pixel_format(&fmt);
}

int main(void) {
    set_565();

    /* 1. Disabled by default: the caller keeps the original renderer. */
    text_guest_set_enabled(0);
    {
        Fixture f = make_fixture(64, 20, 64, 0xFFFF);
        uint16_t text[8];
        units_of("RA2", text);
        int32_t fx = -1;
        assert(text_guest_label(va(f.font), va(text), 4, 2, 0, 0, &fx) == 0);
        int outside;
        assert(changed_pixels(&f, 0, 0, 63, 19, &outside) == 0);
        assert(guards_intact(&f));
        free_fixture(&f);
    }

    text_guest_set_enabled(1);

    /* 2. Enabled Latin label: ink appears, the caret advances, canaries survive. */
    {
        Fixture f = make_fixture(160, 24, 176, 0xFFFF);
        uint16_t text[8];
        units_of("RA2", text);
        int32_t fx = -1;
        assert(text_guest_label(va(f.font), va(text), 10, 4, 0, 0, &fx) == 1);
        assert(fx > 10);
        int outside;
        int changed = changed_pixels(&f, 0, 0, 159, 23, &outside);
        assert(changed > 0);
        assert(outside == 0);
        assert(guards_intact(&f));

        /* 3. Measurement and drawing share one layout: draw advance == measured width. */
        int32_t width = -1, height = -1;
        assert(text_guest_measure(va(f.font), va(text), 0, &width, &height) == 1);
        assert(fx == 10 + width);
        assert(height > 0);
        free_fixture(&f);
    }

    /* 4. Clip rectangle: nothing lands outside the inclusive clip. */
    {
        Fixture f = make_fixture(160, 24, 176, 0xFFFF);
        put_clip(f.font, 12, 6, 40, 14);
        uint16_t text[8];
        units_of("RA2 Test", text);
        int32_t fx = -1;
        assert(text_guest_label(va(f.font), va(text), 10, 4, 0, 0, &fx) == 1);
        int outside;
        assert(changed_pixels(&f, 12, 6, 40, 14, &outside) > 0);
        assert(outside == 0);
        assert(guards_intact(&f));
        free_fixture(&f);
    }

    /* 5. No safe bounds (clip disabled): fall back rather than guess. */
    {
        Fixture f = make_fixture(64, 20, 64, 0xFFFF);
        put8(f.font, OFF_CLIP_ENABLED, 0);
        uint16_t text[8];
        units_of("RA2", text);
        int32_t fx = -1;
        assert(text_guest_label(va(f.font), va(text), 4, 2, 0, 0, &fx) == 0);
        int outside;
        assert(changed_pixels(&f, 0, 0, 63, 19, &outside) == 0);
        free_fixture(&f);
    }

    /* 6. Pitch padding beyond the visible width is never written. */
    {
        Fixture f = make_fixture(64, 20, 71, 0xFFFF);
        put_clip(f.font, 0, 0, 63, 19);
        uint16_t text[8];
        units_of("RA2 WIDE", text);
        int32_t fx = -1;
        assert(text_guest_label(va(f.font), va(text), 0, 0, 0, 0, &fx) == 1);
        for (uint32_t y = 0; y < f.height; ++y)
            for (uint32_t x = 64; x < f.pitch; ++x) {
                uint16_t px;
                memcpy(&px, f.pixels + (y * f.pitch + x) * 2, 2);
                assert(px == 0);
            }
        assert(guards_intact(&f));
        free_fixture(&f);
    }

    /* 7. A high surrogate cut by max_units is dropped, never drawn alone. */
    {
        Fixture f = make_fixture(160, 24, 160, 0xFFFF);
        uint16_t text[] = { 'A', 0xD83D, 0xDE00, 'B', 0 };
        int32_t fx = -1;
        assert(text_guest_label(va(f.font), va(text), 0, 0, 2, 0, &fx) == 1);
        uint16_t only_a[] = { 'A', 0 };
        int32_t width = -1, height = -1;
        assert(text_guest_measure(va(f.font), va(only_a), 0, &width, &height) == 1);
        assert(fx == width);
        free_fixture(&f);
    }

    /* 8. Reveal: a settled caption (count >= units + 8) is plain TTF; an active one falls back. */
    {
        Fixture f = make_fixture(160, 24, 160, 0xFFFF);
        uint16_t text[8];
        units_of("RA", text); /* 2 units */
        int32_t fx = -1;
        assert(text_guest_label(va(f.font), va(text), 0, 0, 0, 5, &fx) == 0);
        assert(text_guest_label(va(f.font), va(text), 0, 0, 0, 20, &fx) == 1);
        free_fixture(&f);
    }

    /* 9. Malformed inputs fall back without touching memory. */
    {
        Fixture f = make_fixture(64, 20, 64, 0xFFFF);
        uint16_t text[8];
        units_of("RA2", text);
        int32_t fx = -1;
        int32_t w = -1, h = -1;
        assert(text_guest_label(0, va(text), 0, 0, 0, 0, &fx) == 0);
        assert(text_guest_label(va(f.font), 0, 0, 0, 0, 0, &fx) == 0);
        assert(text_guest_measure(0, va(text), 0, &w, &h) == 0);
        put_clip(f.font, 30, 0, 10, 19); /* inverted clip */
        assert(text_guest_label(va(f.font), va(text), 0, 0, 0, 0, &fx) == 0);
        assert(guards_intact(&f));
        free_fixture(&f);
    }

    /* 10. Off again: the adapter stops handling calls. */
    text_guest_set_enabled(0);
    {
        Fixture f = make_fixture(64, 20, 64, 0xFFFF);
        uint16_t text[8];
        units_of("RA2", text);
        int32_t fx = -1;
        assert(text_guest_label(va(f.font), va(text), 4, 2, 0, 0, &fx) == 0);
        free_fixture(&f);
    }

    puts("guest ABI text harness: pass");
    return 0;
}
