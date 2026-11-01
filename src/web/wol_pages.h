#pragma once
#include <string.h>

/* The retail YR installer's registry links, from a Windows registry export
 * (HKLM\SOFTWARE\WOW6432Node\Westwood\Yuri's Revenge\URL). DoWebPageDialog
 * reads these values; the lift intercepts it before that, so this table maps
 * the page key back to the exact URL the game would have opened. Keeping the
 * original strings means the page receives the game's own URL, unchanged.
 *
 * Source: https://www.regfiles.net/registry/command-conquer-red-alert-2-yuris-revenge-registry
 * (the export also has the non-embedded *X variants and Signup/Insider; only
 * the keys the game's menus ask for are needed here). */
typedef struct {
    const char *key;
    const char *url;
} ra2_wol_page_url;

static const ra2_wol_page_url ra2_wol_page_urls[] = {
    { "Community", "http://westwood.ea.com/games/ccuniverse/redalert2/index.html" },
    { "Ladder",
      "http://battleclans.westwood.com/cgi-bin/cgiclient?rosetta&request=do_ladder&LANGCODE=0&SKU=10496&embedded=1" },
    { "Manage",
      "http://games2.westwood.com/cgi-bin/cgiclient?register&request=expand_template&Template=newreg_menu.html&LANGCODE=0&embedded=1&SKU=10496" },
    { "BattleClans",
      "http://battleclans.westwood.com/cgi-bin/cgiclient?rosetta&request=do_clan&LANGCODE=0&SKU=8448&embedded=1" },
    { "Battleclans",
      "http://battleclans.westwood.com/cgi-bin/cgiclient?rosetta&request=do_clan&LANGCODE=0&SKU=8448&embedded=1" },
    { "NetStatus",
      "http://battleclans.westwood.com/cgi-bin/cgiclient?rosetta&request=do_netstatus&LANGCODE=0&SKU=10496&embedded=1" },
    { "News",
      "http://battleclans.westwood.com/cgi-bin/cgiclient?rosetta&request=do_news&LANGCODE=0&SKU=10496&embedded=1" },
};

/* The URL the game's embedded browser would read for a page key, or NULL. */
static const char *ra2_wol_page_url_for(const char *key) {
    if (!key) return 0;
    for (unsigned i = 0; i < sizeof ra2_wol_page_urls / sizeof ra2_wol_page_urls[0]; i++)
        if (!strcmp(key, ra2_wol_page_urls[i].key)) return ra2_wol_page_urls[i].url;
    return 0;
}
