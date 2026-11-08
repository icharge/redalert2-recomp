/* The map search box's text (map_search.c), as the game's box holds it. The game keeps that text
 * inside itself, so it is followed from the messages the box takes. */
#pragma once
#include <stdint.h>

typedef struct {
    char text[256];
    unsigned len, caret;   /* in the game's box, which may hold more than text */
    int overflow;          /* it does: the text isn't known until the box is empty again */
} ra2_map_box;

/* A message the game's box took from the queue: WM_CHAR, WM_KEYDOWN or WM_LBUTTONDOWN (others do
 * nothing). Returns whether the text changed. */
int ra2_map_box_take(ra2_map_box *box, uint32_t message, uint32_t wParam);
