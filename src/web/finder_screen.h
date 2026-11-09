/* The map finder as a screen of the game's own (finder_screen.c). */
#ifndef FINDER_SCREEN_H
#define FINDER_SCREEN_H
#include <stdint.h>

/* Ask for the screen; it opens at the next pump. */
void web_finder_screen_open(void);
/* The presenter's pump, on the game's thread. */
void web_finder_screen_pump(void);
/* The screen the finder opens over (the open Customize Battle), 0 when there is none. */
uint32_t web_finder_screen_owner(void);

#endif
