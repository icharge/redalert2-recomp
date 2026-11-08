/* The map search box's text (map_box.h). No game state here: map_box_selftest.c tests it alone.
 * The caret keys do what the game's box does with them, checked in the game: Home, End, Left and
 * Right move the caret (Shift selects nothing), Delete takes the character after it, and a click
 * puts it at the end. */
#include "map_box.h"

#include <string.h>

#define WM_KEYDOWN 0x0100u
#define WM_CHAR 0x0102u
#define WM_LBUTTONDOWN 0x0201u
#define VK_BACK 0x08u
#define VK_END 0x23u
#define VK_HOME 0x24u
#define VK_LEFT 0x25u
#define VK_RIGHT 0x27u
#define VK_DELETE 0x2Eu

static void erase(ra2_map_box *b, unsigned at) {
    if (!b->overflow) memmove(b->text + at, b->text + at + 1, b->len - at);
    if (--b->len == 0) b->overflow = 0, b->text[0] = 0;
}

static void insert(ra2_map_box *b, char c) {
    if (b->len + 1 >= sizeof b->text) b->overflow = 1;
    if (!b->overflow) {
        memmove(b->text + b->caret + 1, b->text + b->caret, b->len - b->caret + 1);
        b->text[b->caret] = c;
    }
    b->caret++, b->len++;
}

int ra2_map_box_take(ra2_map_box *b, uint32_t message, uint32_t wParam) {
    if (message == WM_LBUTTONDOWN) {
        b->caret = b->len;
    } else if (message == WM_CHAR) {
        if (wParam == VK_BACK && b->caret) return erase(b, --b->caret), 1;
        if (wParam >= 32u && wParam <= 255u) return insert(b, (char)wParam), 1;
    } else if (message == WM_KEYDOWN) {
        if (wParam == VK_HOME) b->caret = 0;
        else if (wParam == VK_END) b->caret = b->len;
        else if (wParam == VK_LEFT && b->caret) b->caret--;
        else if (wParam == VK_RIGHT && b->caret < b->len) b->caret++;
        else if (wParam == VK_DELETE && b->caret < b->len) return erase(b, b->caret), 1;
    }
    return 0;
}
