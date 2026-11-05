"""The dropdown patch must identify its paint epilogue without touching other copies."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from run_lift import (
    RA2_HIRES_SITE,
    RA2_SHELL_SITES,
    RA2_SHELL_SWITCH_BACK,
    apply_patches,
    dropdown_frame_patches,
    ra2_hires_patches,
    RA2_CONFIRM_SITES,
    ra2_confirm_patches,
    RA2_CACHE_SITE,
    ra2_cache_patches,
    RA2_MODE_CAP_SITES,
    ra2_mode_cap_patches,
    RA2_LOAD_AFTER,
    RA2_LOAD_SITE,
    RA2_LOAD_TARGET,
    ra2_load_patches,
    RA2_PROFILE_SITE,
    RA2_TAB_SITE,
    RA2_TAB_TARGET,
    ra2_profile_patches,
    ra2_tab_patches,
    ra2_online_patches,
    yr_online_patches,
    YR_STARTUP_ORDER,
    RA2_STARTUP_ORDER,
    yr_startup_order_patches,
    ra2_startup_order_patches,
    INTRO_SITES,
    intro_patches,
    MOVIE_SKIP_SITES,
    movie_skip_patches,
    WDT_SITES,
    wdt_patches,
    RECONNECT_LEAVE,
    reconnect_patches,
    ra2_shell_patches,
    thai_font_call_replacements,
    THEME_PLAYSONG_ARG,
    theme_song_guard,
    web_exit_confirmation_patches,
    WEB_URL_SITES,
    web_url_patches,
    PAGE_CURSOR_SITES,
    PAGE_CURSOR_ENTRY,
    page_cursor_patches,
    PAGE_CURSOR_PALETTE_SITES,
    page_cursor_palette_patches,
)


def paint_epilogue(primary, alternate):
    return (bytes.fromhex('8d54247852ff50088b0d') + primary.to_bytes(4, 'little')
            + bytes.fromhex('8b01ff50608b0d') + alternate.to_bytes(4, 'little')
            + bytes.fromhex('8b11ff52608b8424900300006a0050ff1578147e00'))


class DropdownPatchTests(unittest.TestCase):
    def test_both_surface_layouts_patch_after_the_last_argument_push(self):
        for primary, alternate in ((0x887308, 0x887310), (0x839950, 0x839958)):
            with self.subTest(primary=primary):
                code = paint_epilogue(primary, alternate)
                self.assertEqual(list(dropdown_frame_patches(code, 0x400000)), [0x400004])

    def test_an_unrelated_copy_without_the_paint_validation_is_untouched(self):
        code = paint_epilogue(0x887308, 0x887310)
        self.assertFalse(dropdown_frame_patches(code[:-8] + bytes(8), 0x400000))

    def test_a_different_argument_setup_is_untouched(self):
        code = bytearray(paint_epilogue(0x887308, 0x887310))
        code[4] = 0x50  # push eax, not the dropdown's destination rectangle
        self.assertFalse(dropdown_frame_patches(bytes(code), 0x400000))

    def test_ambiguous_modified_code_is_untouched(self):
        code = paint_epilogue(0x887308, 0x887310)
        self.assertFalse(dropdown_frame_patches(code + code, 0x400000))

    def test_a_copy_between_the_same_surface_is_untouched(self):
        self.assertFalse(dropdown_frame_patches(paint_epilogue(0x887308, 0x887308), 0x400000))


class WebExitConfirmationPatchTests(unittest.TestCase):
    @staticmethod
    def call(helper, base=0x400000):
        return (bytes.fromhex('5353555756e8')
                + (helper - (base + 10)).to_bytes(4, 'little', signed=True)
                + bytes.fromhex('85c07510'))

    def test_each_target_bypasses_only_the_exit_call_and_keeps_the_native_fallback(self):
        for target, helper in [('gamemd', 0x5D3490), ('game', 0x5B46B0)]:
            patches = web_exit_confirmation_patches(self.call(helper), 0x400000, target)
            self.assertEqual(list(patches), [0x400005])
            original = '    RECOMP_CALL(sub_%08X); /* 0x00400005: call */\n' % helper
            result = apply_patches(original, patches)
            self.assertIn('#ifdef __EMSCRIPTEN__', result)
            self.assertIn('ra2_web_exit_confirmation()', result)
            self.assertIn('esp += 20', result)
            self.assertIn('#else\n    RECOMP_CALL(sub_%08X);' % helper, result)

    def test_unrelated_confirmation_call_is_untouched(self):
        self.assertFalse(web_exit_confirmation_patches(self.call(0x500000), 0x400000, 'gamemd'))

    def test_different_argument_setup_is_untouched(self):
        code = bytearray(self.call(0x5D3490))
        code[0] = 0x50
        self.assertFalse(web_exit_confirmation_patches(bytes(code), 0x400000, 'gamemd'))

    def test_a_different_result_check_is_untouched(self):
        code = self.call(0x5D3490)[:-4] + bytes(4)
        self.assertFalse(web_exit_confirmation_patches(code, 0x400000, 'gamemd'))

    def test_ambiguous_matching_calls_are_untouched(self):
        a = self.call(0x5D3490)
        b = self.call(0x5D3490, 0x400000 + len(a))
        self.assertFalse(web_exit_confirmation_patches(a + b, 0x400000, 'gamemd'))


class ThaiFontCallTests(unittest.TestCase):
    def test_indirect_calls_route_through_thai_font_dispatch(self):
        body = 'RECOMP_ICALL(MEM32(edx + 0xC)); RECOMP_ICALL(eax);'
        self.assertEqual(
            thai_font_call_replacements(body, 'gamemd'),
            'RECOMP_THAI_ICALL(MEM32(edx + 0xC)); RECOMP_THAI_ICALL(eax);',
        )

    def test_each_target_routes_only_its_font_calls(self):
        yar = 'RECOMP_CALL(sub_00434120); RECOMP_CALL(sub_00434CD0); RECOMP_CALL(sub_00434500);'
        ra2 = 'RECOMP_CALL(sub_004318E0); RECOMP_CALL(sub_00432490); RECOMP_CALL(sub_00431CC0);'
        self.assertEqual(
            thai_font_call_replacements(yar, 'gamemd'),
            'RECOMP_THAI_CALL(0x00434120u, sub_00434120); '
            'RECOMP_THAI_CALL(0x00434CD0u, sub_00434CD0); '
            'RECOMP_THAI_CALL(0x00434500u, sub_00434500);',
        )
        self.assertEqual(thai_font_call_replacements(ra2, 'game'),
            'RECOMP_THAI_CALL(0x004318E0u, sub_004318E0); '
            'RECOMP_THAI_CALL(0x00432490u, sub_00432490); '
            'RECOMP_THAI_CALL(0x00431CC0u, sub_00431CC0);')
        self.assertEqual(thai_font_call_replacements(yar, 'game'), yar)


class RA2ShellPatchTests(unittest.TestCase):
    """Red Alert 2's 800x600 shell and forced mode toggle (run_lift.py ra2_shell_patches)."""

    SIZE = 0x00700000  # code from VA 0 covers every site

    @staticmethod
    def image(corrupt=None):
        code = bytearray(RA2ShellPatchTests.SIZE)

        def put(va, hexbytes):
            raw = bytes.fromhex(hexbytes.replace(' ', ''))
            code[va:va + len(raw)] = raw

        for va, shape in RA2_SHELL_SITES.values():
            put(va, shape)
        for site in RA2_SHELL_SWITCH_BACK:
            put(site['cmp_w'], '813d48968300' + '80020000')
            put(site['je'], '7400')
            put(site['cmp_h'], '813d4c968300' + 'e0010000')
            put(site['jle'], '7e00')
            for va, reg, imm in site['movs']:
                put(va, ('ba' if reg == 'edx' else 'b9') + imm.to_bytes(4, 'little').hex())
        if corrupt is not None:
            code[corrupt] ^= 0xFF
        return bytes(code)

    def test_every_site_is_patched_and_the_switch_goes_to_800x600(self):
        patches = ra2_shell_patches(self.image(), 0)
        expected = {0x0068E9D9, 0x005D8E2D, 0x006901B1}
        for site in RA2_SHELL_SWITCH_BACK:
            expected |= {site['je'], site['jle']} | {va for va, _r, _i in site['movs']}
        self.assertEqual(set(patches), expected)
        self.assertIn('MEM8(0xA40D0B) = 1u;', patches[0x0068E9D9])
        self.assertIn('ebx = 0x320u; esi = 0x258u;', patches[0x006901B1])
        self.assertIn('edx = 0x258u;', patches[0x0065D959])
        self.assertIn('ecx = 0x320u;', patches[0x0065D95E])

    def test_the_width_test_is_replaced_and_the_height_test_is_dropped(self):
        patches = ra2_shell_patches(self.image(), 0)
        body = ('    if (CMP_EQ(_flag_a, _flag_b)) goto L_0065D97B; /* 0x0065D93E: je 0x65d97b */\n'
                '    if (CMP_LE(_flag_a, _flag_b)) goto L_0065D97B; /* 0x0065D94A: jle 0x65d97b */\n'
                '    edx = 0x190u; /* 0x0065D959: mov edx, 0x190 */\n')
        result = apply_patches(body, {k: patches[k] for k in (0x0065D93E, 0x0065D94A, 0x0065D959)})
        self.assertIn('if (MEM32(0x839648) == 0x320u && MEM32(0x83964C) == 0x258u) goto L_0065D97B;', result)
        self.assertNotIn('CMP_EQ(_flag_a, _flag_b)) goto L_0065D97B;', result)
        self.assertNotIn('CMP_LE(_flag_a, _flag_b)) goto L_0065D97B;', result)
        self.assertIn('edx = 0x258u;', result)

    def test_a_different_build_gets_no_shell_patches(self):
        base = self.image()
        for va in (0x0068E9D9, 0x006901B1, 0x0065D959, 0x0065DF8F):
            with self.subTest(va=va):
                self.assertEqual(ra2_shell_patches(self.image(corrupt=va), 0), {})
        self.assertNotEqual(ra2_shell_patches(base, 0), {})


class RA2HiResPatchTests(unittest.TestCase):
    """AllowHiResModes forced on at its Options store (run_lift.py ra2_hires_patches)."""

    def test_the_options_store_is_forced_on(self):
        va, shape = RA2_HIRES_SITE
        code = bytearray(va + 8)
        code[va:va + 3] = bytes.fromhex(shape)
        patches = ra2_hires_patches(bytes(code), 0)
        self.assertEqual(list(patches), [va])
        self.assertIn('MEM8(esi + 0x29) = 1u;', patches[va])

    def test_a_different_build_is_untouched(self):
        va, _shape = RA2_HIRES_SITE
        self.assertEqual(ra2_hires_patches(bytes(va + 8), 0), {})


class OnlineNoLimitPatchTests(unittest.TestCase):
    """No online resolution limit (run_lift.py ra2/yr_online_patches)."""

    @staticmethod
    def yr_image(corrupt=None):
        code = bytearray(0x00790000)
        va = 0x007899AA
        rel = (0x00789A58 - (va + 6)) & 0xFFFFFFFF
        code[va:va + 6] = bytes.fromhex('0f8e') + rel.to_bytes(4, 'little')
        if corrupt is not None:
            code[corrupt] ^= 0xFF
        return bytes(code)

    def test_red_alert_2_keeps_its_shipping_uncapped_join_check(self):
        self.assertEqual(ra2_online_patches(self.yr_image(), 0), {})

    def test_yuris_revenge_accepts_every_room_without_a_prompt_or_clamp(self):
        patches = yr_online_patches(self.yr_image(), 0)
        self.assertEqual(set(patches), {0x007899AA})
        self.assertEqual(patches[0x007899AA],
                         '@replace:goto L_00789A58; '
                         '/* remaster: no online resolution limit, run_lift.py yr_online_patches */')

    def test_a_different_build_gets_no_online_patch(self):
        self.assertEqual(yr_online_patches(self.yr_image(corrupt=0x007899AA), 0), {})


class WDTPatchTests(unittest.TestCase):
    """World Domination's hover and its 640x480 limit (run_lift.py wdt_patches)."""

    @staticmethod
    def image(target, corrupt=None):
        sites = WDT_SITES[target]
        code = bytearray(0x00800000)
        for name in ('hover', 'resolution', 'prompt', 'ini_width', 'ini_height', 'pick', 'pick_update', 'game_start', 'logout', 'art', 'thumbnail'):
            if name not in sites:
                continue
            va, shape = sites[name]
            raw = bytes.fromhex(shape)
            code[va:va + len(raw)] = raw
        if corrupt is not None:
            code[corrupt] ^= 0xFF
        return bytes(code)

    def test_every_edition_patches_the_hover_site_and_keeps_the_640_switch(self):
        for target in ('game', 'gamemd'):
            with self.subTest(target=target):
                sites = WDT_SITES[target]
                patches = wdt_patches(self.image(target), 0, target)
                self.assertIn(sites['hover'][0], patches)
                self.assertNotIn(sites['resolution'][0], patches)

    def test_wdt_switches_to_640_without_overwriting_the_configured_size(self):
        for target in ('game', 'gamemd'):
            with self.subTest(target=target):
                sites = WDT_SITES[target]
                patches = wdt_patches(self.image(target), 0, target)
                self.assertIn('goto L_%08X;' % sites['prompt_target'], patches[sites['prompt'][0]])
                self.assertIn('keep the configured width', patches[sites['ini_width'][0]])
                self.assertIn('keep the configured height', patches[sites['ini_height'][0]])

    def test_a_match_starts_at_the_configured_size(self):
        for target in ('game', 'gamemd'):
            with self.subTest(target=target):
                sites = WDT_SITES[target]
                patches = wdt_patches(self.image(target), 0, target)
                body = patches[sites['game_start'][0]]
                self.assertIn('sub_%08X' % sites['mode_set'], body)
                self.assertIn('MEM32(0x%08Xu) > 0x280u' % sites['mode_width'], body)
                self.assertIn('esp = esp - 0x90u;', body)
                self.assertIn('ra2_wdt_take_mode_switch()', body)
                self.assertIn('RECOMP_CALL(sub_%08X)' % sites['mode_set'], body)

    def test_logout_returns_to_the_800x600_shell(self):
        for target in ('game', 'gamemd'):
            with self.subTest(target=target):
                sites = WDT_SITES[target]
                patches = wdt_patches(self.image(target), 0, target)
                body = patches[sites['logout'][0]]
                self.assertIn('ecx = 0x320u; edx = 0x258u;', body)
                self.assertIn('MEM32(0x%08Xu) != 0x320u' % sites['current_width'], body)

    def test_a_territory_pick_is_reported_to_the_lobby(self):
        for target in ('game', 'gamemd'):
            with self.subTest(target=target):
                sites = WDT_SITES[target]
                patches = wdt_patches(self.image(target), 0, target)
                for name in ('pick', 'pick_update'):
                    body = patches[sites[name][0]]
                    self.assertIn('ra2_wdt_pick((int)eax)', body)
                    self.assertIn('MEM32(esi + 0x460) = eax;', body)

    def test_a_mouse_move_runs_the_same_hit_test_as_wm_nchittest(self):
        for target in ('game', 'gamemd'):
            with self.subTest(target=target):
                sites = WDT_SITES[target]
                patches = wdt_patches(self.image(target), 0, target)
                body = patches[sites['hover'][0]]
                self.assertIn('if (ebx == 0x200u || ebx == 0x201u) goto L_%08X;'
                              % sites['hover_target'], body)
                self.assertIn('ebx = ebx - 0x202u;', body)

    def test_the_stock_640x480_switch_is_kept(self):
        """The WDT screen is authored for 640x480; its layout is wrong elsewhere."""
        for target in ('game', 'gamemd'):
            with self.subTest(target=target):
                sites = WDT_SITES[target]
                patches = wdt_patches(self.image(target), 0, target)
                self.assertNotIn(sites['resolution'][0], patches)

    def test_a_negative_gt_index_skips_the_thumbnail_surface(self):
        """A game-list row with no type used to build gt-1.bmp and crash."""
        for target in ('game', 'gamemd'):
            with self.subTest(target=target):
                sites = WDT_SITES[target]
                patches = wdt_patches(self.image(target), 0, target)
                body = patches[sites['thumbnail'][0]]
                self.assertIn('if ((int32_t)esi >= 0 && (int32_t)edx >= 0)', body)
                self.assertIn(sites['thumbnail_call'], body)

    def test_a_different_build_gets_no_wdt_patches(self):
        for target in ('game', 'gamemd'):
            for name in ('hover', 'resolution'):
                with self.subTest(target=target, name=name):
                    va = WDT_SITES[target][name][0]
                    self.assertEqual(wdt_patches(self.image(target, corrupt=va), 0, target), {})


class ReconnectPatchTests(unittest.TestCase):
    """Leaving a match from the reconnection screen (run_lift.py reconnect_patches)."""

    SIZE = 0x00800000

    @staticmethod
    def image(target, corrupt=None):
        t = RECONNECT_LEAVE[target]
        code = bytearray(ReconnectPatchTests.SIZE)
        state_va, state_raw = t['state']
        raw = bytes.fromhex(state_raw)
        code[state_va:state_va + len(raw)] = raw
        for va, fn in t['returns']:
            code[va:va + 5] = b'\xe8' + (fn - (va + 5)).to_bytes(4, 'little', signed=True)
        if corrupt is not None:
            code[corrupt] ^= 0xFF
        return bytes(code)

    def test_both_leave_returns_put_the_800x600_shell_back(self):
        for target in ('game', 'gamemd'):
            with self.subTest(target=target):
                t = RECONNECT_LEAVE[target]
                patches = reconnect_patches(self.image(target), 0, target)
                self.assertEqual(set(patches), {va for va, _fn in t['returns']})
                for body in patches.values():
                    self.assertIn('ecx = 0x320u; edx = 0x258u;', body)
                    self.assertIn('MEM32(0x%08Xu) != 0x320u' % t['width'], body)
                    self.assertIn('MEM32(0x%08Xu) != 0x258u' % t['height'], body)
                    self.assertIn('RECOMP_CALL(sub_%08X)' % t['mode_set'], body)

    def test_a_different_build_gets_no_reconnect_patch(self):
        for target in ('game', 'gamemd'):
            t = RECONNECT_LEAVE[target]
            for name in ('state', 'return'):
                va = t['state'][0] if name == 'state' else t['returns'][0][0]
                with self.subTest(target=target, name=name):
                    self.assertEqual(reconnect_patches(self.image(target, corrupt=va), 0, target), {})


class RA2ConfirmPatchTests(unittest.TestCase):
    """The 0xD9 size confirm treated as Ok (run_lift.py ra2_confirm_patches)."""

    SIZE = 0x00550000

    @staticmethod
    def image(target=0x005FF610, push_at=None, call_at=None):
        code = bytearray(RA2ConfirmPatchTests.SIZE)
        for name, (va, push_va, _slot) in RA2_CONFIRM_SITES.items():
            code[push_va:push_va + 2] = b'\x6a\x00'
            rel = (target - (va + 5)) & 0xFFFFFFFF
            code[va:va + 5] = b'\xe8' + rel.to_bytes(4, 'little')
        if push_at is not None:
            code[push_at] = 0x90
        if call_at is not None:
            code[call_at] = 0x90
        return bytes(code)

    def test_both_confirm_calls_are_treated_as_ok(self):
        patches = ra2_confirm_patches(self.image(), 0)
        self.assertEqual(set(patches), {0x00542719, 0x00543B0C})
        self.assertIn('esp += 4; MEM32(esp + 0x60) = 1u; eax = 0;', patches[0x00542719])
        self.assertIn('esp += 4; MEM32(esp + 0x10) = 1u; eax = 0;', patches[0x00543B0C])

    def test_the_replacement_takes_the_whole_call_line(self):
        body = '    RECOMP_CALL(sub_005FF610); /* 0x00542719: call 0x5ff610 */\n    ebx = eax; /* 0x0054271E */\n'
        result = apply_patches(body, {0x00542719: ra2_confirm_patches(self.image(), 0)[0x00542719]})
        self.assertNotIn('RECOMP_CALL(sub_005FF610)', result)
        self.assertIn('ebx = eax;', result)

    def test_a_different_build_gets_no_patches(self):
        self.assertEqual(ra2_confirm_patches(self.image(target=0x00500000), 0), {})
        self.assertEqual(ra2_confirm_patches(self.image(push_at=0x00542705), 0), {})


class RA2LoadPatchTests(unittest.TestCase):
    """A loaded saved game switches to the INI size (run_lift.py ra2_load_patches)."""

    SIZE = 0x00700000

    @staticmethod
    def image(target=RA2_LOAD_TARGET, push=0x56, call=0xE8):
        code = bytearray(RA2LoadPatchTests.SIZE)
        va = RA2_LOAD_SITE
        rel = (target - (va + 5)) & 0xFFFFFFFF
        code[va] = call
        code[va + 1:va + 5] = rel.to_bytes(4, 'little')
        code[RA2_LOAD_AFTER[0]] = push
        return bytes(code)

    def test_the_switch_follows_the_loaders_last_call(self):
        patches = ra2_load_patches(self.image(), 0)
        self.assertEqual(set(patches), {RA2_LOAD_SITE})
        c = patches[RA2_LOAD_SITE]
        self.assertIn('MEM8(0xA40D0B) != 0u', c)
        self.assertIn('ecx = MEM32(0x00A40B38); edx = MEM32(0x00A40B3C); RECOMP_CALL(sub_005434E0);', c)
        body = ('    RECOMP_CALL(sub_006F30F0); /* 0x00656B1E: call 0x6f30f0 */\n'
                '    esp -= 4; /* 0x00656B23 */\n')
        result = apply_patches(body, patches)
        self.assertLess(result.index('sub_006F30F0'), result.index('sub_005434E0'))
        self.assertLess(result.index('sub_005434E0'), result.index('0x00656B23'))

    def test_a_different_build_gets_no_patch(self):
        self.assertEqual(ra2_load_patches(self.image(target=0x00500000), 0), {})
        self.assertEqual(ra2_load_patches(self.image(push=0x90), 0), {})
        self.assertEqual(ra2_load_patches(self.image(call=0x90), 0), {})


class RA2ProfilePatchTests(unittest.TestCase):
    """The display profile is rebuilt after the match-start switch (ra2_profile_patches)."""

    @staticmethod
    def image(target=0x005434E0, call=0xE8):
        code = bytearray(0x00700000)
        va = RA2_PROFILE_SITE
        code[va] = call
        code[va + 1:va + 5] = ((target - (va + 5)) & 0xFFFFFFFF).to_bytes(4, 'little')
        return bytes(code)

    def test_the_profile_is_torn_down_and_built_again_after_the_switch(self):
        patches = ra2_profile_patches(self.image(), 0)
        self.assertEqual(set(patches), {RA2_PROFILE_SITE})
        c = patches[RA2_PROFILE_SITE]
        self.assertLess(c.index('sub_006F30F0'), c.index('sub_006F3D50'))
        self.assertEqual(c.count('sub_006F1FA0'), 3)
        self.assertTrue(c.rstrip().rstrip('*/ ').endswith('}') or 'eax = _eax; }' in c)

    def test_the_load_patch_resets_the_profile_too(self):
        c = ra2_load_patches(RA2LoadPatchTests.image(), 0)[RA2_LOAD_SITE]
        self.assertLess(c.index('sub_005434E0'), c.index('sub_006F30F0'))
        self.assertEqual(c.count('sub_006F1FA0'), 3)

    def test_a_different_build_gets_no_patch(self):
        self.assertEqual(ra2_profile_patches(self.image(target=0x00500000), 0), {})
        self.assertEqual(ra2_profile_patches(self.image(call=0x90), 0), {})


class RA2TabPatchTests(unittest.TestCase):
    """The command bar is placed from the new layout (ra2_tab_patches)."""

    @staticmethod
    def image(target=RA2_TAB_TARGET, call=0xE8):
        code = bytearray(0x00700000)
        va = RA2_TAB_SITE
        code[va] = call
        code[va + 1:va + 5] = ((target - (va + 5)) & 0xFFFFFFFF).to_bytes(4, 'little')
        return bytes(code)

    def test_the_layout_and_the_bars_cached_position_follow_the_resize(self):
        patches = ra2_tab_patches(self.image(), 0)
        self.assertEqual(set(patches), {RA2_TAB_SITE})
        c = patches[RA2_TAB_SITE]
        self.assertLess(c.index('sub_006F44D0'), c.index('MEM32(0xABE374) = MEM32(MEM32(0xAC11FC) + 4u)'))
        self.assertLess(c.index('0xABE374'), c.index('sub_006A0670'))
        self.assertIn('ecx = MEM32(0xABE2AC)', c)

    def test_a_different_build_gets_no_patch(self):
        self.assertEqual(ra2_tab_patches(self.image(target=0x00500000), 0), {})
        self.assertEqual(ra2_tab_patches(self.image(call=0x90), 0), {})


class RA2CachePatchTests(unittest.TestCase):
    """Rebuild display profile caches after a mode switch invalidates them."""

    def test_cache_reload_is_guarded_and_keeps_the_native_resize_call(self):
        va, shape = RA2_CACHE_SITE
        code = bytearray(va + len(bytes.fromhex(shape)))
        code[va:va + len(bytes.fromhex(shape))] = bytes.fromhex(shape)
        patches = ra2_cache_patches(bytes(code), 0)
        self.assertEqual(set(patches), {va})
        body = '    goto L_006F3E70; /* 0x006F3450: jmp 0x6f3e70 */\n'
        result = apply_patches(body, patches)
        self.assertIn('if (MEM8(0xAC119C) == 0)', result)
        self.assertIn('RECOMP_CALL(sub_006F3D50)', result)
        self.assertIn('MEM8(0xAC119C) = 1u;', result)
        self.assertIn('goto L_006F3E70;', result)
        self.assertNotIn('/* 0x006F3450: jmp', result)
        self.assertLess(result.index('if (MEM8(0xAC119C) == 0)'), result.index('goto L_006F3E70;'))

    def test_a_different_build_is_untouched(self):
        va, shape = RA2_CACHE_SITE
        code = bytearray(va + len(bytes.fromhex(shape)))
        code[va:va + len(bytes.fromhex(shape))] = b'\x90' * len(bytes.fromhex(shape))
        self.assertEqual(ra2_cache_patches(bytes(code), 0), {})


class RA2ModeCapPatchTests(unittest.TestCase):
    """Raise both Options mode enumerators to an 8192-pixel bound."""

    SIZE = 0x00550000

    @classmethod
    def image(cls, corrupt=None):
        code = bytearray(cls.SIZE)
        for va, shape in RA2_MODE_CAP_SITES:
            code[va:va + len(bytes.fromhex(shape))] = bytes.fromhex(shape)
        if corrupt is not None:
            code[corrupt] ^= 0xFF
        return bytes(code)

    def test_both_dialogs_accept_modes_up_to_8192(self):
        patches = ra2_mode_cap_patches(self.image(), 0)
        self.assertEqual(set(patches), {va for va, _ in RA2_MODE_CAP_SITES})
        for va, _ in RA2_MODE_CAP_SITES:
            self.assertIn('PUSH32(esp, 0x2000u);', patches[va])

    def test_each_cap_push_is_replaced_in_place(self):
        patches = ra2_mode_cap_patches(self.image(), 0)
        body = ''.join('    PUSH32(esp, 0x1000u); /* 0x%08X: push 0x1000 */\n' % va
                       for va, _ in RA2_MODE_CAP_SITES)
        result = apply_patches(body, patches)
        self.assertEqual(result.count('PUSH32(esp, 0x2000u);'), 4)
        self.assertNotIn('PUSH32(esp, 0x1000u);', result)

    def test_a_partial_build_match_is_left_unpatched(self):
        self.assertEqual(ra2_mode_cap_patches(self.image(corrupt=RA2_MODE_CAP_SITES[2][0]), 0), {})


class ThemeSongGuardTests(unittest.TestCase):
    """A saved song id the theme pack lacks becomes "no song" (run_lift.py theme_song_guard)."""

    @staticmethod
    def image(target, corrupt=None):
        va = THEME_PLAYSONG_ARG[target]
        code = bytearray(va + 6)
        code[va - 3:va + 6] = bytes.fromhex('8b4e2c8b7c241085c9')
        if corrupt is not None:
            code[corrupt] ^= 0xFF
        return bytes(code)

    def test_both_editions_guard_the_argument_load(self):
        for target in ('game', 'gamemd'):
            with self.subTest(target=target):
                va = THEME_PLAYSONG_ARG[target]
                patches = theme_song_guard(self.image(target), 0, target)
                self.assertEqual(set(patches), {va})
                self.assertIn('(int32_t)edi >= 0', patches[va])
                self.assertIn('(uint32_t)edi >= MEM32(esi + 0x24)', patches[va])
                self.assertIn('edi = 0xFFFFFFFFu;', patches[va])

    def test_the_guard_follows_the_argument_load_in_the_lifted_body(self):
        va = THEME_PLAYSONG_ARG['game']
        patches = theme_song_guard(self.image('game'), 0, 'game')
        body = '    edi = MEM32(esp + 0x10); /* 0x%08X: mov edi, dword ptr [esp + 0x10] */\n' % va
        result = apply_patches(body, patches)
        self.assertLess(result.index('edi = MEM32(esp + 0x10);'), result.index('edi = 0xFFFFFFFFu;'))

    def test_a_different_build_is_untouched(self):
        for target in ('game', 'gamemd'):
            va = THEME_PLAYSONG_ARG[target]
            with self.subTest(target=target):
                self.assertEqual(theme_song_guard(self.image(target, corrupt=va), 0, target), {})


class WebUrlPatchTests(unittest.TestCase):
    """Each URL opener calls the host and returns before the browser path."""

    @staticmethod
    def image(target, corrupt=None):
        code = bytearray(0x00800000)
        for va, shape, _, _ in WEB_URL_SITES[target]:
            code[va:va + len(shape) // 2] = bytes.fromhex(shape)
        if corrupt is not None:
            code[corrupt] ^= 0xFF
        return bytes(code)

    def test_each_site_gets_one_early_return(self):
        for target in ('gamemd', 'game'):
            with self.subTest(target=target):
                patches = web_url_patches(self.image(target), 0, target)
                self.assertEqual(set(patches), {va for va, _, _, _ in WEB_URL_SITES[target]})
                for va, _, size, ask in WEB_URL_SITES[target]:
                    c = patches[va]
                    if ask == 'wol':
                        self.assertIn('ra2_open_wol_page(ecx)', c)
                    else:
                        self.assertIn('ra2_open_url(ecx, %s)' % ask, c)
                    self.assertIn('return;', c)
                    self.assertIn('esp = esp - 0x%Xu;' % size, c)

    def test_the_native_branch_reproduces_the_original_allocation(self):
        va, _, size, _ = WEB_URL_SITES['game'][0]
        patches = web_url_patches(self.image('game'), 0, 'game')
        body = '    esp = esp - 0x%Xu; /* 0x%08X: sub esp, 0x%X */\n' % (size, va, size)
        result = apply_patches(body, patches)
        self.assertIn('#if defined(__EMSCRIPTEN__) || defined(RA2_URL_HOST)', result)
        self.assertIn('ra2_open_url(ecx, edx)', result)
        self.assertIn('#else', result)
        self.assertEqual(result.count('esp = esp - 0x%Xu;' % size), 1)

    def test_wrong_bytes_produce_no_patch(self):
        for target in ('gamemd', 'game'):
            with self.subTest(target=target):
                va = WEB_URL_SITES[target][0][0]
                patches = web_url_patches(self.image(target, corrupt=va), 0, target)
                self.assertNotIn(va, patches)
                for other, _, _, _ in WEB_URL_SITES[target][1:]:
                    self.assertIn(other, patches)

    def test_the_embedded_browser_site_gets_the_page_hook(self):
        va, shape, size, _ = WEB_URL_SITES['gamemd'][2]
        self.assertEqual(bytes.fromhex(shape), b'\x83\xec\x28')
        patches = web_url_patches(self.image('gamemd'), 0, 'gamemd')
        self.assertIn('ra2_open_wol_page(ecx)', patches[va])
        self.assertIn('esp = esp - 0x%Xu;' % size, patches[va])


class PageCursorPatchTests(unittest.TestCase):
    """The in-match cursor is recorded at the entry and its blit can be skipped
    (run_lift.py page_cursor_patches)."""

    @staticmethod
    def image(target, corrupt=None):
        t = PAGE_CURSOR_SITES[target]
        entry_va, entry_bytes, _reg = PAGE_CURSOR_ENTRY[target]
        code = bytearray(max(t['blit'], entry_va) + 16)
        code[t['draw']:t['draw'] + len(bytes.fromhex(t['shape']))] = bytes.fromhex(t['shape'])
        code[t['blit']:t['blit'] + len(bytes.fromhex(t['call']))] = bytes.fromhex(t['call'])
        code[entry_va:entry_va + len(bytes.fromhex(entry_bytes))] = bytes.fromhex(entry_bytes)
        if corrupt is not None:
            code[corrupt] ^= 0xFF
        return bytes(code)

    def test_each_edition_records_the_object_and_guards_the_blit(self):
        for target in ('gamemd', 'game'):
            with self.subTest(target=target):
                t = PAGE_CURSOR_SITES[target]
                entry_va, _bytes, reg = PAGE_CURSOR_ENTRY[target]
                patches = page_cursor_patches(self.image(target), 0, target)
                self.assertEqual(set(patches), {entry_va, t['blit']})
                self.assertIn('ra2_page_cursor_this(%s)' % reg, patches[entry_va])
                c = patches[t['blit']]
                self.assertTrue(c.startswith('@replace:{'))
                self.assertIn('ra2_page_cursor_suppress()', c)
                self.assertIn('RECOMP_CALL(sub_%08X)' % t['blit_fn'], c)
                self.assertIn('ra2_page_cursor_drawn();', c)
                # skipping the call must pop its arguments, as its ret n does
                self.assertIn('if (ra2_page_cursor_suppress()) esp += 0x%Xu;' % t['args'], c)

    def test_the_game_keeps_drawing_its_own_cursor_without_a_suppression(self):
        for target in ('gamemd', 'game'):
            with self.subTest(target=target):
                t = PAGE_CURSOR_SITES[target]
                entry_va = PAGE_CURSOR_ENTRY[target][0]
                body = ('    MEM32(esp) = eax; /* 0x%08X: mov */\n'
                        '    RECOMP_CALL(sub_%08X); /* 0x%08X: call */\n') % (entry_va, t['blit_fn'], t['blit'])
                result = apply_patches(body, page_cursor_patches(self.image(target), 0, target))
                self.assertIn('ra2_page_cursor_this(', result)
                self.assertIn('else { RECOMP_CALL(sub_%08X);' % t['blit_fn'], result)
                self.assertNotIn('/* 0x%08X: call */' % t['blit'], result)

    def test_a_different_build_gets_no_patch(self):
        for target in ('gamemd', 'game'):
            t = PAGE_CURSOR_SITES[target]
            entry_va = PAGE_CURSOR_ENTRY[target][0]
            with self.subTest(target=target):
                self.assertEqual(page_cursor_patches(self.image(target, corrupt=t['draw']), 0, target), {})
                self.assertEqual(page_cursor_patches(self.image(target, corrupt=t['blit']), 0, target), {})
                self.assertEqual(page_cursor_patches(self.image(target, corrupt=entry_va), 0, target), {})


class PageCursorPalettePatchTests(unittest.TestCase):
    """MOUSEPAL.PAL reaches the host as the game loads it (run_lift.py page_cursor_palette_patches)."""

    @staticmethod
    def image(target, corrupt=None):
        t = PAGE_CURSOR_PALETTE_SITES[target]
        at = t['load']
        code = bytearray(at + 8)
        code[at - 5] = 0xB9
        code[at - 4:at] = t['string'].to_bytes(4, 'little')
        code[at] = 0xE8
        code[at + 1:at + 5] = (t['loader'] - (at + 5)).to_bytes(4, 'little', signed=True)
        if corrupt is not None:
            code[corrupt] ^= 0xFF
        return bytes(code)

    def test_each_edition_hands_the_palette_over(self):
        for target in ('gamemd', 'game'):
            with self.subTest(target=target):
                at = PAGE_CURSOR_PALETTE_SITES[target]['load']
                patches = page_cursor_palette_patches(self.image(target), 0, target)
                self.assertEqual(set(patches), {at})
                self.assertIn('ra2_page_cursor_palette(eax)', patches[at])
                body = '    RECOMP_CALL(sub_005B40B0); /* 0x%08X: call 0x5b40b0 */\n    RECOMP_FLAGS_IN();\n' % at
                result = apply_patches(body, patches)
                self.assertLess(result.index('ra2_page_cursor_palette(eax)'), result.index('RECOMP_FLAGS_IN'))

    def test_a_different_build_gets_no_palette_patch(self):
        for target in ('gamemd', 'game'):
            at = PAGE_CURSOR_PALETTE_SITES[target]['load']
            with self.subTest(target=target):
                self.assertEqual(page_cursor_palette_patches(self.image(target, corrupt=at - 5), 0, target), {})
                self.assertEqual(page_cursor_palette_patches(self.image(target, corrupt=at), 0, target), {})


class StartupOrderPatchTests(unittest.TestCase):
    """Both editions support boot-screen-first and logo-first at run time."""

    @staticmethod
    def put_call(code, cs, site, target):
        code[site - cs] = 0xE8
        code[site - cs + 1:site - cs + 5] = (target - (site + 5)).to_bytes(4, 'little', signed=True)

    def yr_image(self):
        cs = 0x0052C000
        code = bytearray(0x0052CA70 - cs)
        self.put_call(code, cs, *YR_STARTUP_ORDER['logo'])
        self.put_call(code, cs, *YR_STARTUP_ORDER['boot'])
        self.put_call(code, cs, *YR_STARTUP_ORDER['intro'])
        for site, raw in (YR_STARTUP_ORDER['setup'], YR_STARTUP_ORDER['after']):
            code[site - cs:site - cs + len(bytes.fromhex(raw))] = bytes.fromhex(raw)
        return bytes(code), cs

    def ra2_image(self):
        cs = 0x00511000
        code = bytearray(0x005126F8 - cs)
        self.put_call(code, cs, *RA2_STARTUP_ORDER['boot'])
        for logo, target, after, after_bytes in RA2_STARTUP_ORDER['logo']:
            self.put_call(code, cs, logo, target)
            code[after - cs:after - cs + 2] = bytes.fromhex(after_bytes)
        return bytes(code), cs

    def test_yuri_gets_a_conditional_boot_screen(self):
        code, cs = self.yr_image()
        patches = yr_startup_order_patches(code, cs)
        self.assertEqual(set(patches), {YR_STARTUP_ORDER['setup'][0], YR_STARTUP_ORDER['boot'][0],
                                        YR_STARTUP_ORDER['after'][0], YR_STARTUP_ORDER['intro'][0]})
        self.assertIn('ra2_startup_logo_first()', patches[YR_STARTUP_ORDER['setup'][0]])
        self.assertIn('if (!ra2_startup_logo_first())', patches[YR_STARTUP_ORDER['setup'][0]])
        self.assertIn('goto L_ra2_startup_after_logo', patches[YR_STARTUP_ORDER['setup'][0]])
        self.assertIn('if (ra2_startup_logo_first())', patches[YR_STARTUP_ORDER['boot'][0]])
        self.assertIn('L_ra2_startup_after_logo', patches[YR_STARTUP_ORDER['after'][0]])
        self.assertIn('sub_005BED40', patches[YR_STARTUP_ORDER['intro'][0]])

    def test_yuri_order_is_untouched_when_a_call_changed(self):
        code, cs = self.yr_image()
        bad = bytearray(code)
        bad[YR_STARTUP_ORDER['boot'][0] - cs + 1] ^= 0xFF
        self.assertEqual(yr_startup_order_patches(bytes(bad), cs), {})

    def test_ra2_gets_both_boot_screen_paths(self):
        code, cs = self.ra2_image()
        patches = ra2_startup_order_patches(code, cs)
        self.assertEqual(set(patches), {0x00511808, 0x0051269F, 0x005126C0, 0x005126F3})
        self.assertIn('if (!ra2_startup_logo_first())', patches[0x00511808])
        for site in (0x0051269F, 0x005126C0, 0x005126F3):
            self.assertIn('ra2_startup_take_boot_screen()', patches[site])

    def test_ra2_order_is_untouched_when_a_logo_call_changed(self):
        code, cs = self.ra2_image()
        bad = bytearray(code)
        bad[RA2_STARTUP_ORDER['logo'][0][0] - cs + 1] ^= 0xFF
        self.assertEqual(ra2_startup_order_patches(bytes(bad), cs), {})


class IntroPatchTests(unittest.TestCase):
    """The intro branch follows the host's Skip intro switch, not [Intro] Play."""

    @staticmethod
    def image(target):
        site, raw, label = INTRO_SITES[target]
        cs = site - 8
        code = bytearray(16)
        code[site - cs:site - cs + 2] = bytes.fromhex(raw)
        return bytes(code), cs, site, label

    def test_each_edition_asks_the_host(self):
        for target in ('gamemd', 'game'):
            with self.subTest(target=target):
                code, cs, site, label = self.image(target)
                patches = intro_patches(code, cs, target)
                self.assertEqual(set(patches), {site})
                self.assertIn('ra2_intro_enabled()', patches[site])
                self.assertIn('L_%08X' % label, patches[site])
                body = '    if (CMP_NE(a, b)) goto L_%08X; /* 0x%08X: branch */\n' % (label, site)
                result = apply_patches(body, patches)
                self.assertIn('ra2_intro_enabled()', result)
                self.assertIn('goto L_%08X' % label, result)

    def test_a_changed_branch_is_untouched(self):
        for target in ('gamemd', 'game'):
            with self.subTest(target=target):
                code, cs, _, _ = self.image(target)
                patched = bytearray(code)
                site = INTRO_SITES[target][0]
                patched[site - cs] ^= 0xFF
                self.assertEqual(intro_patches(bytes(patched), cs, target), {})


class MovieSkipPatchTests(unittest.TestCase):
    """Escape/click ending the start-up logo (run_lift.py movie_skip_patches)."""

    SIZE = 0x00800000

    @staticmethod
    def image(target, corrupt=None):
        code = bytearray(MovieSkipPatchTests.SIZE)
        site = MOVIE_SKIP_SITES[target]
        code[site:site + 3] = b'\x8a\x46\x2d'      # mov al, [esi+0x2d]
        if corrupt is not None:
            code[corrupt] ^= 0xFF
        return bytes(code)

    def test_the_start_up_loop_gets_the_skip_check(self):
        for target in ('gamemd', 'game'):
            with self.subTest(target=target):
                site = MOVIE_SKIP_SITES[target]
                patches = movie_skip_patches(self.image(target), 0, target)
                self.assertEqual(list(patches), [site])
                self.assertIn('ra2_startup_logo_skip()', patches[site])
                self.assertIn('MEM32(h + 0xC) = MEM32(h + 0x10)', patches[site])

    def test_a_different_loop_is_untouched(self):
        for target in ('gamemd', 'game'):
            with self.subTest(target=target):
                self.assertEqual(
                    movie_skip_patches(self.image(target, corrupt=MOVIE_SKIP_SITES[target]), 0, target),
                    {},
                )


if __name__ == '__main__':
    unittest.main()
