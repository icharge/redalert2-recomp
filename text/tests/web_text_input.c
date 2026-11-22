/* The browser text input's mapping to the game's WM_CHAR value
 * (src/web/text_input.h). Both editions' edit control (YR 0x00614B30,
 * RA2 0x005F2966) inserts WM_CHAR's low 16 bits into its wide buffer, so
 * the value chosen here is the UTF-16 unit the game stores. */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>

#include "text_input.h"

int main(void) {
    /* Legacy mode (TTF off): Windows-874 bytes, as the Thai FNT expects. */
    assert(web_text_char(0x0E01, 0) == 0xA1);   /* ko kai */
    assert(web_text_char(0x0E32, 0) == 0xD2);   /* sara aa */
    assert(web_text_char(0x0E23, 0) == 0xC3);   /* ro rua */
    assert(web_text_char(0x0E3F, 0) == 0xDF);   /* baht sign */
    assert(web_text_char(0x20AC, 0) == 0x80);   /* euro */
    assert(web_text_char('A', 0) == 'A');
    assert(web_text_char(0x00E9, 0) == '?');    /* not in Windows-874 */
    assert(web_text_char(0x4E2D, 0) == '?');

    /* Unicode mode (TTF on): the code point itself, so the TTF path shapes
     * real Thai rather than CP874 bytes widened to Latin-1. */
    assert(web_text_char(0x0E01, 1) == 0x0E01);
    assert(web_text_char(0x0E32, 1) == 0x0E32);
    assert(web_text_char(0x0E23, 1) == 0x0E23);
    assert(web_text_char(0x0E3F, 1) == 0x0E3F);
    assert(web_text_char(0x00E9, 1) == 0x00E9); /* Latin-1 stays Latin-1 */
    assert(web_text_char(0x4E2D, 1) == 0x4E2D); /* CJK */
    assert(web_text_char(0x20AC, 1) == 0x20AC);
    assert(web_text_char('A', 1) == 'A');

    /* Outside one UTF-16 unit, or not a character: '?' in both modes. The
     * edit control inserts one unit per WM_CHAR and deletes one per
     * backspace, so a surrogate pair could be split. */
    for (int unicode = 0; unicode <= 1; unicode++) {
        assert(web_text_char(0x1F600, unicode) == '?');
        assert(web_text_char(0xD800, unicode) == '?');
        assert(web_text_char(0xDFFF, unicode) == '?');
        assert(web_text_char(0x110000, unicode) == '?');
        assert(web_text_char(0x09, unicode) == '?');
        assert(web_text_char(0x7F, unicode) == '?');
        assert(web_text_char(0x85, unicode) == '?');
        /* Editing keys keep their meaning in both modes. */
        assert(web_text_char('\b', unicode) == 8);
        assert(web_text_char('\r', unicode) == 13);
        assert(web_text_char('\n', unicode) == 13);
    }

    puts("web_text_input: all passed");
    return 0;
}
