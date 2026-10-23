/* The host owns game settings; the accessible F10 view displays these events
 * and sends commands through the input ring. One copy, in ra2.ini, saved by
 * the same OPFS write watcher as the game's own INI and saved games. */
#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include "win32hle.h"
#include "recomp_target.h"
#include "hdvox.h"
#include "mods.h"
#include "web_api.h"

static const char *scales[] = { "sharp", "smooth", "crt", "nearest", "integer" };
static int scale_mode, blur_bars = 1, modern, menu_open, video_w = 800, video_h = 600;
static char remembered_mod[128];
#define HOST_INI ".host/ra2.ini"
void web_modern_configure(int on);

#ifdef RA2_TARGET_GAME
#define OPTIONS_W 0x00A40B38u
#else
#define OPTIONS_W 0x00A8EB84u
#endif

/* Preserve other sections and keys when changing the game's own video INI. */
static int video_ini(int w, int h) {
    char path[4096], temp[4100], line[2048];
    if (!hle_host_path("C:\\" RA2_INI_NAME, path, sizeof path))
        snprintf(path, sizeof path, "%s", RA2_INI_NAME);
    snprintf(temp, sizeof temp, "%s.new", path);
    FILE *in = fopen(path, "r"), *out = fopen(temp, "w");
    if (!out) { if (in) fclose(in); return 0; }
    int video = 0, found = 0, width = 0, height = 0;
    while (in && fgets(line, sizeof line, in)) {
        char section[128], key[128];
        if (sscanf(line, " [%127[^]]]", section) == 1) {
            if (video) {
                if (!width) fprintf(out, "ScreenWidth=%d\n", w);
                if (!height) fprintf(out, "ScreenHeight=%d\n", h);
            }
            video = !strcasecmp(section, "Video");
            if (video) found = 1;
        }
        if (video && sscanf(line, " %127[^= ]", key) == 1) {
            if (!strcasecmp(key, "ScreenWidth")) { fprintf(out, "ScreenWidth=%d\n", w); width = 1; continue; }
            if (!strcasecmp(key, "ScreenHeight")) { fprintf(out, "ScreenHeight=%d\n", h); height = 1; continue; }
        }
        fputs(line, out);
    }
    if (in) fclose(in);
    if (!found) fputs("\n[Video]\n", out);
    if (video || !found) {
        if (!width) fprintf(out, "\nScreenWidth=%d\n", w);
        if (!height) fprintf(out, "ScreenHeight=%d\n", h);
    }
    int ok = fclose(out) == 0 && rename(temp, path) == 0;
    if (!ok) remove(temp);
    return ok;
}

void web_settings_event(void) {
    char line[768], mod[256];
    web_json_escape(mod, sizeof mod, mods_active());
    snprintf(line, sizeof line,
        "{\"e\":\"settings\",\"open\":%s,\"scale\":\"%s\",\"bars\":%s,\"hd\":%s,\"modern\":%s,\"width\":%d,\"height\":%d,\"mod\":\"%s\"}",
        menu_open ? "true" : "false", scales[scale_mode], blur_bars ? "true" : "false",
        ra2_vox_hd_on ? "true" : "false", modern ? "true" : "false", video_w, video_h, mod);
    web_event_json(line);
}
static void save(void) {
    FILE *f = fopen(HOST_INI, "w");
    if (!f) { web_event_error("Could not save the host settings."); return; }
    fprintf(f, "[present]\nscale=%s\nbars=%s\nhdvox=%d\ncontrols=%s\n[mods]\nactive=%s\n",
        scales[scale_mode], blur_bars ? "blur" : "black", ra2_vox_hd_on,
        modern ? "modern" : "classic", mods_active());
    fclose(f);
}
void web_settings_save_mod(void) { save(); }
const char *web_settings_mod(void) { return remembered_mod; }

void web_settings_start(const char *override_scale) {
    /* Keep host settings separate from the base game's case-insensitive RA2.INI. */
    mkdir(".host", 0777);
    char line[256], section[64] = "", key[64], value[128];
    FILE *f = fopen(HOST_INI, "r");
    while (f && fgets(line, sizeof line, f)) {
        if (sscanf(line, " [%63[^]]]", section) == 1) continue;
        if (sscanf(line, " %63[^= ]=%127[^\r\n]", key, value) != 2) continue;
        if (!strcasecmp(section, "mods") && !strcasecmp(key, "active"))
            snprintf(remembered_mod, sizeof remembered_mod, "%s", value);
        if (strcasecmp(section, "present")) continue;
        if (!strcasecmp(key, "scale")) for (int i = 0; i < 5; i++) if (!strcmp(value, scales[i])) scale_mode = i;
        if (!strcasecmp(key, "bars")) blur_bars = strcasecmp(value, "black") != 0;
        if (!strcasecmp(key, "hdvox")) hdvox_configure(atoi(value) != 0, NULL);
        if (!strcasecmp(key, "controls")) modern = !strcasecmp(value, "modern");
    }
    if (f) fclose(f);
    if (override_scale) for (int i = 0; i < 5; i++) if (!strcmp(override_scale, scales[i])) scale_mode = i;
    web_modern_configure(modern);
    char path[4096];
    if (hle_host_path("C:\\" RA2_INI_NAME, path, sizeof path) && (f = fopen(path, "r"))) {
        section[0] = 0;
        while (fgets(line, sizeof line, f)) {
            if (sscanf(line, " [%63[^]]]", section) == 1) continue;
            if (strcasecmp(section, "Video")) continue;
            if (sscanf(line, " %63[^= ]=%127[^\r\n]", key, value) != 2) continue;
            if (!strcasecmp(key, "ScreenWidth")) video_w = atoi(value);
            if (!strcasecmp(key, "ScreenHeight")) video_h = atoi(value);
        }
        fclose(f);
    }
}

void web_settings_command(int key, int value, int extra) {
    switch (key) {
    case RA2_SETTING_SCALE: if (value < 0 || value >= 5) return; scale_mode = value; break;
    case RA2_SETTING_BARS: blur_bars = value != 0; break;
    case RA2_SETTING_HD: hdvox_configure(value != 0, NULL); break;
    case RA2_SETTING_MODERN: modern = value != 0; web_modern_configure(modern); break;
    case RA2_SETTING_RESOLUTION: {
        static const int sizes[][2] = { {800,600}, {1024,768}, {1280,720}, {1366,768}, {1600,900}, {1920,1080}, {2560,1440} };
        int valid = 0;
        for (unsigned i = 0; i < sizeof sizes / sizeof sizes[0]; i++) if (value == sizes[i][0] && extra == sizes[i][1]) valid = 1;
        if (!valid) return;
        if (!video_ini(value, extra)) { web_event_error("Could not save the game resolution."); return; }
        video_w = value; video_h = extra;
        if (MEM32(OPTIONS_W) >= 320 && MEM32(OPTIONS_W) <= 8192 && MEM32(OPTIONS_W + 4) >= 200 && MEM32(OPTIONS_W + 4) <= 8192) {
            MEM32(OPTIONS_W) = (uint32_t)value; MEM32(OPTIONS_W + 4) = (uint32_t)extra;
        }
        fprintf(stderr, "[present] game resolution %dx%d (next game)\n", value, extra);
        break;
    }
    case RA2_SETTING_MENU: menu_open = value < 0 ? !menu_open : value != 0; web_settings_event(); return;
    default: return;
    }
    save();
    web_settings_event();
}
int web_settings_open(void) { return menu_open; }
