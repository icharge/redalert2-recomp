/* The WOL login uses an editable owner-drawn combo for the nickname. */
#define RECOMP_GENERATED_CODE
#include <assert.h>
#include "win32hle.h"

static unsigned edits, updates;
static void parent_proc(void) {
    if (A32(1) == 0x111) {
        unsigned code = A32(2) >> 16;
        if (code == 5) edits++;
        if (code == 6) updates++;
    }
    RET(0, 4);
}
const recomp_dispatch_entry_t recomp_dispatch_table[] = { { 0x401100, parent_proc } };
const uint32_t recomp_dispatch_count = 1;
static uint32_t call(const char *name, int count, uint32_t *args) {
    return hle_call_guest(hle_resolve(name), count, args);
}
int main(void) {
    win32hle_register(win32hle_user32);
    uint32_t create[] = { 0,(uint32_t)(uintptr_t)"Static",0,0x10000000,0,0,800,600,0,0,0,0 };
    uint32_t parent = call("CreateWindowExA", 12, create);
    uint32_t subclass[] = { parent, (uint32_t)-4, 0x401100 };
    call("SetWindowLongA", 3, subclass);
    create[1] = (uint32_t)(uintptr_t)"ComboBox";
    create[3] = 0x50000212; /* child, visible, ownerdraw, strings, editable dropdown */
    create[6] = 200; create[7] = 100; create[8] = parent; create[9] = 123;
    uint32_t combo = call("CreateWindowExA", 12, create);
    assert(combo);
    uint32_t edit = hle_dialog_item(combo, 1001);
    assert(edit); /* Windows gives CBS_DROPDOWN an actual edit child. */
    hle_send(combo, 0x201, 0, 10 | 10 << 16);
    assert(hle_send(combo, 0x157, 0, 0) == 0); /* clicking the field does not open the list */
    hle_send(combo, 0x141, 3, 0); /* CB_LIMITTEXT */
    hle_send(combo, 0x102, 't', 0);
    hle_send(combo, 0x102, 'e', 0);
    hle_send(combo, 0x102, 's', 0);
    hle_send(combo, 0x102, 't', 0);
    char text[32] = {0};
    hle_send(combo, 0xD, sizeof text, (uint32_t)(uintptr_t)text);
    assert(strcmp(text, "tes") == 0 && edits == 3 && updates == 3);
    hle_send(combo, 0x102, 8, 0);
    hle_send(combo, 0xD, sizeof text, (uint32_t)(uintptr_t)text);
    assert(strcmp(text, "te") == 0 && edits == 4);
    puts("WOL editable nickname control: PASS");
    return 0;
}
