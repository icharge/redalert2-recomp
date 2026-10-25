/* The presenter: the game's picture in our own Direct3D 11 window (present.c). */
#pragma once
#include <windows.h>

/* Max game frame supported by the host snapshot and presenter buffers. */
#define HOST_FRAME_MAX_WIDTH 8192
#define HOST_FRAME_MAX_HEIGHT 2160

/* sharp, smooth, crt, nearest, integer -> 0..4, or -1. */
int  present_mode_from_name(const char* name);

/* Open the window on a thread of its own and keep it showing the game.
 * mode and fullscreen of -1 take what ra2.ini (beside ra2.exe) remembers. */
void present_start(int mode, int fullscreen);

/* The real mouse, from the game's thread under Wine (host.c): the message
 * and the screen point it happened at, handled as if the window had it. */
void present_real_mouse(UINT m, WPARAM w, POINT screen);
