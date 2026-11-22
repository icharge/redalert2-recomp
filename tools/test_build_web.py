"""Build selections must reuse edition/mode caches and publish the selected mode."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'tools' / 'build_web.py'


class BuildCommandTests(unittest.TestCase):
    def run_plan(self, *args):
        env = os.environ.copy()
        for name in ('RA2_TARGET', 'BUILD_DIR', 'CMAKE_ARGS'):
            env.pop(name, None)
        return subprocess.run(
            [sys.executable, '-B', str(SCRIPT), '--dry-run', *args],
            env=env, capture_output=True, text=True,
        )

    def test_each_mode_and_edition_selects_its_own_cache_and_publish_target(self):
        for mode, edition, folder, target, link in (
            ('prod', 'ra2', 'ra2', 'game', '-DWEB_LINK_OPT='),
            ('prod', 'ra2md', 'ra2md', 'gamemd', '-DWEB_LINK_OPT='),
            ('fast', 'ra2', 'ra2-fast', 'game', '-DWEB_LINK_OPT=-O1'),
            ('fast', 'ra2md', 'ra2md-fast', 'gamemd', '-DWEB_LINK_OPT=-O1'),
        ):
            with self.subTest(mode=mode, edition=edition):
                result = self.run_plan('--mode', mode, '--edition', edition)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn((ROOT / 'build' / folder).as_posix(), result.stdout)
                self.assertIn('-DRA2_TARGET=' + target, result.stdout)
                self.assertIn('-DRA2_TTF_TEXT=ON', result.stdout)
                self.assertIn('-DCMAKE_BUILD_TYPE=Release', result.stdout)
                self.assertIn(link, result.stdout)
                self.assertIn('-DWEB_OUT=' + (ROOT / 'web/public/game').as_posix(), result.stdout)
                self.assertIn('--target ' + edition + '_publish', result.stdout)

    def test_all_modes_builds_fast_first_and_production_last(self):
        result = self.run_plan('--mode', 'all', '--edition', 'both')
        self.assertEqual(result.returncode, 0, result.stderr)
        configurations = [line for line in result.stdout.splitlines() if '-DRA2_TARGET=' in line]
        self.assertEqual(len(configurations), 4)
        self.assertIn('/build/ra2-fast', configurations[0])
        self.assertIn('/build/ra2md-fast', configurations[1])
        self.assertIn('/build/ra2 ', configurations[2])
        self.assertIn('/build/ra2md ', configurations[3])

    def test_default_builds_both_production_editions(self):
        result = self.run_plan()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--target ra2_publish', result.stdout)
        self.assertIn('--target ra2md_publish', result.stdout)
        self.assertNotIn('-DWEB_LINK_OPT=-O1', result.stdout)

    def test_invalid_selection_is_rejected_without_starting_a_build(self):
        result = self.run_plan('--mode', 'turbo')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('cmake -S', result.stdout)

    def test_explicit_runtime_setting_wins_over_the_discovered_default(self):
        result = self.run_plan('--edition', 'ra2', '--cmake-arg=-DPCRECOMP=custom-runtime')
        self.assertEqual(result.returncode, 0, result.stderr)
        configure = next(line for line in result.stdout.splitlines() if '-DRA2_TARGET=' in line)
        settings = [arg for arg in shlex.split(configure) if arg.startswith('-DPCRECOMP=')]
        self.assertEqual(settings[-1], '-DPCRECOMP=' + (ROOT / 'custom-runtime').as_posix())

    def test_platform_launcher_works_from_another_directory_without_sdk_activation(self):
        with tempfile.TemporaryDirectory() as temp:
            launcher = ([os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/c', str(ROOT / 'build-web.cmd')]
                        if os.name == 'nt' else ['sh', str(ROOT / 'build-web.sh')])
            result = subprocess.run(launcher + ['--mode', 'fast', '--edition', 'ra2', '--dry-run'],
                                    cwd=temp, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn((ROOT / 'build/ra2-fast').as_posix(), result.stdout)

    @unittest.skipUnless(os.name == 'nt', 'Windows argument parsing')
    def test_windows_cmake_environment_preserves_spaces_and_backslashes(self):
        env = os.environ.copy()
        env['CMAKE_ARGS'] = r'-DRA2_GAME_DIR="C:\My Games\RA2"'
        env.pop('BUILD_DIR', None)
        result = subprocess.run([sys.executable, '-B', str(SCRIPT), '--dry-run', '--edition', 'ra2'],
                                env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        configure = next(line for line in result.stdout.splitlines() if '-DRA2_TARGET=' in line)
        self.assertIn(r'-DRA2_GAME_DIR=C:\My Games\RA2', shlex.split(configure))


class BuildOwnershipTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('build_web', SCRIPT)
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_busy_edition_prevents_another_mode_without_waiting(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.module.edition_lock(root, 'ra2', 'fast'):
                with self.assertRaisesRegex(RuntimeError, 'busy.*wait'):
                    with self.module.edition_lock(root, 'ra2', 'prod'):
                        self.fail('A second build acquired the busy edition')
            with self.module.edition_lock(root, 'ra2', 'prod'):
                pass

    def test_failure_stops_the_sequence_and_releases_edition_lock(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            def fail(command, **kwargs):
                raise subprocess.CalledProcessError(7, command)
            with patch.object(self.module.subprocess, 'run', side_effect=fail) as runner:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    code = self.module.main(['--mode', 'all'], root=root)
                self.assertEqual(code, 7)
                self.assertEqual(runner.call_count, 1)
            with self.module.edition_lock(root, 'ra2', 'prod'):
                pass

    def test_another_checkout_cache_is_rejected_before_configuration(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cache = root / 'build' / 'ra2'
            cache.mkdir(parents=True)
            (cache / 'CMakeCache.txt').write_text('CMAKE_HOME_DIRECTORY:INTERNAL=/another/checkout\n')
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = self.module.main(['--edition', 'ra2'], root=root)
            self.assertNotEqual(code, 0)

    def test_special_memory_configuration_is_not_silently_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cache = root / 'build/ra2-fast'
            cache.mkdir(parents=True)
            (cache / 'CMakeCache.txt').write_text('WEB_LINK_OPT:STRING=-O1;-sINITIAL_MEMORY=1GB\n')
            with self.assertRaisesRegex(RuntimeError, 'custom WEB_LINK_OPT'):
                self.module.check_cache(root, cache, 'ra2')

    def test_ninja_activity_marker_in_other_mode_requires_a_user_decision(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cache = root / 'build/ra2'
            cache.mkdir(parents=True)
            (cache / '.ninja_lock').touch()
            with patch.object(self.module.subprocess, 'run') as runner:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err:
                    code = self.module.main(['--mode', 'fast', '--edition', 'ra2'], root=root)
                self.assertNotEqual(code, 0)
                self.assertIn('running or interrupted', err.getvalue())
                runner.assert_not_called()

    def test_cached_runtime_is_reused_when_no_override_was_requested(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cache = root / 'build/ra2'
            cache.mkdir(parents=True)
            runtime = root / 'custom-runtime'
            (cache / 'CMakeCache.txt').write_text('PCRECOMP:PATH=' + runtime.as_posix() + '\n')
            env = os.environ.copy()
            env.pop('PCRECOMP', None)
            with patch.dict(os.environ, env, clear=True), patch.object(self.module.subprocess, 'run') as runner:
                with contextlib.redirect_stdout(io.StringIO()):
                    code = self.module.main(['--edition', 'ra2'], root=root)
                self.assertEqual(code, 0)
                self.assertIn('-DPCRECOMP=' + runtime.as_posix(), runner.call_args_list[0].args[0])


class WebHostSelectionTests(unittest.TestCase):
    def test_conformance_uses_last_published_mode_for_each_edition(self):
        from unittest.mock import patch
        spec = importlib.util.spec_from_file_location('conformance', ROOT / 'tools/conformance.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            published = root / 'web/public/game'
            published.mkdir(parents=True)
            (published / 'ra2.js').write_text('selected RA2 mode')
            (published / 'ra2md.js').write_text('selected YR mode')
            with patch.object(module, 'ROOT', str(root)):
                for game, filename in ((True, 'ra2.js'), (False, 'ra2md.js')):
                    with patch.object(module, 'GAME', game):
                        self.assertEqual(module._web_host(), str(published / filename))


if __name__ == '__main__':
    unittest.main()
