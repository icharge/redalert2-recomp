/* The map screens' templates with a search box added (map_search.c). */
#pragma once
#include <stddef.h>
#include <stdint.h>

/* Copy a DLGTEMPLATEEX of `size` bytes to `out` with an Edit control `edit_id` (`edit_h` dialog units
 * high, a tab stop) put where the top of list `list_id` was; the list moves down and shortens to
 * make room. The game then makes and styles the box as one of its own controls. Returns the bytes
 * written, or 0: not a DLGTEMPLATEEX, no such list, or no room in `out`. */
size_t ra2_map_dialog(const uint8_t *tmpl, size_t size, uint8_t *out, size_t cap, uint32_t list_id,
                      uint32_t edit_id, int edit_h);

/* Copy a DLGTEMPLATEEX of `size` bytes to `out` with one more control, a copy of control `like_id` (a
 * button) with id `button_id`, the text `title` (ASCII), and put `gap` dialog units below it. The game
 * draws it as one of its own buttons, in the same plate. Returns the bytes written, or 0: not a
 * DLGTEMPLATEEX, no such control, or no room in `out`. */
size_t ra2_map_dialog_button(const uint8_t *tmpl, size_t size, uint8_t *out, size_t cap, uint32_t like_id,
                             uint32_t button_id, const char *title, int gap);
