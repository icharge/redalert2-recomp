/*
 * Thai bitmap-font shaping for the translated RA2/YR renderer.
 *
 * Unlike the original DLL build, this operates at lifted call boundaries:
 * RECOMP_THAI_CALL calls the original translated function with the current
 * guest registers and stack, while this file adjusts the parsed FNT metrics
 * and intercepts the renderer's CP874 mark glyphs.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "recomp_types.h"
#include "recomp_target.h"
#include "recomp_funcs.h"
#include "thai_font.h"

typedef struct ThaiFontState ThaiFontState;
typedef struct ThaiLayoutContext ThaiLayoutContext;

struct ThaiFontState {
    ThaiFontState *next;
    uint8_t *data;
    uint16_t *map;
    uint8_t *records;
    uint8_t *original_widths;
    uint8_t *marked_records;
    uint32_t count;
    uint32_t stride;
    uint8_t safe_spacing;
    uint8_t mark_count;
    int sara_am_index;
    uint8_t sara_am_top_mask[16][3];
    int sara_am_split;
};

struct ThaiLayoutContext {
    ThaiLayoutContext *previous;
    ThaiLayoutContext *parent_metrics;
    uint32_t font;
    ThaiFontState *state;
    int spacing;
    int current_y;
    int base_x;
    int base_width;
    int has_y;
    int has_base;
    int has_above_mark;
    int metrics_applied;
    int has_pending_tone;
    uint32_t pending_tone_font;
    ThaiFontState *pending_tone_state;
    int pending_tone_index;
    uint16_t pending_tone_code;
    int pending_tone_x;
    int pending_tone_y;
    uint32_t pending_tone_color;
};

static int g_enabled;
static ThaiFontState *g_states;
static ThaiLayoutContext *g_context;
static recomp_func_t g_render_original;

#define THAI_PUSH32(value) do { g_esp -= 4; MEM32(g_esp) = (uint32_t)(value); } while (0)

enum { TONE_MARK_RAISE = 2, MAX_EXTRA_SPACING = 8 };

#ifdef RA2_TARGET_GAME
#define THAI_LAYOUT_VA 0x00432490u
#define THAI_RENDER_VA 0x004318E0u
#define THAI_TEXT_VA   0x00431CC0u
#else
#define THAI_LAYOUT_VA 0x00434CD0u
#define THAI_RENDER_VA 0x00434120u
#define THAI_TEXT_VA   0x00434500u
#endif

static uint8_t *guest_bytes(uint32_t va) { return (uint8_t *)(uintptr_t)va; }
static uint32_t read32(uint32_t va) { return MEM32(va); }
static uint16_t read16(uint32_t va) { return MEM16(va); }
static void write32(uint32_t va, uint32_t value) { MEM32(va) = value; }
static uint8_t read8(uint32_t va) { return MEM8(va); }
static void write8(uint32_t va, uint8_t value) { MEM8(va) = value; }

static int is_mark(uint16_t code) {
    return code == 0xd1 || (code >= 0xd4 && code <= 0xda) ||
           (code >= 0xe7 && code <= 0xee);
}

static int is_upper_mark(uint16_t code) {
    return code == 0xd1 || (code >= 0xd4 && code <= 0xd7) ||
           (code >= 0xe7 && code <= 0xee);
}

static int is_tone_mark(uint16_t code) { return code >= 0xe8 && code <= 0xeb; }

static int glyph_pixel(const uint8_t *record, unsigned x, unsigned y) {
    return (record[1 + y * 3 + (x >> 3)] & (uint8_t)(0x80u >> (x & 7))) != 0;
}

static int build_sara_am_mask(ThaiFontState *state) {
    state->sara_am_index = -1;
    uint16_t entry = state->map[0xd3];
    if (!entry || entry > state->count) return 0;
    unsigned index = entry - 1;
    uint8_t *record = state->records + (size_t)index * state->stride;
    unsigned width = record[0];
    if (!width || width > 16) return 0;
    state->sara_am_index = (int)index;

    unsigned right_start = 16, right_length = 0, run_start = 0, run_length = 0;
    for (unsigned y = 0; y <= 16; ++y) {
        int ink = y < 16 && glyph_pixel(record, width - 1, y);
        if (ink) {
            if (!run_length) run_start = y;
            ++run_length;
        } else {
            if (run_length > right_length) right_start = run_start, right_length = run_length;
            run_length = 0;
        }
    }
    if (right_length < 3 || right_start < 2 || right_start >= 16) return 0;
    unsigned split_row = right_start - 1;
    if (!split_row || split_row >= 16) return 0;

    unsigned top_count = 0, lower_count = 0, top_max_x = 0;
    for (unsigned y = 0; y < 16; ++y) for (unsigned x = 0; x < width; ++x) {
        if (!glyph_pixel(record, x, y)) continue;
        if (y < split_row) {
            ++top_count;
            if (x > top_max_x) top_max_x = x;
            state->sara_am_top_mask[y][x >> 3] |= (uint8_t)(0x80u >> (x & 7));
        } else ++lower_count;
    }
    if (top_count < 2 || lower_count < 3 || top_count >= lower_count || top_max_x >= width - 1) {
        memset(state->sara_am_top_mask, 0, sizeof state->sara_am_top_mask);
        return 0;
    }
    state->sara_am_split = 1;
    return 1;
}

static ThaiFontState *find_state(uint8_t *data) {
    for (ThaiFontState *state = g_states; state; state = state->next)
        if (state->data == data) return state;
    return NULL;
}

/* Why create_state rejected a font. Only content and header rejections are remembered (see get_state):
 * a failed allocation says nothing about the font, so the next call tries again. */
typedef enum {
    REJECT_NONE,
    REJECT_NO_MEMORY,   /* calloc or malloc failed: not cached */
    REJECT_HEADER,      /* a header field is out of range: the cache key is the header */
    REJECT_WIDTH,       /* glyph record `at` has a width above 16 */
    REJECT_MARK_RANGE,  /* mark code `at` maps past the last glyph record */
    REJECT_NO_MARKS,    /* no mark code maps to a glyph record */
    REJECT_MARK_SHARED  /* non-mark code `at` maps to a glyph record that a mark code also maps to */
} RejectKind;

typedef struct RejectReason {
    RejectKind kind;
    uint32_t at;
} RejectReason;

static ThaiFontState *reject(RejectReason *why, RejectKind kind, uint32_t at) {
    why->kind = kind;
    why->at = at;
    return NULL;
}

static ThaiFontState *fail_state(ThaiFontState *state, uint8_t *cloned_data, uint8_t *records,
                                 uint8_t *widths, RejectReason *why, RejectKind kind, uint32_t at) {
    free(state); free(cloned_data); free(records); free(widths);
    return reject(why, kind, at);
}

static ThaiFontState *create_state(uint32_t font, RejectReason *why) {
    uint32_t data_va = read32(font + 4);
    uint32_t height = read32(data_va + 8);
    uint32_t stride = read32(data_va + 0x14);
    uint32_t map_va = read32(data_va + 0x18);
    uint32_t source_records_va = read32(data_va + 0x1c);
    uint32_t count = read32(data_va + 0x20);
    if (height != 16 || stride < 49 || stride > 128 || !count || count > 0x10000 ||
        !map_va || !source_records_va || (uint64_t)count * stride > 16u * 1024u * 1024u)
        return reject(why, REJECT_HEADER, 0);

    /* Reject before any allocation or copy: the glyph widths are checked in the guest's own records. */
    for (uint32_t i = 0; i < count; ++i)
        if (guest_bytes(source_records_va)[(size_t)i * stride] > 16)
            return reject(why, REJECT_WIDTH, i);

    size_t record_bytes = (size_t)count * stride;
    ThaiFontState *state = (ThaiFontState *)calloc(1, sizeof *state);
    uint8_t *cloned_data = (uint8_t *)malloc(0x24);
    uint8_t *records = (uint8_t *)malloc(record_bytes);
    uint8_t *widths = (uint8_t *)malloc((size_t)count * 2);
    if (!state || !cloned_data || !records || !widths) {
        free(state); free(cloned_data); free(records); free(widths);
        return reject(why, REJECT_NO_MEMORY, 0);
    }
    memcpy(cloned_data, guest_bytes(data_va), 0x24);
    memcpy(records, guest_bytes(source_records_va), record_bytes);
    uint32_t records_va = (uint32_t)(uintptr_t)records;
    memcpy(cloned_data + 0x1c, &records_va, sizeof records_va);
    state->data = cloned_data;
    state->map = (uint16_t *)(uintptr_t)map_va;
    state->records = records;
    state->original_widths = widths;
    state->marked_records = widths + count;
    state->count = count;
    state->stride = stride;
    state->safe_spacing = MAX_EXTRA_SPACING;
    state->sara_am_index = -1;

    for (uint32_t i = 0; i < count; ++i) {
        uint8_t *record = records + (size_t)i * stride;
        uint8_t width = record[0]; /* at most 16: checked above */
        widths[i] = width;
        for (unsigned y = 0; y < 16; ++y) {
            for (unsigned x = width; x < (unsigned)width + MAX_EXTRA_SPACING; ++x) {
                if (record[1 + y * 3 + (x >> 3)] & (uint8_t)(0x80u >> (x & 7))) {
                    unsigned padding = x - width;
                    if (padding < state->safe_spacing) state->safe_spacing = (uint8_t)padding;
                }
            }
        }
    }
    build_sara_am_mask(state);
    for (unsigned code = 0; code <= 0xff; ++code) {
        if (!is_mark((uint16_t)code)) continue;
        uint16_t entry = state->map[code];
        if (!entry) continue;
        if (entry > count)
            return fail_state(state, cloned_data, records, widths, why, REJECT_MARK_RANGE, code);
        if (!state->marked_records[entry - 1]) {
            state->marked_records[entry - 1] = 1;
            ++state->mark_count;
        }
    }
    if (!state->mark_count)
        return fail_state(state, cloned_data, records, widths, why, REJECT_NO_MARKS, 0);
    for (unsigned code = 0; code <= 0xff; ++code) {
        if (is_mark((uint16_t)code)) continue;
        uint16_t entry = state->map[code];
        if (entry && entry <= count && state->marked_records[entry - 1])
            return fail_state(state, cloned_data, records, widths, why, REJECT_MARK_SHARED, code);
    }
    write32(font + 4, (uint32_t)(uintptr_t)cloned_data);
    state->next = g_states;
    g_states = state;
    return state;
}

/* The header values create_state reads for a font: the cache key. */
typedef struct FontKey {
    uint32_t data, height, count, stride, map, records;
} FontKey;

/* A rejected font: its key, and the first check that failed. A later call re-checks that one check (see
 * still_rejected) rather than the whole font, so a hit costs the same however many glyphs the font has. */
typedef struct RejectedFont {
    FontKey key;
    RejectReason why;
} RejectedFont;

/* Without this cache a rejected font was cloned and scanned on every text call: 1.67 MB and 34,151
 * glyphs in the busy save, about 90 times a second, with the fix on. The Thai calls run on the game thread
 * only, so g_rejected, like g_states and g_context, is not synchronised. A full cache (64 fonts) falls back
 * to the early width scan on each call, which is slower but gives the same answer. */
enum { REJECTED_FONT_SLOTS = 64 };
static RejectedFont g_rejected[REJECTED_FONT_SLOTS];
static int g_rejected_count;

static FontKey font_key(uint32_t font) {
    FontKey key;
    key.data = read32(font + 4);
    key.height = read32(key.data + 8);
    key.stride = read32(key.data + 0x14);
    key.map = read32(key.data + 0x18);
    key.records = read32(key.data + 0x1c);
    key.count = read32(key.data + 0x20);
    return key;
}

/* create_state's mark rule: a mark code maps to a glyph record when its entry is non-zero and within the count. */
static int any_mark_entry(const FontKey *key) {
    for (unsigned code = 0; code <= 0xff; ++code) {
        if (!is_mark((uint16_t)code)) continue;
        uint16_t entry = read16(key->map + 2 * code);
        if (entry && entry <= key->count) return 1;
    }
    return 0;
}

/* Whether non-mark code `code` maps to a glyph record that some mark code also maps to. */
static int mark_shares(const FontKey *key, unsigned code) {
    uint16_t entry = read16(key->map + 2 * code);
    if (is_mark((uint16_t)code) || !entry || entry > key->count) return 0;
    for (unsigned m = 0; m <= 0xff; ++m) {
        if (!is_mark((uint16_t)m)) continue;
        uint16_t mark = read16(key->map + 2 * m);
        if (mark && mark <= key->count && mark == entry) return 1;
    }
    return 0;
}

/* Whether the check that rejected a font still fails. Reads one glyph record or a fixed number of map
 * entries, never the glyphs, so it costs the same however many glyphs the font has. create_state rejects
 * whenever any check fails, so if this one still fails the font is still rejected. A header rejection needs
 * no check: the key is the header. */
static int still_rejected(const RejectedFont *r) {
    const FontKey *key = &r->key;
    switch (r->why.kind) {
    case REJECT_HEADER: return 1;
    case REJECT_WIDTH: return guest_bytes(key->records)[(size_t)r->why.at * key->stride] > 16;
    case REJECT_MARK_RANGE: return read16(key->map + 2 * r->why.at) > key->count;
    case REJECT_NO_MARKS: return !any_mark_entry(key);
    case REJECT_MARK_SHARED: return mark_shares(key, r->why.at);
    default: return 0;
    }
}

static ThaiFontState *get_state(uint32_t font) {
    uint32_t data = read32(font + 4);
    ThaiFontState *state = find_state(guest_bytes(data));
    if (state) return state;
    FontKey key = font_key(font);
    for (int i = 0; i < g_rejected_count; ++i) {
        RejectedFont *r = &g_rejected[i];
        if (memcmp(&r->key, &key, sizeof key) != 0) continue;
        if (still_rejected(r)) return NULL;
        g_rejected[i] = g_rejected[--g_rejected_count]; /* the content changed: forget it and check again */
        break;
    }
    RejectReason why = { REJECT_NONE, 0 };
    state = create_state(font, &why);
    /* Only a content or header rejection is a fact about the font. An allocation failure is retried. */
    if (!state && why.kind != REJECT_NO_MEMORY && g_rejected_count < REJECTED_FONT_SLOTS) {
        g_rejected[g_rejected_count].key = key;
        g_rejected[g_rejected_count].why = why;
        ++g_rejected_count;
    }
    return state;
}

static ThaiLayoutContext *context_for_data(ThaiLayoutContext *context, uint8_t *data) {
    for (; context; context = context->previous)
        if (context->state && context->state->data == data && context->metrics_applied) return context;
    return NULL;
}

static ThaiLayoutContext *context_for_font(ThaiLayoutContext *context, uint32_t font) {
    for (; context; context = context->previous)
        if (context->font == font && context->metrics_applied) return context;
    return NULL;
}

static int can_apply_metrics(const ThaiLayoutContext *context) {
    return context->state && context->spacing >= 0 && context->spacing <= MAX_EXTRA_SPACING &&
           context->spacing <= context->state->safe_spacing;
}

static void apply_metrics(ThaiLayoutContext *context) {
    ThaiFontState *state = context->state;
    for (uint32_t i = 0; i < state->count; ++i) {
        uint8_t width = state->original_widths[i];
        state->records[(size_t)i * state->stride] = state->marked_records[i] ? 0 : (uint8_t)(width + context->spacing);
    }
    write32(context->font + 0x2c, 0);
    context->metrics_applied = 1;
}

static void restore_metrics(ThaiLayoutContext *context) {
    if (!context || !context->metrics_applied) return;
    ThaiFontState *state = context->state;
    for (uint32_t i = 0; i < state->count; ++i)
        state->records[(size_t)i * state->stride] = state->original_widths[i];
    write32(context->font + 0x2c, (uint32_t)context->spacing);
    context->metrics_applied = 0;
}

static int glyph_index(const ThaiFontState *state, uint16_t code) {
    if (!state || code > 0xff) return -1;
    uint16_t entry = state->map[code];
    return !entry || entry > state->count ? -1 : (int)entry - 1;
}

static int call_renderer(recomp_func_t original, uint32_t font, uint16_t code,
                         int x, int y, uint32_t color) {
    uint32_t saved_esp = g_esp, saved_ecx = g_ecx, saved_func = g_cur_func;
    if (!original) return x;
    THAI_PUSH32(color);
    THAI_PUSH32((uint32_t)y);
    THAI_PUSH32((uint32_t)x);
    THAI_PUSH32(code);
    THAI_PUSH32(RECOMP_RETADDR);
    g_ecx = font;
    original();
    int result = (int32_t)g_eax;
    g_esp = saved_esp;
    g_ecx = saved_ecx;
    g_cur_func = saved_func;
    return result;
}

static void flush_pending_tone(ThaiLayoutContext *context, int above_sara_am) {
    if (!context || !context->has_pending_tone) return;
    ThaiFontState *state = context->pending_tone_state;
    int index = context->pending_tone_index;
    if (state && index >= 0 && (uint32_t)index < state->count && g_render_original) {
        uint8_t *record = state->records + (size_t)index * state->stride;
        uint8_t patched = record[0];
        record[0] = state->original_widths[index];
        int y = context->pending_tone_y - (above_sara_am ? TONE_MARK_RAISE : 0);
        call_renderer(g_render_original, context->pending_tone_font, context->pending_tone_code,
                      context->pending_tone_x, y, context->pending_tone_color);
        record[0] = patched;
    }
    context->has_pending_tone = 0;
    context->pending_tone_font = 0;
    context->pending_tone_state = NULL;
    context->pending_tone_index = -1;
}

static int draw_sara_am(recomp_func_t original, uint32_t font, ThaiLayoutContext *context,
                        uint16_t code, int x, int y, uint32_t color) {
    ThaiFontState *state = context->state;
    if (!state || !state->sara_am_split || state->stride > 128)
        return call_renderer(original, font, code, x, y, color);
    uint8_t *record = state->records + (size_t)state->sara_am_index * state->stride;
    uint8_t saved[128];
    memcpy(saved, record, state->stride);
    int min_x = 24, max_x = -1;
    for (unsigned row = 0; row < 16; ++row) for (unsigned byte = 0; byte < 3; ++byte)
        for (unsigned bit = 0; bit < 8; ++bit)
            if (state->sara_am_top_mask[row][byte] & (uint8_t)(0x80u >> bit)) {
                int px = (int)(byte * 8 + bit);
                if (px < min_x) min_x = px;
                if (px > max_x) max_x = px;
            }
    if (max_x < min_x) return call_renderer(original, font, code, x, y, color);
    if (context->has_y && context->current_y != y) context->has_base = context->has_above_mark = 0;
    context->current_y = y;
    context->has_y = 1;
    int mark_x = x;
    if (context->has_base) mark_x = context->base_x + (context->base_width - (max_x - min_x + 1)) / 2 - min_x;
    int mark_y = y - (context->has_above_mark && !context->has_pending_tone ? TONE_MARK_RAISE : 0);
    for (unsigned row = 0; row < 16; ++row) for (unsigned byte = 0; byte < 3; ++byte)
        record[1 + row * 3 + byte] &= state->sara_am_top_mask[row][byte];
    call_renderer(original, font, code, mark_x, mark_y, color);
    memcpy(record, saved, state->stride);
    for (unsigned row = 0; row < 16; ++row) for (unsigned byte = 0; byte < 3; ++byte)
        record[1 + row * 3 + byte] &= (uint8_t)~state->sara_am_top_mask[row][byte];
    int result = call_renderer(original, font, code, x, y, color);
    memcpy(record, saved, state->stride);
    context->has_above_mark = 1;
    return result;
}

static void begin_layout(ThaiLayoutContext *context, uint32_t font) {
    memset(context, 0, sizeof *context);
    context->previous = g_context;
    context->font = font;
    context->state = get_state(font);
    context->pending_tone_index = -1;
    ThaiLayoutContext *parent = context_for_font(context->previous, font);
    context->spacing = parent ? parent->spacing : (int32_t)read32(font + 0x2c);
    context->parent_metrics = context->state
        ? context_for_data(context->previous, context->state->data) : NULL;
    if (context->parent_metrics) restore_metrics(context->parent_metrics);
    if (can_apply_metrics(context)) apply_metrics(context);
    g_context = context;
}

static void end_layout(ThaiLayoutContext *context) {
    flush_pending_tone(context, 0);
    g_context = context->previous;
    restore_metrics(context);
    if (context->parent_metrics && !context->parent_metrics->metrics_applied &&
        can_apply_metrics(context->parent_metrics)) apply_metrics(context->parent_metrics);
}

void thai_font_set_enabled(int enabled) { g_enabled = enabled != 0; }

void recomp_thai_call(uint32_t target, recomp_func_t original) {
    uint32_t caller = g_cur_func;
    if (!g_enabled || !original) {
        if (original) original();
        g_cur_func = caller;
        return;
    }
    if (target == THAI_LAYOUT_VA || target == THAI_TEXT_VA) {
        uint32_t font = target == THAI_LAYOUT_VA ? read32(g_esp + 4) : g_ecx;
        ThaiLayoutContext context;
        begin_layout(&context, font);
        original();
        end_layout(&context);
        g_cur_func = caller;
        return;
    }
    if (target != THAI_RENDER_VA) {
        original();
        g_cur_func = caller;
        return;
    }

    g_render_original = original;
    uint32_t font = g_ecx;
    uint16_t code = (uint16_t)read32(g_esp + 4);
    int x = (int32_t)read32(g_esp + 8), y = (int32_t)read32(g_esp + 12);
    uint32_t color = read32(g_esp + 16);
    ThaiLayoutContext *context = context_for_font(g_context, font);
    if (!context || !context->state) {
        original();
        g_cur_func = caller;
        return;
    }
    ThaiFontState *state = context->state;
    int index = glyph_index(state, code);
    int is_sara_am = code == 0xd3 && state->sara_am_split && index == state->sara_am_index;
    if (context->has_y && context->current_y != y) {
        flush_pending_tone(context, 0);
        context->has_base = context->has_above_mark = 0;
    }
    int tone_above_sara = is_sara_am && context->has_base && context->has_pending_tone &&
                           context->pending_tone_state == state && context->pending_tone_y == y;
    if (context->has_pending_tone && !tone_above_sara) flush_pending_tone(context, 0);
    if (code == 9) {
        context->has_base = context->has_above_mark = 0;
        original();
        g_cur_func = caller;
        return;
    }
    if (is_sara_am && context->has_base) {
        draw_sara_am(original, font, context, code, x, y, color);
        flush_pending_tone(context, 1);
        g_eax = (uint32_t)(x + state->original_widths[index] + context->spacing);
        g_esp += 20;
        g_cur_func = caller;
        return;
    }
    if (is_mark(code) && index >= 0 && state->marked_records[index]) {
        uint8_t *record = state->records + (size_t)index * state->stride;
        uint8_t patched = record[0];
        int draw_x = context->has_base ? context->base_x +
            (context->base_width - (int)state->original_widths[index]) / 2 : x;
        int draw_y = y;
        context->current_y = y;
        context->has_y = 1;
        if (context->has_base && is_tone_mark(code) && context->has_above_mark)
            draw_y -= TONE_MARK_RAISE;
        if (is_tone_mark(code) && state->sara_am_split && context->has_base) {
            context->has_pending_tone = 1;
            context->pending_tone_font = font;
            context->pending_tone_state = state;
            context->pending_tone_index = index;
            context->pending_tone_code = code;
            context->pending_tone_x = draw_x;
            context->pending_tone_y = draw_y;
            context->pending_tone_color = color;
            context->has_above_mark = 1;
            g_eax = (uint32_t)x;
            g_esp += 20;
            g_cur_func = caller;
            return;
        }
        record[0] = state->original_widths[index];
        write32(g_esp + 8, (uint32_t)draw_x);
        write32(g_esp + 12, (uint32_t)draw_y);
        original();
        record[0] = patched;
        g_eax = (uint32_t)x;
        if (is_upper_mark(code)) context->has_above_mark = 1;
        g_cur_func = caller;
        return;
    }
    context->current_y = y;
    context->has_y = 1;
    context->has_base = 1;
    context->has_above_mark = 0;
    context->base_x = x;
    context->base_width = index >= 0 ? state->original_widths[index] : 0;
    original();
    g_cur_func = caller;
}

void recomp_thai_indirect_call(uint32_t target) {
    g_icall_trace[g_icall_trace_idx & (ICALL_TRACE_SIZE - 1)] = target;
    g_icall_from[g_icall_trace_idx & (ICALL_TRACE_SIZE - 1)] = g_cur_func;
    g_icall_trace_idx++;
    g_icall_count++;
    recomp_func_t original = recomp_lookup_manual(target);
    if (!original) original = recomp_lookup(target);
    if (!original) original = recomp_lookup_import(target);
    if (original) {
        recomp_thai_call(target, original);
    } else {
        fprintf(stderr, "ICALL: unresolved VA 0x%08X from 0x%08X\n", target, g_cur_func);
        g_eax = 0;
    }
}
