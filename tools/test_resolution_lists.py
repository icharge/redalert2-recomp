import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def pairs(text):
    return [(int(w), int(h)) for w, h in re.findall(r"\{\s*(\d+)\s*,\s*(\d+)\s*\}", text)]


class ResolutionListsTests(unittest.TestCase):
    def test_native_hle_presenter_and_browser_dropdown_share_the_same_sizes(self):
        host = (ROOT / "src/runtime/host.c").read_text(encoding="utf-8")
        presenter = (ROOT / "src/runtime/present.c").read_text(encoding="utf-8")
        browser = (ROOT / "web/src/storage/video-preferences.ts").read_text(encoding="utf-8")
        web_ddraw = (ROOT.parent / "pcrecomp/runtime/win32hle/ddraw.c").read_text(encoding="utf-8")
        web_user32 = (ROOT.parent / "pcrecomp/runtime/win32hle/user32.c").read_text(encoding="utf-8")
        host_body = re.search(r"g_extra_modes\[\]\[2\]\s*=\s*\{(.*?)\};", host, re.S).group(1)
        presenter_body = re.search(r"k_res\[\]\[2\]\s*=\s*\{(.*?)\};", presenter, re.S).group(1)
        web_ddraw_body = re.search(r"g_modes\[\]\[2\]\s*=\s*\{(.*?)\};", web_ddraw, re.S).group(1)
        browser_body = re.search(r"LAUNCHER_VIDEO_SIZES\s*=\s*\[(.*?)\]\s*as const;", browser, re.S).group(1)
        browser_sizes = [(int(w), int(h)) for w, h in re.findall(r"\{\s*w:\s*(\d+)\s*,\s*h:\s*(\d+)\s*\}", browser_body)]
        host_sizes, presenter_sizes, web_ddraw_sizes = pairs(host_body), pairs(presenter_body), pairs(web_ddraw_body)
        self.assertEqual(host_sizes, presenter_sizes)
        self.assertEqual(host_sizes, web_ddraw_sizes)
        self.assertEqual(host_sizes, browser_sizes)
        self.assertEqual(len(host_sizes), len(set(host_sizes)))
        self.assertIn("GetSystemMetrics(SM_CXSCREEN)", host)
        self.assertIn("GetPrivateProfileIntA(\"Video\", \"ScreenWidth\", 0, RA2_INI_NAME)", host)
        self.assertIn("mode_add(&e, mw, mh, &added)", host)
        self.assertIn("mode_add(&e, (uint32_t)ini_w, (uint32_t)ini_h, &added)", host)
        self.assertRegex(web_user32, r"x->nitems < 16 \? x->nitems : 16")
        for size in ((1366, 768), (2560, 1440), (3440, 1440), (3840, 2160), (5120, 1440)):
            self.assertIn(size, host_sizes)


if __name__ == "__main__":
    unittest.main()
