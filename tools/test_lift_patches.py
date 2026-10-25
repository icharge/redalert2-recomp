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
    ra2_shell_patches,
    thai_font_call_replacements,
    web_exit_confirmation_patches,
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


class RA2OnlinePatchTests(unittest.TestCase):
    """Red Alert 2's online resolution range (run_lift.py ra2_online_patches)."""

    SIZE = 0x00760000

    @staticmethod
    def rel32(va, length, target):
        return ((target - (va + length)) & 0xFFFFFFFF).to_bytes(4, 'little').hex()

    @classmethod
    def image(cls, jmp_target=0x00745895, call_target=0x00543A70, corrupt=None):
        code = bytearray(cls.SIZE)

        def put(va, hexbytes):
            raw = bytes.fromhex(hexbytes)
            code[va:va + len(raw)] = raw

        put(0x007457AA, 'bb20030000')
        put(0x007457BA, '2580feffff')
        put(0x007457BF, '0500040000')
        put(0x007457CC, 'e9' + cls.rel32(0x007457CC, 5, jmp_target))
        put(0x00745859, '8bd7')
        put(0x0074585B, 'e8' + cls.rel32(0x0074585B, 5, call_target))
        put(0x00745889, '7e0a')
        put(0x0065BF98, 'a1380ba400')
        if corrupt is not None:
            code[corrupt] ^= 0xFF
        return bytes(code)

    def test_every_site_is_patched(self):
        patches = ra2_online_patches(self.image(), 0)
        self.assertEqual(set(patches), {0x007457AA, 0x007457BA, 0x007457BF, 0x007457CC,
                                        0x00745859, 0x0074585B, 0x00745889, 0x0065BF98})

    def test_the_limit_is_1920_with_1024_for_the_640_flag(self):
        patches = ra2_online_patches(self.image(), 0)
        self.assertIn('ebx = 0x780u;', patches[0x007457AA])
        self.assertIn('eax = eax & 0xFFFFFC80u;', patches[0x007457BA])
        self.assertIn('eax = eax + 0x780u;', patches[0x007457BF])

    def test_the_skipped_check_becomes_a_real_one_and_the_clamp_is_quiet(self):
        patches = ra2_online_patches(self.image(), 0)
        body = '    goto L_00745895; /* 0x007457CC: jmp 0x745895 */\n'
        result = apply_patches(body, {0x007457CC: patches[0x007457CC]})
        self.assertIn('MEM8(0x00A40D0B) ? MEM32(0x00A40B38) : MEM32(0x008523E0)', result)
        self.assertIn('if ((int32_t)_w <= (int32_t)ebx) goto L_00745895;', result)
        # The shipping jump makes the old clamp unreachable from this function;
        # the lifter emits that block in a separate function, so a C goto is invalid.
        self.assertNotIn('goto L_0074582A;', result)
        self.assertIn('MEM32(0x00A40B38) = esi;', result)
        self.assertIn('MEM32(0x00A40B3C) = edi;', result)
        self.assertIn('RECOMP_CALL(sub_005D91B0)', result)
        self.assertNotIn('    goto L_00745895; /* 0x007457CC', result)
        self.assertIn('eax = 1u;', patches[0x0074585B])        # the live switch is not run

    def test_a_different_build_gets_no_online_patches(self):
        for va in (0x007457AA, 0x0065BF98, 0x00745859):
            with self.subTest(va=va):
                self.assertEqual(ra2_online_patches(self.image(corrupt=va), 0), {})
        self.assertEqual(ra2_online_patches(self.image(jmp_target=0x00745900), 0), {})
        self.assertEqual(ra2_online_patches(self.image(call_target=0x00500000), 0), {})


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


if __name__ == '__main__':
    unittest.main()
