#pragma once

/* The sizes the host's own resolution command accepts. The launcher also
 * offers "Match browser size", which is this window's pixel size and need not
 * be in any catalog, so this is a plausible-mode range (the game's own cap is
 * 8192, docs/hires.md) rather than a fixed list. */
static inline int web_video_size_allowed(int width, int height) {
    return width >= 320 && width <= 8192 && height >= 200 && height <= 8192;
}
