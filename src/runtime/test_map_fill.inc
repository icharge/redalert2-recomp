/* FA2EX Test Map: the skirmish dialog's work, without the dialog (docs/web/test-map.md).
 *
 * Included by run_lift.py test_map_patches in place of Select_Game's call to the skirmish dialog
 * (gamemd 0x0052E168, game 0x00513DEC), in the lifted function's own context: the registers are its
 * locals and RECOMP_CALL reaches the lifted game. It leaves al = 1 for "Start Game", as the dialog
 * does, or 0 for "Back". Every step mirrors one stretch of the dialog (Yuri's Revenge addresses;
 * test_map_sites.h has both editions'):
 *   game mode and scenario   WM_INITDIALOG 0x006AEAC5-0x006AEBDD
 *   the human player         the Start branch 0x006AD394-0x006AD6F9
 *   AI rows                  0x006AD3C1-0x006AD5F8
 *   options                  0x006AD6F9-0x006AD8A4
 * The dialog's settings save (0x6990A0) is skipped on purpose: a test leaves the player's own
 * skirmish preferences alone. Edits here need no relift (only run_lift.py is hashed). */
#include "test_map_sites.h"
{
    extern int ra2_test_map_int(const char *, const char *, int);
    extern int ra2_test_map_has(const char *);
    extern void ra2_test_map_started(int);
    extern int ra2_test_map_is_scenario(const char *);
    extern int ra2_test_map_name(char *, int);
    extern void ra2_test_map_note(int, uint32_t);
    const uint32_t tm_ebx = ebx, tm_esi = esi, tm_edi = edi, tm_ebp = ebp;
    int tm_ok = 0;
    do {
        /* -- the game mode: the default (Battle), as the dialog's first visit picks (0x006AEADD) */
        RECOMP_CALL(TM_FN_DEFAULT_MODE);
        if (!eax) break;
        MEM32(TM_MODE_SAVED) = MEM32(eax + 0x28u);
        MEM32(TM_MODE) = MEM32(eax + 0x28u);
        RECOMP_CALL(TM_FN_MODE_OBJECT);               /* the mode object for that mode */
        if (!eax) break;
        const uint32_t tm_default_mode = eax;
        uint32_t tm_mode = eax;
        /* [Settings] GameMode=<id>: the mode number of MPModes(MD).ini (1 Battle, 2 Free For All,
         * ...), which the mode object keeps at +0x28 and the lookup 0x5D5F30 (RA2 0x5B6FE0, its
         * compare at 0x5B7096) matches; an id the game does not have falls back to the default */
        const int tm_want_mode = ra2_test_map_int("Settings", "GameMode", 0);
        if (tm_want_mode > 0 && (uint32_t)tm_want_mode != MEM32(tm_mode + 0x28u)) {
            MEM32(TM_MODE) = (uint32_t)tm_want_mode;
            RECOMP_CALL(TM_FN_MODE_OBJECT);
            if (eax && MEM32(eax + 0x28u) == (uint32_t)tm_want_mode) tm_mode = eax;
            else ra2_test_map_note(4, (uint32_t)tm_want_mode);
        }
        MEM32(TM_MODE_SAVED) = MEM32(tm_mode + 0x28u);
        MEM32(TM_MODE) = MEM32(tm_mode + 0x28u);

        /* -- the scenario: the start-up scan's list, by file name at item + 0x58, the way the join
         * check 0x5E3D10 compares them */
        const uint32_t tm_items = MEM32(TM_MAPS), tm_n = MEM32(TM_MAP_COUNT);
        int32_t tm_index = -1;
        for (uint32_t i = 0; i < tm_n; i++) {
            const char *item = (const char *)ADDR(MEM32(tm_items + i * 4u) + 0x58u);
            if (ra2_test_map_is_scenario(item)) { tm_index = (int32_t)i; break; }
        }
        if (tm_index < 0) { ra2_test_map_note(1, tm_n); break; }
        MEM32(TM_MAP_SAVED) = (uint32_t)tm_index;
        ecx = (uint32_t)tm_index;
        RECOMP_CALL(TM_FN_PICK_MAP);                  /* copies the name to the scenario's file name */
        if (!LO8(eax)) { ra2_test_map_note(2, 0u); break; }
        MEM32(TM_MAP_INDEX) = (uint32_t)tm_index;
        ecx = tm_mode;
        PUSH32(esp, MEM32(tm_items + 4u * (uint32_t)tm_index));   /* the item, not its index (0x006AEB5A) */
        RECOMP_CALL(TM_FN_MODE_OFFERS);               /* is the map offered under this mode? */
        if (!LO8(eax) && tm_mode != tm_default_mode) {   /* not under the chosen mode: the default */
            ra2_test_map_note(5, MEM32(tm_mode + 0x28u));
            tm_mode = tm_default_mode;
            MEM32(TM_MODE_SAVED) = MEM32(tm_mode + 0x28u);
            MEM32(TM_MODE) = MEM32(tm_mode + 0x28u);
            ecx = tm_mode;
            PUSH32(esp, MEM32(tm_items + 4u * (uint32_t)tm_index));
            RECOMP_CALL(TM_FN_MODE_OFFERS);
        }
        if (!LO8(eax)) { ra2_test_map_note(3, 0u); break; }
        ra2_test_map_note(6, MEM32(tm_mode + 0x28u));
        MEM32(TM_MODE_OBJECT) = tm_mode;

        /* -- the human: country (-2 random), colour (-2 random); YR also team (-1) and start (-1) */
        esp -= 0x40u;
        const uint32_t tm_buf = esp;
        if (ra2_test_map_name((char *)ADDR(tm_buf), 0x40)) {
            edx = tm_buf;
            ecx = TM_HANDLE;
            PUSH32(esp, 0xFFFFFFFFu);
            RECOMP_CALL(TM_FN_SET_STRING);            /* 0x006AD39F: the handle string (16-bit) */
        }
        esp = tm_buf + 0x40u;
        ecx = TM_SESSION;
        PUSH32(esp, 1u);
        PUSH32(esp, (uint32_t)ra2_test_map_int("Settings", "Country", -2));
        RECOMP_CALL(TM_FN_SET_COUNTRY);               /* 0x006AD3BA */
        ecx = TM_SESSION;
        PUSH32(esp, 1u);
        PUSH32(esp, (uint32_t)ra2_test_map_int("Settings", "Color", -2));
        RECOMP_CALL(TM_FN_SET_COLOUR);                /* 0x006AD636 */
#if TM_HAS_TEAM_START
        /* teams (YR's team slots, -1 none, 0..3 A..D): [AIn] Ally=1 puts that AI on the human's
         * team, team A when [Settings] Team is not given */
        int tm_team = ra2_test_map_int("Settings", "Team", -1);
        for (int i = 0; i < 7 && tm_team < 0; i++) {
            const char tm_sec[4] = { 'A', 'I', (char)('1' + i), 0 };
            if (ra2_test_map_has(tm_sec) && ra2_test_map_int(tm_sec, "Ally", 0)) tm_team = 0;
        }
        MEM32(TM_TEAM) = (uint32_t)tm_team;
        MEM32(TM_START) = (uint32_t)ra2_test_map_int("Settings", "Start", -1);
#endif

        /* -- AI rows. The live settings are 8-entry arrays, filled at the row's number (row r at
         * r + 1) and only for a row that holds an AI (0x006AD3C1-0x006AD4F2): level (the combo
         * data, Hard 0, Normal 1, Easy 2), country, colour, and in YR team and start. The count of
         * such rows is the AI count (0x006ACFBD-0x006AD052). The 12-byte records are what the
         * dialog restores next time (0x006AD4F8). */
        uint32_t tm_ai = 0;
        for (int i = 0; i < 7; i++) {
            const char tm_sec[4] = { 'A', 'I', (char)('1' + i), 0 };
            const int present = ra2_test_map_has(tm_sec);
            const int d = ra2_test_map_int(tm_sec, "Difficulty", 1);   /* the INI's 0 Easy, 1 Normal, 2 Hard */
            const uint32_t level = d >= 2 ? 0u : d <= 0 ? 2u : 1u;
            const uint32_t country = (uint32_t)ra2_test_map_int(tm_sec, "Country", -2);
            const uint32_t colour = (uint32_t)ra2_test_map_int(tm_sec, "Color", -2);
            if (present) {
                const uint32_t slot = 4u * (uint32_t)(i + 1);
                MEM32(TM_AI_LEVEL + slot) = level;
                MEM32(TM_AI_COUNTRY + slot) = country;
                MEM32(TM_AI_COLOUR + slot) = colour;
#if TM_HAS_TEAM_START
                MEM32(TM_AI_TEAM + slot) = ra2_test_map_int(tm_sec, "Ally", 0)
                    ? MEM32(TM_TEAM) : (uint32_t)ra2_test_map_int(tm_sec, "Team", -1);
                MEM32(TM_AI_START + slot) = (uint32_t)ra2_test_map_int(tm_sec, "Start", -1);
#endif
                tm_ai++;
            }
            /* the remembered row: None 1, Hard 4, Normal 5, Easy 6 (0x006AD5B0) */
            MEM32(TM_AI_REMEMBERED + 12u * (uint32_t)i) = !present ? 1u : level == 0u ? 4u : level == 1u ? 5u : 6u;
            MEM32(TM_AI_REMEMBERED + 4u + 12u * (uint32_t)i) = country;
            MEM32(TM_AI_REMEMBERED + 8u + 12u * (uint32_t)i) = colour;
        }
        MEM32(TM_AI_COUNT) = tm_ai;

        /* -- the human's player record, appended to the player vector (0x006AD647) */
        PUSH32(esp, TM_RECORD_SIZE);
        RECOMP_CALL(TM_FN_NEW);                       /* operator new */
        esp += 4u;
        const uint32_t tm_rec = eax;
        if (!tm_rec) break;
        ecx = tm_rec + 0x28u;
        RECOMP_CALL(TM_FN_NODE_CTOR);
        ecx = TM_HANDLE;
        RECOMP_CALL(TM_FN_STRING_TEXT);               /* the handle's text */
        PUSH32(esp, eax);
        PUSH32(esp, tm_rec);
        RECOMP_CALL(TM_FN_STRCPY);                    /* strcpy */
        esp += 8u;
        MEM32(tm_rec + 0x4Bu) = MEM32(TM_COUNTRY);
        MEM32(tm_rec + 0x53u) = MEM32(TM_COLOUR);
#if TM_HAS_TEAM_START
        MEM32(tm_rec + 0x5Bu) = MEM32(TM_TEAM);
        MEM32(tm_rec + 0x63u) = MEM32(TM_START);
        MEM32(tm_rec + 0x73u) = 0xFFFFFFFFu;
#else
        MEM32(tm_rec + 0x63u) = 0xFFFFFFFFu;          /* game 0x00683343 */
#endif
        const uint32_t tm_items_at = TM_PLAYERS + 4u, tm_cap_at = TM_PLAYERS + 8u;
        const uint32_t tm_count_at = TM_PLAYERS + 0x10u, tm_grow_at = TM_PLAYERS + 0x14u;
        if ((int32_t)MEM32(tm_count_at) >= (int32_t)MEM32(tm_cap_at)) {   /* full: grow it (0x006AD6B2) */
            const uint32_t cap = MEM32(tm_cap_at), grow = MEM32(tm_grow_at);
            if ((!MEM8(TM_PLAYERS + 0xDu) && cap) || (int32_t)grow <= 0) break;
            ecx = TM_PLAYERS;
            PUSH32(esp, 0u);
            PUSH32(esp, cap + grow);
            RECOMP_ICALL(MEM32(MEM32(TM_PLAYERS) + 8u));
            if (!LO8(eax)) break;
        }
        MEM32(MEM32(tm_items_at) + 4u * MEM32(tm_count_at)) = tm_rec;
        MEM32(tm_count_at) = MEM32(tm_count_at) + 1u;
        ecx = TM_SESSION;
        RECOMP_CALL(TM_FN_RANDOMS);                   /* 0x006AD6FE: settle the random picks */

        /* -- options (0x006AD703-0x006AD8A4) */
        const uint32_t tm_speed = 6u - (uint32_t)ra2_test_map_int("Settings", "GameSpeed", 2);
        MEM32(TM_SPEED) = tm_speed;
        MEM32(TM_SPEED_LIVE) = tm_speed;
        MEM32(TM_CREDITS) = (uint32_t)ra2_test_map_int("Settings", "Credits", 10000);
        MEM32(TM_UNITS) = (uint32_t)ra2_test_map_int("Settings", "UnitCount", 10);
        MEM8(TM_SHORT_GAME) = (uint8_t)(ra2_test_map_int("Settings", "ShortGame", 1) != 0);
        MEM8(TM_SUPERWEAPONS) = (uint8_t)(ra2_test_map_int("Settings", "Superweapons", 1) != 0);
        MEM8(TM_BUILD_OFF_ALLY) = (uint8_t)(ra2_test_map_int("Settings", "BuildOffAlly", 1) != 0);
        MEM8(TM_MCV_REPACKS) = (uint8_t)(ra2_test_map_int("Settings", "MCVRepacks", 1) != 0);
        MEM8(TM_CRATES) = (uint8_t)(ra2_test_map_int("Settings", "Crates", 0) != 0);
        MEM8(TM_FIXED_A) = 0;
        MEM8(TM_FIXED_B) = 1;
        MEM8(TM_FIXED_C) = 0;
        MEM8(TM_FIXED_D) = 0;
        tm_ok = 1;
    } while (0);
    ebx = tm_ebx; esi = tm_esi; edi = tm_edi; ebp = tm_ebp;
    ra2_test_map_started(tm_ok);
    SET_LO8(eax, tm_ok ? 1u : 0u);
}
