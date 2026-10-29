#pragma once

typedef struct {
    int width;
    int height;
} web_video_size_t;

static const web_video_size_t web_video_sizes[] = {
    {800, 600}, {1024, 768}, {1280, 720}, {1366, 768},
    {1600, 900}, {1920, 1080}, {2560, 1440}, {3840, 2160},
};

static inline int web_video_size_allowed(int width, int height) {
    for (unsigned i = 0; i < sizeof web_video_sizes / sizeof web_video_sizes[0]; i++)
        if (width == web_video_sizes[i].width && height == web_video_sizes[i].height)
            return 1;
    return 0;
}
