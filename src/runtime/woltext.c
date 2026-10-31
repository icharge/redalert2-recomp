/*
 * The online "limit screen resolution" prompt (docs/hires.md).
 *
 * The engine shows the string it finds under WOL:ResolutionLimited640 or
 * WOL:ResolutionLimited800; its text names the stock 640x480/800x600 cap. The
 * remaster caps limited rooms at 1920x1080 instead, so the looked-up string is
 * copied into this buffer with that size substituted. The CSF text itself is
 * left alone, and both encodings the game ships are handled: the translated
 * data stores glyph codes as (0xFFFF - ASCII), while a stock English CSF uses
 * plain ASCII.
 */
#include <stdint.h>

#define MESSAGE_MAX 256

static uint16_t glyph(char c, int mirrored) {
    return mirrored ? (uint16_t)(0xFFFFu - (unsigned char)c) : (uint16_t)(unsigned char)c;
}

static int matches(const uint16_t *source, unsigned at, const char *text, int mirrored) {
    for (unsigned i = 0; text[i]; i++)
        if (source[at + i] != glyph(text[i], mirrored)) return 0;
    return 1;
}

static unsigned append(uint16_t *out, unsigned n, const char *text, int mirrored) {
    for (unsigned i = 0; text[i] && n + 1 < MESSAGE_MAX; i++)
        out[n++] = glyph(text[i], mirrored);
    return n;
}

const uint16_t *ra2_wol_limit_message(const uint16_t *source) {
    static uint16_t out[MESSAGE_MAX];
    static const char *const stock[] = { "640x480", "800x600" };
    unsigned n = 0;

    if (!source) return source;
    for (unsigned i = 0; source[i] && n + 1 < MESSAGE_MAX; ) {
        int replaced = 0;
        for (int mirrored = 0; mirrored < 2 && !replaced; mirrored++)
            for (unsigned s = 0; s < sizeof stock / sizeof stock[0]; s++) {
                if (!matches(source, i, stock[s], mirrored)) continue;
                n = append(out, n, "1920x1080", mirrored);
                i += 7;
                replaced = 1;
                break;
            }
        if (!replaced) out[n++] = source[i++];
    }
    out[n] = 0;
    return out;
}
