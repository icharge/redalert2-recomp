/* FA2EX Test Map: the skirmish dialog's work, without the dialog (docs/web/test-map.md).
 *
 * Included by run_lift.py test_map_patches in place of Select_Game's `call 0x6AE2C0` (gamemd
 * 0x0052E168), in the lifted function's own context: the registers are its locals and RECOMP_CALL
 * reaches the lifted game. It leaves al = 1 for "Start Game", as the dialog does, or 0 for "Back".
 * Every step mirrors one stretch of the dialog (Yuri's Revenge addresses):
 *   game mode and scenario   WM_INITDIALOG 0x006AEAC5-0x006AEBDD
 *   the human player         the Start branch 0x006AD394-0x006AD6F9
 *   AI rows                  0x006AD4F8-0x006AD5F8 (12-byte records from 0x00A8B3EC)
 *   options                  0x006AD6F9-0x006AD8A4
 * The dialog's settings save (0x6990A0) is skipped on purpose: a test leaves the player's own
 * skirmish preferences alone. Edits here need no relift (only run_lift.py is hashed). */
{
    extern int ra2_test_map_int(const char *, const char *, int);
    extern const char *ra2_test_map_str(const char *, const char *, const char *);
    extern int ra2_test_map_has(const char *);
    extern void ra2_test_map_started(int);
    extern int ra2_test_map_is_scenario(const char *);
    extern int ra2_test_map_name(char *, int);
    extern void ra2_test_map_note(int, uint32_t);
    const uint32_t tm_ebx = ebx, tm_esi = esi, tm_edi = edi, tm_ebp = ebp;
    int tm_ok = 0;
    do {
        /* -- the game mode: the default (Battle), as the dialog's first visit picks (0x006AEADD) */
        RECOMP_CALL(sub_005D5E10);
        if (!eax) break;
        MEM32(0xA8B3C4u) = MEM32(eax + 0x28u);
        MEM32(0xA8B250u) = MEM32(eax + 0x28u);
        RECOMP_CALL(sub_005E2F80);                    /* the mode object for that mode */
        if (!eax) break;
        const uint32_t tm_mode = eax;
        MEM32(0xA8B3C4u) = MEM32(tm_mode + 0x28u);
        MEM32(0xA8B250u) = MEM32(tm_mode + 0x28u);

        /* -- the scenario: the start-up scan's list (items at [0xA8B8CC], count [0xA8B8D8]), by file
         * name at item + 0x58, the way the join check 0x5E3D10 compares them */
        const uint32_t tm_items = MEM32(0xA8B8CCu), tm_n = MEM32(0xA8B8D8u);
        int32_t tm_index = -1;
        for (uint32_t i = 0; i < tm_n; i++) {
            const char *item = (const char *)ADDR(MEM32(tm_items + i * 4u) + 0x58u);
            if (ra2_test_map_is_scenario(item)) { tm_index = (int32_t)i; break; }
        }
        if (tm_index < 0) { ra2_test_map_note(1, tm_n); break; }
        MEM32(0xA8B3C8u) = (uint32_t)tm_index;
        ecx = (uint32_t)tm_index;
        RECOMP_CALL(sub_005E7BF0);                    /* copies the name to 0xA8B8E0 and Scen+0x125C */
        if (!LO8(eax)) { ra2_test_map_note(2, 0u); break; }
        MEM32(0xA8B254u) = (uint32_t)tm_index;
        ecx = tm_mode;
        PUSH32(esp, (uint32_t)tm_index);
        RECOMP_CALL(sub_005D63E0);                    /* is the map offered under this mode? */
        if (!LO8(eax)) { ra2_test_map_note(3, 0u); break; }
        MEM32(0xA8B23Cu) = tm_mode;

        /* -- the human: country (-2 random), colour (-2 random), team (-1 none), start (-1 random) */
        esp -= 0x40u;
        const uint32_t tm_buf = esp;
        if (ra2_test_map_name((char *)ADDR(tm_buf), 0x40)) {
            edx = tm_buf;
            ecx = 0xA8B380u;
            PUSH32(esp, 0xFFFFFFFFu);
            RECOMP_CALL(sub_00735090);                /* 0x006AD39F: the handle string */
        }
        esp = tm_buf + 0x40u;
        ecx = 0xA8B238u;
        PUSH32(esp, 1u);
        PUSH32(esp, (uint32_t)ra2_test_map_int("Settings", "Country", -2));
        RECOMP_CALL(sub_0069B760);                    /* 0x006AD3BA */
        ecx = 0xA8B238u;
        PUSH32(esp, 1u);
        PUSH32(esp, (uint32_t)ra2_test_map_int("Settings", "Color", -2));
        RECOMP_CALL(sub_0069B7E0);                    /* 0x006AD636 */
        MEM32(0xA8B39Cu) = (uint32_t)ra2_test_map_int("Settings", "Team", -1);
        MEM32(0xA8B3A4u) = (uint32_t)ra2_test_map_int("Settings", "Start", -1);

        /* -- AI rows: {kind, country, colour}. The dialog stores None 1, Hard 4, Normal 5, Easy 6
         * (its combo data -1/0/1/2, remapped at 0x006AD5B0) */
        /* The live AI settings are five 8-entry arrays, filled at the row's number (row r at r + 1)
         * and only for a row that holds an AI (0x006AD3C1-0x006AD4F2): level (the combo data, Hard 0,
         * Normal 1, Easy 2) 0xA8B27C, country 0xA8B29C, colour 0xA8B2BC, team 0xA8B2DC, start
         * 0xA8B2FC. The count of such rows is the AI count 0xA8B274 (0x006ACFBD-0x006AD052). The
         * 12-byte records from 0xA8B3EC are what the dialog restores next time (0x006AD4F8). */
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
                MEM32(0xA8B27Cu + slot) = level;
                MEM32(0xA8B29Cu + slot) = country;
                MEM32(0xA8B2BCu + slot) = colour;
                MEM32(0xA8B2DCu + slot) = 0xFFFFFFFFu;
                MEM32(0xA8B2FCu + slot) = (uint32_t)ra2_test_map_int(tm_sec, "Start", -1);
                tm_ai++;
            }
            /* the remembered row: None 1, Hard 4, Normal 5, Easy 6 (0x006AD5B0) */
            MEM32(0xA8B3ECu + 12u * (uint32_t)i) = !present ? 1u : level == 0u ? 4u : level == 1u ? 5u : 6u;
            MEM32(0xA8B3F0u + 12u * (uint32_t)i) = country;
            MEM32(0xA8B3F4u + 12u * (uint32_t)i) = colour;
        }
        MEM32(0xA8B274u) = tm_ai;

        /* -- the human's player record, appended to the player vector at 0xA8DA74 (0x006AD647) */
        PUSH32(esp, 0x85u);
        RECOMP_CALL(sub_007C8E17);                    /* operator new */
        esp += 4u;
        const uint32_t tm_rec = eax;
        if (!tm_rec) break;
        ecx = tm_rec + 0x28u;
        RECOMP_CALL(sub_0053ECB0);
        ecx = 0xA8B380u;
        RECOMP_CALL(sub_00735120);                    /* the handle's text */
        PUSH32(esp, eax);
        PUSH32(esp, tm_rec);
        RECOMP_CALL(sub_007CA489);                    /* strcpy */
        esp += 8u;
        MEM32(tm_rec + 0x4Bu) = MEM32(0xA8B3ACu);
        MEM32(tm_rec + 0x53u) = MEM32(0xA8B394u);
        MEM32(tm_rec + 0x5Bu) = MEM32(0xA8B39Cu);
        MEM32(tm_rec + 0x63u) = MEM32(0xA8B3A4u);
        MEM32(tm_rec + 0x73u) = 0xFFFFFFFFu;
        if ((int32_t)MEM32(0xA8DA84u) >= (int32_t)MEM32(0xA8DA7Cu)) {   /* full: grow it (0x006AD6B2) */
            const uint32_t cap = MEM32(0xA8DA7Cu), grow = MEM32(0xA8DA88u);
            if ((!MEM8(0xA8DA81u) && cap) || (int32_t)grow <= 0) break;
            ecx = 0xA8DA74u;
            PUSH32(esp, 0u);
            PUSH32(esp, cap + grow);
            RECOMP_ICALL(MEM32(MEM32(0xA8DA74u) + 8u));
            if (!LO8(eax)) break;
        }
        MEM32(MEM32(0xA8DA78u) + 4u * MEM32(0xA8DA84u)) = tm_rec;
        MEM32(0xA8DA84u) = MEM32(0xA8DA84u) + 1u;
        ecx = 0xA8B238u;
        RECOMP_CALL(sub_0069B8C0);                    /* 0x006AD6FE: settle the random picks */

        /* -- options (0x006AD703-0x006AD8A4) */
        const uint32_t tm_speed = 6u - (uint32_t)ra2_test_map_int("Settings", "GameSpeed", 2);
        MEM32(0xA8B268u) = tm_speed;
        MEM32(0xA8EB60u) = tm_speed;
        MEM32(0xA8B25Cu) = (uint32_t)ra2_test_map_int("Settings", "Credits", 10000);
        MEM32(0xA8B270u) = (uint32_t)ra2_test_map_int("Settings", "UnitCount", 10);
        MEM8(0xA8B262u) = (uint8_t)(ra2_test_map_int("Settings", "ShortGame", 1) != 0);
        MEM8(0xA8B263u) = (uint8_t)(ra2_test_map_int("Settings", "Superweapons", 1) != 0);
        MEM8(0xA8B264u) = (uint8_t)(ra2_test_map_int("Settings", "BuildOffAlly", 1) != 0);
        MEM8(0xA8B320u) = (uint8_t)(ra2_test_map_int("Settings", "MCVRepacks", 1) != 0);
        MEM8(0xA8B261u) = (uint8_t)(ra2_test_map_int("Settings", "Crates", 0) != 0);
        MEM8(0xA8B31Fu) = 0;
        MEM8(0xA8B260u) = 1;
        MEM8(0xA8B31Du) = 0;
        MEM8(0xA8B26Cu) = 0;
        tm_ok = 1;
    } while (0);
    ebx = tm_ebx; esi = tm_esi; edi = tm_edi; ebp = tm_ebp;
    ra2_test_map_started(tm_ok);
    SET_LO8(eax, tm_ok ? 1u : 0u);
}
