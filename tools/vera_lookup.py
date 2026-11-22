#!/usr/bin/env python3
"""What a VERA20K checkout says about a gamemd.exe address.

VERA20K (a Rust rewrite of Yuri's Revenge) cites the native address beside
every behaviour it ports, about 19,000 of them, and keeps its Ghidra naming
passes as JSON ledgers. It addresses the same Yuri's Revenge 1.001 code this
project lifts, so its checkout answers "what is sub_006FDD50" in a second:

    py -3 tools/vera_lookup.py 0x6FDD50
    py -3 tools/vera_lookup.py sub_0053B460 0x7CA650 --max 5

It reads the checkout in place (--vera, or VERA20K, or ../vera20k) and keeps
an index of where each address is cited in work/vera_index.json, rebuilt when
the checkout's commit changes. Nothing of VERA20K's is copied into this repo:
it is GPLv3, this project is MIT.

What it prints are leads. VERA20K's own rule is that a name or a comment is
not proof, and its docs list names that were wrong: read the bytes before a
patch relies on one. It knows gamemd.exe only; a game.exe (Red Alert 2)
address means nothing to it.

Exit 0 when something was found, 1 when nothing was, 2 when there is no
checkout to read.
"""
import argparse
import bisect
import collections
import dataclasses
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'work', 'vera_index.json')
CACHE_VERSION = 1

# gamemd.exe is mapped at 0x00400000 and ends below 0x00C04000 (docs/RECON.md),
# so an address is six hex digits starting 4..B, with or without leading zeros.
_VA = r'0x0{0,2}([4-9A-Ba-b][0-9A-Fa-f]{5})'
ADDRESS = re.compile(r'\b%s\b' % _VA)
RANGE = re.compile(r'\b%s\.\.=?%s\b' % (_VA, _VA))
RANGE_MAX = 0x10000          # a wider "range" is two unrelated numbers
QUALIFIED = r'[A-Za-z_]\w*(?:<[^>\s]*>)?(?:(?:::|__)~?\w+)+'
SCAN = (('src', '.rs'), ('docs', '.md'), ('tools', '.md'))
SKIP_DIRS = {'target', 'node_modules', '__pycache__', '.git'}
PASSES = ('tools', 'ghidra_pass', 'passes')


@dataclasses.dataclass
class Index:
    exact: dict      # address -> [(path, line)]
    ranges: list     # [(lo, hi, path, line)]


@dataclasses.dataclass
class Cite:
    path: str
    line: int
    text: str


@dataclasses.dataclass
class Range:
    lo: int
    hi: int
    path: str
    line: int
    text: str


@dataclasses.dataclass
class LedgerOp:
    kind: str
    name: str        # a rename's new name; None for a plate
    old: str
    text: str
    file: str


@dataclasses.dataclass
class Hits:
    address: int
    cites: list
    ranges: list
    ledger: list
    names: list      # [(name, times written beside this address)]
    nearest: tuple   # (cited address below, above) when the address itself is not cited

    def found(self):
        return bool(self.cites or self.ranges or self.ledger)


def _sources(root):
    for top, ext in SCAN:
        for folder, dirs, files in os.walk(os.path.join(root, top)):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
            for name in sorted(files):
                if name.endswith(ext):
                    full = os.path.join(folder, name)
                    yield full, os.path.relpath(full, root).replace(os.sep, '/')


def build_index(root):
    exact, ranges = collections.defaultdict(list), []
    for full, rel in _sources(str(root)):
        with open(full, encoding='utf-8', errors='replace') as f:
            for number, line in enumerate(f, 1):
                if '0x' not in line:
                    continue
                for digits in dict.fromkeys(d.upper() for d in ADDRESS.findall(line)):
                    exact[int(digits, 16)].append((rel, number))
                for lo, hi in RANGE.findall(line):
                    lo, hi = int(lo, 16), int(hi, 16)
                    if lo < hi <= lo + RANGE_MAX:
                        ranges.append((lo, hi, rel, number))
    return Index(dict(exact), ranges)


def _save(index, cache, stamp):
    files = sorted({path for cites in index.exact.values() for path, _ in cites}
                   | {path for _, _, path, _ in index.ranges})
    number = {path: i for i, path in enumerate(files)}
    data = {'version': CACHE_VERSION, 'stamp': stamp, 'files': files,
            'exact': {'%X' % va: [[number[p], n] for p, n in cites] for va, cites in index.exact.items()},
            'ranges': [[lo, hi, number[p], n] for lo, hi, p, n in index.ranges]}
    os.makedirs(os.path.dirname(str(cache)), exist_ok=True)
    tmp = '%s.%d.tmp' % (cache, os.getpid())
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))
    os.replace(tmp, str(cache))


def _load(cache, stamp):
    try:
        with open(str(cache), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    if data.get('version') != CACHE_VERSION or data.get('stamp') != stamp:
        return None
    files = data['files']
    return Index({int(va, 16): [(files[i], n) for i, n in cites] for va, cites in data['exact'].items()},
                 [(lo, hi, files[i], n) for lo, hi, i, n in data['ranges']])


def load_index(root, cache, stamp):
    """The index for the checkout at `stamp` (its commit). A checkout whose
    commit is unknown is read afresh every time and never cached."""
    if stamp is None:
        return build_index(root)
    index = _load(cache, stamp)
    if index is None:
        index = build_index(root)
        _save(index, cache, stamp)
    return index


def checkout_stamp(root):
    try:
        out = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'],
                             capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 and out.stdout.strip() else None


def _ledger(root, address):
    folder = os.path.join(str(root), *PASSES)
    ops = []
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not name.endswith('.json'):
            continue
        try:
            with open(os.path.join(folder, name), encoding='utf-8') as f:
                entries = json.load(f).get('ops', [])
        except (OSError, ValueError):
            continue
        for op in entries:
            try:
                if int(op.get('address', ''), 16) != address:
                    continue
            except (TypeError, ValueError):
                continue
            ops.append(LedgerOp(op.get('op', '?'), op.get('to'), op.get('from'), op.get('text', ''), name))
    return ops


def lookup(index, root, address):
    texts = {}

    def text(path, line):
        if path not in texts:
            try:
                with open(os.path.join(str(root), path), encoding='utf-8', errors='replace') as f:
                    texts[path] = f.read().split('\n')
            except OSError:
                texts[path] = []
        lines = texts[path]
        return lines[line - 1].strip() if 0 < line <= len(lines) else ''

    cites = [Cite(path, line, text(path, line)) for path, line in index.exact.get(address, [])]
    cited = {(c.path, c.line) for c in cites}
    ranges = [Range(lo, hi, path, line, text(path, line)) for lo, hi, path, line in index.ranges
              if lo <= address <= hi and (path, line) not in cited]

    beside = re.compile(r'(%s)[\s`(@:]*0x0{0,2}%06X\b' % (QUALIFIED, address), re.I)
    count = collections.Counter(name for c in cites for name in beside.findall(c.text))
    names = sorted(count.items(), key=lambda item: (-item[1], item[0]))

    nearest = None
    if not cites and index.exact:
        known = sorted(index.exact)
        at = bisect.bisect_left(known, address)
        nearest = (known[at - 1] if at else None, known[at] if at < len(known) else None)
    return Hits(address, cites, ranges, _ledger(root, address), names, nearest)


def parse_address(text):
    """0x6FDD50, 006FDD50, or a lift or Ghidra name: sub_006FDD50, FUN_006fdd50."""
    digits = re.sub(r'^(sub_|FUN_|0x)', '', text.strip(), flags=re.I)
    return int(digits, 16)


def report(hits, limit):
    lines = ['0x%08X' % hits.address]
    if hits.names:
        lines.append('  names beside it: ' + ', '.join('%s (%d)' % item for item in hits.names[:6]))
    for op in hits.ledger:
        if op.kind == 'rename_function':
            lines.append('  ledger %s: named %s (was %s)' % (op.file, op.name, op.old))
        else:
            lines.append('  ledger %s: %s' % (op.file, op.text))
    for cite in hits.cites[:limit]:
        lines.append('  %s:%d  %s' % (cite.path, cite.line, cite.text))
    if len(hits.cites) > limit:
        files = len({c.path for c in hits.cites[limit:]})
        lines.append('  ... and %d more in %d file%s (--max)' % (len(hits.cites) - limit, files, '' if files == 1 else 's'))
    for r in hits.ranges[:limit]:
        lines.append('  inside 0x%08X..0x%08X  %s:%d  %s' % (r.lo, r.hi, r.path, r.line, r.text))
    if not hits.cites:
        below, above = hits.nearest or (None, None)
        near = ['0x%08X (%d bytes %s)' % (va, abs(hits.address - va), side)
                for va, side in ((below, 'below'), (above, 'above')) if va is not None]
        lines.append('  not cited' + ('; nearest cited: ' + ', '.join(near) if near else ''))
    return '\n'.join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('address', nargs='+', help='a gamemd.exe address: 0x6FDD50, 006FDD50 or sub_006FDD50')
    ap.add_argument('--vera', default=os.environ.get('VERA20K') or os.path.join(ROOT, '..', 'vera20k'),
                    help='the VERA20K checkout (default: VERA20K, then ../vera20k)')
    ap.add_argument('--max', type=int, default=12, help='cites to print for each address (default 12)')
    ap.add_argument('--no-cache', action='store_true',
                    help='read the checkout afresh, e.g. when it has uncommitted changes')
    args = ap.parse_args(argv)

    root = os.path.abspath(args.vera)
    if not os.path.isdir(os.path.join(root, 'src')):
        print('no VERA20K checkout at %s (pass --vera or set VERA20K)' % root, file=sys.stderr)
        return 2
    try:
        addresses = [parse_address(a) for a in args.address]
    except ValueError as e:
        print('not an address: %s' % e, file=sys.stderr)
        return 2

    index = load_index(root, CACHE, None if args.no_cache else checkout_stamp(root))
    found = False
    for address in addresses:
        hits = lookup(index, root, address)
        found = found or hits.found()
        print(report(hits, args.max))
    return 0 if found else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
