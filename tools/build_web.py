#!/usr/bin/env python3
"""Build and publish reusable web/Wasm caches selected by edition and mode."""
import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {'ra2': 'game', 'ra2md': 'gamemd'}


def cmake_environment_args(text):
    if not text:
        return []
    if os.name != 'nt':
        return shlex.split(text)
    # Windows quoting must preserve backslashes in paths such as C:\\Games.
    import ctypes
    parse = ctypes.windll.shell32.CommandLineToArgvW
    parse.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_int)]
    parse.restype = ctypes.POINTER(ctypes.c_wchar_p)
    count = ctypes.c_int()
    argv = parse('cmake ' + text, ctypes.byref(count))
    if not argv:
        raise ctypes.WinError()
    try:
        return [argv[index] for index in range(1, count.value)]
    finally:
        free = ctypes.windll.kernel32.LocalFree
        free.argtypes = [ctypes.c_void_p]
        free.restype = ctypes.c_void_p
        free(argv)


@contextmanager
def edition_lock(root, edition, mode):
    """An OS-held lock covers both modes, which publish the same edition files."""
    folder = root / 'build'
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / ('.' + edition + '.build.lock')).open('a+b') as handle:
        if handle.tell() == 0:
            handle.write(b'\0')
            handle.flush()
        handle.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            handle.seek(1)
            owner = handle.read().decode('utf-8', errors='replace').strip()
            raise RuntimeError(
                f'{edition} is busy ({owner or "another build"}); ask whether to wait '
                'or use an approved separate build folder. No build was started.'
            ) from error
        try:
            handle.seek(1)
            handle.truncate()
            handle.write(f'PID {os.getpid()}, mode {mode}'.encode())
            handle.flush()
            yield
        finally:
            handle.seek(0)
            if os.name == 'nt':
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def cache_values(folder):
    cache = folder / 'CMakeCache.txt'
    if not cache.exists():
        return {}
    values = {}
    for line in cache.read_text(encoding='utf-8').splitlines():
        if '=' in line and ':' in line.split('=', 1)[0] and not line.startswith('//'):
            name, value = line.split('=', 1)
            values[name.split(':', 1)[0]] = value
    return values


def check_ninja_activity(root, folder, edition):
    candidates = {folder, root / 'build' / edition, root / 'build' / (edition + '-fast')}
    # Older/private caches can also publish this edition to the same page.
    legacy = list(root.glob('build-web*')) + list((root / 'build').glob('*'))
    for candidate in legacy:
        if not (candidate / '.ninja_lock').exists():
            continue
        values = cache_values(candidate)
        if values.get('RA2_TARGET') in (TARGETS[edition], 'both'):
            candidates.add(candidate)
    for candidate in sorted(candidates):
        if (candidate / '.ninja_lock').exists():
            raise RuntimeError(
                f'{candidate} has a Ninja activity marker: a build is running or interrupted. '
                'Inspect it and ask whether to wait or use an approved separate folder. '
                'The marker was not removed.')


def check_cache(root, folder, edition):
    values = cache_values(folder)
    source = values.get('CMAKE_HOME_DIRECTORY')
    if source and Path(source).resolve() != root:
        raise RuntimeError(f'{folder} belongs to another checkout: {source}. Do not move CMake caches.')
    target = values.get('RA2_TARGET')
    if target and target != TARGETS[edition]:
        raise RuntimeError(f'{folder} is configured for RA2_TARGET={target}, not {edition}.')
    toolchain = values.get('CMAKE_TOOLCHAIN_FILE')
    if toolchain:
        toolchain_path = Path(toolchain)
        if not toolchain_path.is_absolute():
            toolchain_path = root / toolchain_path
        if toolchain_path.resolve() != (root / 'cmake/emscripten.cmake').resolve():
            raise RuntimeError(f'{folder} uses another toolchain: {toolchain}.')
    elif values.get('CMAKE_C_COMPILER'):
        raise RuntimeError(f'{folder} is not an Emscripten cache.')
    if values.get('CMAKE_GENERATOR', 'Ninja') != 'Ninja':
        raise RuntimeError(f'{folder} is not a Ninja cache.')
    if values.get('WEB_LINK_OPT', '') not in ('', '-O1'):
        raise RuntimeError(
            f'{folder} has custom WEB_LINK_OPT settings. Preserve its memory/profiling '
            'configuration and ask before replacing it with a standard mode.')


def main(argv=None, *, root=ROOT):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('prod', 'fast', 'all'), default='prod',
                        help='all builds fast first, then production (default: prod)')
    default_edition = {'game': 'ra2', 'gamemd': 'ra2md', 'both': 'both'}.get(
        os.environ.get('RA2_TARGET', 'both'), os.environ.get('RA2_TARGET'))
    parser.add_argument('--edition', choices=('ra2', 'ra2md', 'both'), default=default_edition,
                        help='edition to build (default: both, or RA2_TARGET)')
    parser.add_argument('--jobs', '-j', type=int, help='parallel compiler jobs')
    parser.add_argument('--verbose', action='store_true')
    parser.add_argument('--dry-run', action='store_true', help='print commands without creating outputs')
    parser.add_argument('--cmake-arg', action='append', default=[], metavar='ARG',
                        help='additional configure argument; use --cmake-arg=-DNAME=VALUE')
    parser.add_argument('--build-dir', default=os.environ.get('BUILD_DIR'), metavar='PATH',
                        help='approved exception/legacy cache (one edition and mode only)')
    args = parser.parse_args(argv)
    if args.edition not in ('ra2', 'ra2md', 'both'):
        parser.error('RA2_TARGET must be game, gamemd or both; or specify --edition')
    if args.jobs is not None and args.jobs < 1:
        parser.error('--jobs must be positive')
    if args.build_dir and (args.edition == 'both' or args.mode == 'all'):
        parser.error('--build-dir/BUILD_DIR requires one edition and one mode')
    root = Path(root).resolve()
    modes = ('fast', 'prod') if args.mode == 'all' else (args.mode,)
    editions = ('ra2', 'ra2md') if args.edition == 'both' else (args.edition,)
    try:
        extra = cmake_environment_args(os.environ.get('CMAKE_ARGS', '')) + args.cmake_arg
        if any(not item.startswith('-D') for item in extra):
            raise ValueError('CMAKE_ARGS and --cmake-arg accept -D cache settings only')
        requested_runtime = os.environ.get('PCRECOMP')
        for setting in extra:
            name, separator, value = setting[2:].partition('=')
            if separator and name.split(':', 1)[0] == 'PCRECOMP':
                requested_runtime = value
        default_runtime = root.parent / 'pcrecomp'
        if not default_runtime.exists() and (root.parent / 'tools/runtime/win32hle').is_dir():
            default_runtime = root.parent / 'tools'
        for mode in modes:
            for edition in editions:
                name = edition + ('-fast' if mode == 'fast' else '')
                folder = (root / (args.build_dir or ('build/' + name))).resolve()
                runtime = requested_runtime or cache_values(folder).get('PCRECOMP') or default_runtime
                runtime = (root / runtime).resolve()
                commands = [
                    ['cmake', '-S', root.as_posix(), '-B', folder.as_posix(), '-G', 'Ninja',
                     *extra,
                     '-DCMAKE_TOOLCHAIN_FILE=' + (root / 'cmake/emscripten.cmake').as_posix(),
                     '-DPCRECOMP=' + runtime.as_posix(),
                     '-DRA2_TARGET=' + TARGETS[edition], '-DCMAKE_BUILD_TYPE=Release',
                     # the TrueType engine for Thai text (docs/ttf-text.md); needs Rust, see there
                     '-DRA2_TTF_TEXT=ON',
                     '-DWEB_LINK_OPT=' + ('-O1' if mode == 'fast' else ''),
                     '-DWEB_OUT=' + (root / 'web/public/game').as_posix()],
                    ['cmake', '--build', folder.as_posix(), '--target', edition + '_publish'],
                ]
                if args.jobs:
                    commands[1] += ['--parallel', str(args.jobs)]
                if args.verbose:
                    commands[1].append('--verbose')
                print(f'\n{edition} {mode}: {folder.as_posix()}', flush=True)
                if args.dry_run:
                    for command in commands:
                        print(shlex.join(command))
                    continue
                with edition_lock(root, edition, mode):
                    check_ninja_activity(root, folder, edition)
                    check_cache(root, folder, edition)
                    for command in commands:
                        print(shlex.join(command), flush=True)
                        subprocess.run(command, cwd=root, check=True)
                print(f'Published {edition} {mode} to web/public/game/', flush=True)
    except subprocess.CalledProcessError as error:
        return error.returncode
    except (OSError, ValueError, RuntimeError) as error:
        print(f'build-web: {error}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == '__main__':
    sys.exit(main())
