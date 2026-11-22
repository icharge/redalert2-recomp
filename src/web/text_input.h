#ifndef RA2_WEB_TEXT_INPUT_H
#define RA2_WEB_TEXT_INPUT_H

/*
 * One code point of the browser's committed text, as the WM_CHAR value the
 * game receives.
 *
 * Both editions' edit control (YR 0x00614B30, RA2 0x005F2966) handles
 * WM_CHAR itself: it takes the low 16 bits of wParam, rejects values up to
 * 0x1F, and inserts the rest into its wide buffer as one UTF-16 unit
 * (0x006150FD..0x0061527A in YR). A field that sets its own byte-only flag
 * also rejects values from 0x100. So the value chosen here is what the
 * field stores.
 *
 * unicode = 0 (TTF text off): Windows-874 bytes, as on a Thai Windows. The
 *   Thai FNT and Thai mods read those bytes widened to U+00A1..U+00FB.
 * unicode = 1 (--ttf-text): the code point itself, so the TTF path shapes
 *   real Thai and other scripts.
 *
 * Anything that is not one UTF-16 character becomes '?' in both modes:
 * controls other than backspace and Enter, surrogates, and code points above
 * U+FFFF (the field would insert a pair as two units and delete one).
 */

#include <stdint.h>

static inline uint32_t web_text_char(uint32_t codepoint, int unicode) {
    if (codepoint == '\b') return 8;
    if (codepoint == '\r' || codepoint == '\n') return 13;
    if (codepoint < 0x20 || (codepoint >= 0x7f && codepoint <= 0x9f)) return '?';
    if (unicode) {
        if (codepoint > 0xffff || (codepoint >= 0xd800 && codepoint <= 0xdfff)) return '?';
        return codepoint;
    }
    if (codepoint <= 0x7e) return codepoint;
    if (codepoint == 0x00a0) return 0xa0;
    if (codepoint == 0x20ac) return 0x80;
    if (codepoint >= 0x0e01 && codepoint <= 0x0e3a) return codepoint - 0x0d60;
    if (codepoint == 0x0e3f) return 0xdf;
    if (codepoint >= 0x0e40 && codepoint <= 0x0e5b) return codepoint - 0x0d60;
    return '?';
}

#endif
