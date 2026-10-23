"""The dropdown patch must identify its paint epilogue without touching other copies."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from run_lift import dropdown_frame_patches


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


if __name__ == '__main__':
    unittest.main()
