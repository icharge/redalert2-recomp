/* The map finder as a screen of the game's own (finder_screen.c). */
#ifndef FINDER_SCREEN_H
#define FINDER_SCREEN_H
#include <stdint.h>

/* Ask for the screen; it opens at the next pump. */
void web_finder_screen_open(void);
/* Whether the screen is up (it covers the map screen it was opened from). */
int web_finder_screen_showing(void);
/* The presenter's pump, on the game's thread. */
void web_finder_screen_pump(void);
/* A message the game took from its queue (map_search.c's take hook): the keys that reach the search Edit. */
void web_finder_screen_take(uint32_t hwnd, uint32_t message, uint32_t wParam);
/* The screen the finder opens over (the open Customize Battle), 0 when there is none. */
uint32_t web_finder_screen_owner(void);

#endif
