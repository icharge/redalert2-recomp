#!/usr/bin/env python3
"""The names ledger: what reverse engineering has established about a function.

The lift names a function by its address (sub_007CA650) unless the binary names
it (RTTI, a debug message; pcrecomp's name_lift.py). A ledger adds the names
people worked out, one file per edition, and the lift writes them into the
generated C (docs/reverse-engineering.md):

    names/gamemd.json    Yuri's Revenge (gamemd.exe)
    names/game.json      Red Alert 2 (game.exe)

    {"format": 1, "target": "gamemd", "names": [
      {"address": "0x007CA650", "name": "CRT__chkstk",
       "evidence": "push ecx; cmp eax, 0x1000; touches the stack a page at a time"}
    ]}

Every name carries its evidence: what in the bytes, the strings or the callers
says so. A name read off another project (tools/vera_lookup.py, YRpp) is a lead
until that is checked, and the evidence says what was checked.

A name becomes a C function in the build, so it is Module__Function (as the
lift's own names are: MapClass__Init_Clear). A bare name such as memcpy or
_ftol would collide with the C library's.

    py -3 tools/names_ledger.py            # check both ledgers

run_lift.py calls load() and merge() before the lift and hands the result to
name_lift; not_function_starts() then says which entries named nothing. A
ledger edit does not force a lift: a name changes no behaviour.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORMAT = 1
ADDRESS = re.compile(r'0x[0-9A-Fa-f]{8}\Z')
NAME = re.compile(r'[A-Z][A-Za-z0-9]*__[A-Za-z0-9][A-Za-z0-9_]*\Z')
FIELDS = {'address', 'name', 'evidence'}


class LedgerError(ValueError):
    pass


def path_for(target):
    """names/gamemd.json or names/game.json."""
    return os.path.join(ROOT, 'names', target + '.json')


def load(path, target):
    """{address: name} from a ledger; {} when the file does not exist."""
    path = str(path)
    if not os.path.exists(path):
        return {}

    def bad(what):
        return LedgerError('%s: %s' % (path, what))

    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except ValueError as e:
        raise bad('not JSON: %s' % e)
    if not isinstance(data, dict) or data.get('format') != FORMAT:
        raise bad('format is not %d' % FORMAT)
    if data.get('target') != target:
        raise bad('is the ledger of %r, not of %r' % (data.get('target'), target))
    if not isinstance(data.get('names'), list):
        raise bad('"names" is not a list')

    names, where = {}, {}
    for i, item in enumerate(data['names']):
        if not isinstance(item, dict):
            raise bad('entry %d is not an object' % i)
        extra = set(item) - FIELDS
        if extra:
            raise bad('entry %d has unknown field %s' % (i, ', '.join(sorted(extra))))
        address, name, evidence = item.get('address'), item.get('name'), item.get('evidence')
        if not isinstance(address, str) or not ADDRESS.match(address):
            raise bad('entry %d: address %r is not written as 0x and eight hex digits' % (i, address))
        if not isinstance(name, str) or not NAME.match(name):
            raise bad('%s: name %r is not Module__Function (it becomes a C function, and a bare '
                      'name could collide with a library symbol)' % (address, name))
        if not isinstance(evidence, str) or not evidence.strip():
            raise bad('%s (%s) has no evidence' % (address, name))
        va = int(address, 16)
        if va in names:
            raise bad('0x%08X is named twice: %s and %s' % (va, names[va], name))
        if name in where:
            raise bad('%s names two addresses: 0x%08X and 0x%08X' % (name, where[name], va))
        names[va], where[name] = name, va
    return names


def merge(hooks, names):
    """The names the lift is given: the host's hooks and the ledger's. A hooked
    function's body is the host's, and its name says so, so the ledger cannot
    rename it."""
    for va in sorted(set(hooks) & set(names)):
        raise LedgerError('0x%08X is hooked by the host (%s); the ledger cannot name it %s'
                          % (va, hooks[va], names[va]))
    return {**hooks, **names}


def not_function_starts(names, lifted):
    """Ledger entries whose address is not the start of a lifted function: a
    typo, an address inside a function, or a function this lift left out."""
    return sorted((va, name) for va, name in names.items() if va not in lifted)


def main():
    status = 0
    for target in ('gamemd', 'game'):
        path = path_for(target)
        try:
            print('%s: %d names' % (os.path.relpath(path, ROOT), len(load(path, target))))
        except LedgerError as e:
            print(e, file=sys.stderr)
            status = 1
    return status


if __name__ == '__main__':
    sys.exit(main())
