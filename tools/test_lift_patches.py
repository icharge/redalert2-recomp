"""The dropdown patch must identify its paint epilogue without touching other copies."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from run_lift import (
    apply_patches,
    dropdown_frame_patches,
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


if __name__ == '__main__':
    unittest.main()
