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
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <process.h>
#else
#include <pthread.h>
#endif

#define FONT_SIZE 0x80
#define OFF_PIXELS 0x0C
#define OFF_PITCH 0x10
#define OFF_LINEHEIGHT 0x1C
#define OFF_FG 0x24
#define OFF_CLIP 0x30
#define OFF_CLIP_ENABLED 0x41

#define GUARD 64
#define CANARY 0xA5
#define TEST_CACHE_LIMIT (8u * 1024u * 1024u)

extern size_t text_guest_test_cache_bytes(void);
extern uint32_t text_guest_test_cache_entries(void);

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

#ifdef _WIN32
static unsigned __stdcall thread_local_adapter(void *unused) {
#else
static void *thread_local_adapter(void *unused) {
#endif
    (void)unused;
    assert(text_guest_enabled() == 0);
    assert(text_guest_test_cache_entries() == 0);
    text_guest_set_enabled(1);
    text_guest_set_all(1);
    Fixture f = make_fixture(64, 20, 64, 0xFFFF);
    uint16_t text[] = { 'T', 0 };
    int32_t width = -1, height = -1;
    assert(text_guest_measure(va(f.font), va(text), 0, &width, &height) == 1);
    assert(width > 0 && text_guest_test_cache_entries() == 1);
    free_fixture(&f);
    text_guest_set_enabled(0);
#ifdef _WIN32
    return 0;
#else
    return NULL;
#endif
}

static uint16_t units_of(const char *ascii, uint16_t *out) {
    uint16_t n = 0;
    for (; ascii[n]; ++n) out[n] = (uint16_t)(unsigned char)ascii[n];
    out[n] = 0;
    return n;
}

typedef struct { int setups, releases; uint8_t *surface; } FakeCalls;

/* Stand-ins for 004348F0 / 00434990: setup fills the font's surface fields
 * from the surface (full clip), release zeroes them, as the assembly does. */
static void fake_setup(uint32_t font_va, uint32_t surface_va, void *ctx) {
    FakeCalls *c = ctx;
    c->setups++;
    uint8_t *font = (uint8_t *)(uintptr_t)font_va;
    put32(font, OFF_PIXELS, surface_va);
    put32(font, OFF_PITCH, 176);
    put_clip(font, 0, 0, 159, 39);
    put8(font, OFF_CLIP_ENABLED, 1);
    (void)c->surface;
}

static void fake_release(uint32_t font_va, uint32_t surface_va, void *ctx) {
    (void)surface_va;
    FakeCalls *c = ctx;
    c->releases++;
    uint8_t *font = (uint8_t *)(uintptr_t)font_va;
    put32(font, OFF_PIXELS, 0);
    put32(font, OFF_PITCH, 0);
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


    /* Worker-thread state, engine and cache are isolated from the game thread. */
    {
#ifdef _WIN32
        assert(_putenv("RA2_TTF_TEXT=0") == 0);
        uintptr_t thread = _beginthreadex(NULL, 0, thread_local_adapter, NULL, 0, NULL);
        assert(thread != 0);
        assert(WaitForSingleObject((HANDLE)thread, INFINITE) == WAIT_OBJECT_0);
        CloseHandle((HANDLE)thread);
#else
        assert(setenv("RA2_TTF_TEXT", "0", 1) == 0);
        pthread_t thread;
        assert(pthread_create(&thread, NULL, thread_local_adapter, NULL) == 0);
        assert(pthread_join(thread, NULL) == 0);
#endif
        assert(text_guest_enabled() == 1);
        assert(text_guest_test_cache_entries() == 0);
    }

    /* 1b. Only text with Thai is the engine's: a Latin string is refused (the
     * bitmap renderer keeps it), a Thai one is drawn. */
    {
        Fixture f = make_fixture(64, 20, 64, 0xFFFF);
        uint16_t latin[8];
        units_of("RA2", latin);
        uint16_t thai[] = { 'R', 0x0E01, 0x0E35, 0x0E48, 0 };
        int32_t fx = -1, width = -1, height = -1;
        assert(text_guest_label(va(f.font), va(latin), 4, 2, 0, 0, &fx) == 0);
        assert(text_guest_measure(va(f.font), va(latin), 0, &width, &height) == 0);
        int outside;
        assert(changed_pixels(&f, 0, 0, 63, 19, &outside) == 0);
        assert(text_guest_measure(va(f.font), va(thai), 0, &width, &height) == 1);
        assert(width > 0 && height > 0);
        assert(text_guest_label(va(f.font), va(thai), 4, 2, 0, 0, &fx) == 1);
        assert(changed_pixels(&f, 0, 0, 63, 19, &outside) > 0 && outside == 0);
        assert(guards_intact(&f));
        free_fixture(&f);
    }

    /* 1c. Sharp edges keep thin strokes: ส (U+0E2A) is ล (U+0E25) with a small
     * hook, about a third of a pixel thick. A coverage threshold dropped it and
     * drew both alike; the engine's game style keeps it (text/src/sharp.rs). */
    {
        Fixture so = make_fixture(64, 20, 64, 0xFFFF);
        Fixture lo = make_fixture(64, 20, 64, 0xFFFF);
        uint16_t s_text[] = { 0x0E2A, 0 };
        uint16_t l_text[] = { 0x0E25, 0 };
        int32_t fx = -1;
        assert(text_guest_label(va(so.font), va(s_text), 4, 2, 0, 0, &fx) == 1);
        assert(text_guest_label(va(lo.font), va(l_text), 4, 2, 0, 0, &fx) == 1);
        int differing = 0;
        for (uint32_t i = 0; i < so.bytes; i += 2) {
            uint16_t a, b;
            memcpy(&a, so.pixels + i, 2);
            memcpy(&b, lo.pixels + i, 2);
            int ga = (a >> 5) & 0x3F, gb = (b >> 5) & 0x3F; /* white on black: green is brightness */
            differing += (ga > gb ? ga - gb : gb - ga) >= 32;
        }
        assert(differing >= 2);
        free_fixture(&so);
        free_fixture(&lo);
    }

    /* The rest of the cases run on Latin text: give the engine every string. */
    text_guest_set_all(1);

    /* Retained mask storage for long whitespace layouts is charged to the
     * cache, and the byte cap evicts before 64 such entries accumulate. */
    {
        uint16_t *spaces = malloc((5000u + 1u) * sizeof(uint16_t));
        assert(spaces != NULL);
        for (uint32_t i = 0; i < 5000; ++i) spaces[i] = ' ';
        spaces[5000] = 0;
        int32_t width = -1, height = -1;
        Fixture f = make_fixture(64, 20, 64, 0xFFFF);
        size_t before = text_guest_test_cache_bytes();
        spaces[4999] = 'A';
        assert(text_guest_measure(va(f.font), va(spaces), 16384, &width, &height) == 1);
        assert(text_guest_test_cache_bytes() - before > 100000u);
        for (uint32_t i = 0; i < 64; ++i) {
            spaces[4999] = (uint16_t)('A' + i);
            assert(text_guest_measure(va(f.font), va(spaces), 16384, &width, &height) == 1);
        }
        assert(text_guest_test_cache_entries() < 64u);
        assert(text_guest_test_cache_bytes() <= TEST_CACHE_LIMIT);
        free_fixture(&f);
        free(spaces);
    }

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

    /* A bounded string need not contain a terminator at max_units; this
     * also runs in the browser harness where protected pages are unavailable. */
    {
        uint16_t exactly_bounded[] = { 'A' };
        Fixture f = make_fixture(160, 24, 160, 0xFFFF);
        int32_t fx = -1;
        assert(text_guest_label(va(f.font), va(exactly_bounded), 0, 0, 1, 0, &fx) == 1);
        assert(fx > 0);
        free_fixture(&f);
    }

    /* A bounded non-terminated string may end immediately before an
     * inaccessible page. The adapter must not probe the next UTF-16 unit. */
#ifdef _WIN32
    {
        SYSTEM_INFO si;
        GetSystemInfo(&si);
        uint8_t *guarded = VirtualAlloc(NULL, si.dwPageSize * 2, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
        assert(guarded != NULL);
        DWORD old_protect;
        assert(VirtualProtect(guarded + si.dwPageSize, si.dwPageSize, PAGE_NOACCESS, &old_protect));
        uint16_t *last_unit = (uint16_t *)(guarded + si.dwPageSize - sizeof(uint16_t));
        *last_unit = 'A';
        Fixture f = make_fixture(160, 24, 160, 0xFFFF);
        int32_t fx = -1;
        assert(text_guest_label(va(f.font), va(last_unit), 0, 0, 1, 0, &fx) == 1);
        assert(fx > 0);
        assert(VirtualFree(guarded, 0, MEM_RELEASE));
        free_fixture(&f);
    }
#endif

    /* 8. Reveal changes ink progressively while the full-layout advance stays
     * stable for measurement and positioning. */
    {
        Fixture f = make_fixture(160, 24, 160, 0xFFFF);
        uint16_t text[8];
        units_of("RA", text); /* 2 units */
        int32_t fx = -1;
        assert(text_guest_label(va(f.font), va(text), 0, 0, 0, 1, &fx) == 1);
        int outside, partial = changed_pixels(&f, 0, 0, 159, 23, &outside);
        assert(partial > 0 && outside == 0);
        int32_t partial_x = fx;
        memset(f.pixels, 0, f.bytes);
        assert(text_guest_label(va(f.font), va(text), 0, 0, 0, 20, &fx) == 1);
        int full = changed_pixels(&f, 0, 0, 159, 23, &outside);
        assert(full > partial);
        int32_t width = -1, height = -1;
        assert(text_guest_measure(va(f.font), va(text), 0, &width, &height) == 1);
        assert(partial_x == fx && fx == width);
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

    /* 10. Tab and CR/LF keep the original path's semantics: fall back, both
     * for measurement and for drawing, so the two never disagree. */
    {
        Fixture f = make_fixture(160, 24, 160, 0xFFFF);
        uint16_t tab[] = { 'A', 0x09, 'B', 0 };
        uint16_t crlf[] = { 'A', 0x0D, 0x0A, 'B', 0 };
        int32_t fx = -1, w = -1, h = -1;
        assert(text_guest_label(va(f.font), va(tab), 0, 0, 0, 0, &fx) == 0);
        assert(text_guest_measure(va(f.font), va(tab), 0, &w, &h) == 0);
        assert(text_guest_label(va(f.font), va(crlf), 0, 0, 0, 0, &fx) == 0);
        assert(text_guest_measure(va(f.font), va(crlf), 0, &w, &h) == 0);
        int outside;
        assert(changed_pixels(&f, 0, 0, 159, 23, &outside) == 0);
        free_fixture(&f);
    }

    /* 11. Off again: the adapter stops handling calls. */
    text_guest_set_enabled(0);
    {
        Fixture f = make_fixture(64, 20, 64, 0xFFFF);
        uint16_t text[8];
        units_of("RA2", text);
        int32_t fx = -1;
        assert(text_guest_label(va(f.font), va(text), 4, 2, 0, 0, &fx) == 0);
        free_fixture(&f);
    }

    text_guest_set_enabled(1); /* the earlier "off again" case turned it off */

    /* 12. Paragraph: setup and release run once each around the draw; the
     * surface is written only inside the clip; the wrapped layout is aligned. */
    {
        Fixture f = make_fixture(160, 40, 176, 0xFFFF);
        uint16_t text[] = { 'R', 'A', ' ', 'T', 'T', 'F', ' ', 'W', 'R', 'A', 'P', ' ', 'L', 'O', 'N', 'G', ' ',
                            'T', 'E', 'X', 'T', 'H', 'E', 'R', 'E', 0 };
        struct { int setups, releases; uint8_t *surface; } calls = { 0, 0, f.pixels };
        int outside;
        int32_t dummy = 0;
        (void)dummy;
        assert(text_guest_paragraph(va(f.font), va(f.pixels), va(text), 4, 2, 150, 0, 0, 0, 0,
                                    fake_setup, fake_release, &calls) == 1);
        assert(calls.setups == 1 && calls.releases == 1);
        assert(changed_pixels(&f, 0, 0, 159, 39, &outside) > 0);
        assert(outside == 0);
        assert(guards_intact(&f));
        free_fixture(&f);
    }

    /* 13. Controls and layouts taller than maxHeight fall back, while active
     * paragraph reveals use a prefix of the full layout through setup/release. */
    {
        Fixture f = make_fixture(160, 40, 176, 0xFFFF);
        uint16_t lf[] = { 'A', 0x0A, 'B', 0 };
        uint16_t text[] = { 'R', 'A', ' ', 'T', 'T', 'F', ' ', 'W', 'R', 'A', 'P', ' ', 'L', 'O', 'N', 'G', 0 };
        struct { int setups, releases; uint8_t *surface; } calls = { 0, 0, f.pixels };
        assert(text_guest_paragraph(va(f.font), va(f.pixels), va(lf), 0, 0, 0, 0, 0, 0, 0,
                                    fake_setup, fake_release, &calls) == 0);
        assert(text_guest_paragraph(va(f.font), va(f.pixels), va(text), 0, 0, 40, 4, 0, 0, 0,
                                    fake_setup, fake_release, &calls) == 0);
        assert(calls.setups == 0 && calls.releases == 0);
        assert(text_guest_paragraph(va(f.font), va(f.pixels), va(text), 0, 0, 0, 0, 0, 2, 0,
                                    fake_setup, fake_release, &calls) == 1);
        assert(calls.setups == 1 && calls.releases == 1);
        int outside;
        assert(changed_pixels(&f, 0, 0, 159, 39, &outside) > 0);
        free_fixture(&f);
    }

    /* 14. Alignment bits follow the original paragraph (0x00434CD0): bit 0x1
     * centres, bit 0x2 right-aligns, neither is left. A centred or right
     * paragraph must move its ink right inside the wrap width. */
    {
        Fixture f = make_fixture(160, 24, 176, 0xFFFF);
        uint16_t text[8];
        units_of("RA", text);
        FakeCalls calls = { 0, 0, f.pixels };
        int leftmost[3];
        const uint32_t flags[3] = { 0, 1, 2 };
        for (int k = 0; k < 3; ++k) {
            memset(f.pixels, 0, f.bytes);
            assert(text_guest_paragraph(va(f.font), va(f.pixels), va(text), 0, 0, 150, 0, flags[k], 0, 0,
                                        fake_setup, fake_release, &calls) == 1);
            leftmost[k] = -1;
            for (int x = 0; x < 160 && leftmost[k] < 0; ++x)
                for (int y = 0; y < 24; ++y) {
                    uint16_t px;
                    memcpy(&px, f.pixels + (y * f.pitch + x) * 2, 2);
                    if (px) { leftmost[k] = x; break; }
                }
            assert(leftmost[k] >= 0);
        }
        assert(leftmost[1] > leftmost[0] + 20); /* centred: about half the free width */
        assert(leftmost[2] > leftmost[1] + 20); /* right: the whole free width */
        free_fixture(&f);
    }

    puts("guest ABI text harness: pass");
    return 0;
}
