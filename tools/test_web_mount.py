"""The web build reads the game's big files in place through WasmFS (docs/web/decisions.md, D11)."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class WebMountTests(unittest.TestCase):
    def test_web_link_uses_wasmfs_and_the_opfs_read_library(self):
        cmake = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
        self.assertIn("-sWASMFS", cmake)
        self.assertIn("--js-library ${CMAKE_SOURCE_DIR}/src/web/opfs_read.js", cmake)
        self.assertNotIn("-lnodefs.js", cmake, "NODEFS does not exist under WasmFS")
        self.assertIn("callMain", cmake, "the page starts main() once the files are in place")

    def test_game_thread_mounts_opfs_before_main_reads_anything(self):
        main = (ROOT / "src/web/main.c").read_text(encoding="utf-8")
        mount = main.index('wasmfs_create_directory("/opfs"')
        self.assertLess(mount, main.index("script_arg(argc, argv, i)"))
        self.assertNotIn("RA2_WASMFS_SPIKE", main)

    def test_opfs_reads_take_a_shared_read_only_handle(self):
        lib = (ROOT / "src/web/opfs_read.js").read_text(encoding="utf-8")
        self.assertIn("createSyncAccessHandle({mode: 'read-only'})", lib)
        for name in ("open_blob", "read_blob", "close_blob", "get_size_blob"):
            self.assertIn(f"_wasmfs_opfs_{name}", lib)

    def test_start_up_waits_are_skipped_until_the_menu_and_can_be_restored(self):
        main = (ROOT / "src/web/main.c").read_text(encoding="utf-8")
        for hook in ("ra2_BinkOpen", "ra2_QueryPerformanceCounter", '"--intro"', "web_menu_seen"):
            self.assertIn(hook, main)
        presenter = (ROOT / "src/web/presenter.c").read_text(encoding="utf-8")
        self.assertIn("web_menu_seen = 1", presenter)


if __name__ == "__main__":
    unittest.main()
