#!/usr/bin/env python3
"""Print the header of Red Alert 2 / Yuri's Revenge saved games.

A .sav is an OLE compound file. Next to the large CONTENTS stream (the game
state itself) the game writes small named streams: the title the Load screen
shows, the player's house, the times and a version number that tells the two
games apart. This reads only those; see docs/savegame-format.md.

    python tools/save_info.py work/perf/user-saves/*.sav
    python tools/save_info.py --json SAVE0001.sav

Needs olefile (pip install olefile).
"""
import argparse
import datetime
import glob
import json
import struct
import sys

try:
    import olefile
except ImportError:  # pragma: no cover - reported to the user
    sys.exit('save_info.py needs olefile: pip install olefile')

# The game's own save-format number. A save from the other game is refused at load.
INTERNAL_VERSIONS = {0x000288CC: 'Red Alert 2 (game.exe)',
                     0x0002B898: "Yuri's Revenge (gamemd.exe)"}

TEXT = ('Scenario Description', 'Player House', 'Player Name', 'Player Name2', 'Executable Name')
INTS = ('Version', 'Internal Version', 'Scenario Number', 'Campaign', 'GameType')
TIMES = ('Start Time', 'Last Save Time', 'Play Time')


def filetime(raw):
    """A Windows FILETIME (100 ns ticks since 1601-01-01 UTC) as an ISO string."""
    ticks = struct.unpack('<Q', raw)[0]
    if not ticks:
        return None
    t = datetime.datetime(1601, 1, 1, tzinfo=datetime.timezone.utc)
    return (t + datetime.timedelta(microseconds=ticks // 10)).isoformat(timespec='seconds')


def read_save(path):
    with olefile.OleFileIO(path) as ole:
        streams = {'/'.join(entry): ole.get_size('/'.join(entry)) for entry in ole.listdir()}
        read = lambda name: ole.openstream(name).read() if name in streams else None
        info = {'file': path}
        for name in TEXT:
            raw = read(name)
            info[name] = None if raw is None else raw.decode('utf-16-le').split('\0', 1)[0]
        for name in INTS:
            raw = read(name)
            info[name] = None if raw is None or len(raw) < 4 else struct.unpack('<i', raw[:4])[0]
        for name in TIMES:
            raw = read(name)
            info[name] = None if raw is None or len(raw) < 8 else filetime(raw[:8])
        version = info['Internal Version']
        info['game'] = INTERNAL_VERSIONS.get(version & 0xFFFFFFFF if version is not None else None,
                                            'unknown')
        info['CONTENTS bytes'] = streams.get('CONTENTS')
        info['streams'] = sorted(streams)
        return info


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('saves', nargs='+', help='.sav files (globs are expanded)')
    parser.add_argument('--json', action='store_true', help='print one JSON object per save')
    args = parser.parse_args(argv)
    paths = [p for pattern in args.saves for p in (sorted(glob.glob(pattern)) or [pattern])]
    for path in paths:
        try:
            info = read_save(path)
        except OSError as error:
            print(f'{path}: not a readable save ({error})', file=sys.stderr)
            continue
        if args.json:
            print(json.dumps(info))
            continue
        version = info['Internal Version']
        print(f"{path}\n"
              f"  title     {info['Scenario Description']!r}\n"
              f"  game      {info['game']} (internal version 0x{(version or 0) & 0xFFFFFFFF:X})\n"
              f"  scenario  {info['Scenario Number']}  campaign {info['Campaign']}  "
              f"game type {info['GameType']}  house {info['Player House']!r}\n"
              f"  saved     {info['Last Save Time']}  (started {info['Start Time']})\n"
              f"  state     {info['CONTENTS bytes']} bytes in CONTENTS")


if __name__ == '__main__':
    main()
