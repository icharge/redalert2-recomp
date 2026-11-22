"""A cached mode must republish its complete matching runtime without relinking."""
import gzip
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which('cmake') and shutil.which('node'), 'needs CMake and Node')
class WebPublicationTests(unittest.TestCase):
    def test_cached_mode_replaces_other_mode_and_preserves_other_edition(self):
        with tempfile.TemporaryDirectory(prefix='ra2 publication ') as temp:
            root = Path(temp)
            source = root / 'fixture'
            source.mkdir()
            output = root / 'web/public/game'
            output.mkdir(parents=True)
            (output / 'build.json').write_text(json.dumps({'games': {'ra2md': {'build': 'keep-yr'}}}))
            pe = bytearray(256)
            pe[:2] = b'MZ'
            struct.pack_into('<I', pe, 60, 64)
            pe[64:68] = b'PE\0\0'
            struct.pack_into('<I', pe, 72, 0x12345678)
            (source / 'game.exe').write_bytes(pe)
            (source / 'Blowfish.dll').write_bytes(b'fixture tables')
            (source / 'target.h').write_text(
                '#define RA2_EXE_NAME "game.exe"\n#define RA2_INI_NAME "ra2.ini"\n'
                '#define RA2_TITLE "Red Alert 2"\n#define RA2_EXE_STAMP 0x12345678u\n')
            (source / 'CMakeLists.txt').write_text(f'''
cmake_minimum_required(VERSION 3.20)
project(publication_fixture NONE)
find_program(NODE_EXECUTABLE node REQUIRED)
set(WEB_OUT "{output.as_posix()}")
include("{(ROOT / 'cmake/web_publish.cmake').as_posix()}")
add_executable(ra2 IMPORTED GLOBAL)
set_target_properties(ra2 PROPERTIES IMPORTED_LOCATION "${{CMAKE_CURRENT_BINARY_DIR}}/modules/ra2.js")
ra2_add_web_publication(ra2 "${{CMAKE_SOURCE_DIR}}/target.h"
  "${{CMAKE_SOURCE_DIR}}/game.exe" game.exe "${{CMAKE_SOURCE_DIR}}/Blowfish.dll"
  "$<TARGET_FILE_DIR:ra2>")
''')
            modes = {}
            for mode in ('prod', 'fast'):
                cache = root / mode
                subprocess.run(['cmake', '-S', str(source), '-B', str(cache), '-G', 'Ninja'],
                               check=True, capture_output=True, text=True)
                wasm = b'\0asm\x01\0\0\0' + mode.encode()
                modules = cache / 'modules'
                modules.mkdir()
                (modules / 'ra2.js').write_text('module ' + mode)
                (modules / 'ra2.data').write_bytes(mode.encode())
                (modules / 'ra2.wasm').write_bytes(wasm)
                (modules / 'ra2.ww.js').write_text('worker ' + mode)
                (modules / 'ra2.wasm.map').write_text('map ' + mode)
                modes[mode] = (cache, modules, wasm)
            builds = {}
            for mode in ('prod', 'fast', 'prod'):
                cache, modules, wasm = modes[mode]
                result = subprocess.run(['cmake', '--build', str(cache), '--target', 'ra2_publish'],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual((output / 'ra2.wasm').read_bytes(), wasm)
                self.assertEqual(gzip.decompress((output / 'ra2.wasm.gz').read_bytes()), wasm)
                self.assertEqual((output / 'ra2.wasm.br').read_bytes(), (modules / 'ra2.wasm.br').read_bytes())
                self.assertEqual((output / 'ra2.js').read_text(), 'module ' + mode)
                self.assertEqual((output / 'ra2.ww.js').read_text(), 'worker ' + mode)
                self.assertEqual((output / 'ra2.wasm.map').read_text(), 'map ' + mode)
                self.assertEqual((output / 'ra2.data').read_bytes(), mode.encode())
                manifest = json.loads((output / 'build.json').read_text())
                self.assertEqual(manifest['games']['ra2md']['build'], 'keep-yr')
                runtime = output / 'runtime/ra2'
                self.assertEqual((runtime / 'game.exe').read_bytes(), pe)
                self.assertEqual((runtime / 'Blowfish.dll').read_bytes(), b'fixture tables')
                self.assertEqual(json.loads((runtime / 'runtime.json').read_text())['build'],
                                 manifest['games']['ra2']['build'])
                if mode in builds:
                    self.assertEqual(manifest['games']['ra2']['build'], builds[mode])
                    self.assertNotIn('Wasm sidecars:', result.stdout, 'unchanged Wasm was recompressed')
                builds[mode] = manifest['games']['ra2']['build']
            self.assertNotEqual(builds['prod'], builds['fast'])


if __name__ == '__main__':
    unittest.main()
