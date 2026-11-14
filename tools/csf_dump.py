#!/usr/bin/env python3
"""Dump a Red Alert 2 / Yuri's Revenge string table (CSF) to text, or search it.

The CSF is read from a loose file or from inside a MIX (an unencrypted one:
langmd.mix holds ra2md.csf; language.mix is encrypted, see docs/csf.md).

    csf_dump.py find "Westwood Online" E:/Games/Westwood/RA2/langmd.mix:ra2md.csf
    csf_dump.py dump E:/Games/Westwood/RA2/langmd.mix:ra2md.csf -o work/csf/ra2md.txt

The dump is one "LABEL<TAB>text" line per label (newlines in a text are
written as \\n). It is the game's own text: keep it under work/ (ignored), do
not commit it (docs/csf.md).
"""
import argparse
import struct
import sys
import zlib


def mix_hash(name):
    """MIX file-name hash: CRC-32 of the uppercased, Westwood-padded name."""
    data = name.upper().encode("ascii")
    residue = len(data) % 4
    if residue:
        fill = data[len(data) - residue]
        data += bytes([residue]) + bytes([fill]) * (3 - residue)
    return zlib.crc32(data) & 0xFFFFFFFF


def read_mix_entry(path, name):
    with open(path, "rb") as f:
        head = f.read(10)
        first = struct.unpack_from("<H", head, 0)[0]
        if first == 0:
            flags, count = struct.unpack_from("<HH", head, 2)
            if flags & 2:
                raise SystemExit(f"{path} is encrypted; use the web code's readMixEntry")
            body_at = 10 + count * 12
            f.seek(10)
        else:
            count = first
            body_at = 6 + count * 12
            f.seek(6)
        want = mix_hash(name)
        for _ in range(count):
            ident, off, size = struct.unpack("<III", f.read(12))
            if ident == want:
                f.seek(body_at + off)
                return f.read(size)
    raise SystemExit(f"{name} is not in {path}")


def load(spec):
    """`file.csf` or `archive.mix:name.csf`."""
    if ":" in spec[2:]:  # skip a drive letter
        path, name = spec.rsplit(":", 1)
        return read_mix_entry(path, name)
    with open(spec, "rb") as f:
        return f.read()


def parse(data):
    """Return [(label, [text, ...])]. Texts are stored bit-inverted UTF-16LE."""
    if data[:4] != b" FSC":
        raise SystemExit("not a CSF")
    labels = struct.unpack_from("<I", data, 8)[0]
    at = 24
    out = []
    for _ in range(labels):
        if data[at : at + 4] != b" LBL":
            raise SystemExit(f"bad label at {at}")
        pairs, length = struct.unpack_from("<II", data, at + 4)
        at += 12
        label = data[at : at + length].decode("latin1")
        at += length
        values = []
        for _ in range(pairs):
            tag = data[at : at + 4]
            count = struct.unpack_from("<I", data, at + 4)[0]
            at += 8
            raw = bytes(b ^ 0xFF for b in data[at : at + count * 2])
            at += count * 2
            values.append(raw.decode("utf-16le", "replace"))
            if tag == b"WRTS":
                at += 4 + struct.unpack_from("<I", data, at)[0]
        out.append((label, values))
    return out


def line(label, values):
    return f"{label}\t{values[0].replace(chr(13), '').replace(chr(10), chr(92) + 'n')}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("find", help="labels whose label or text contains a string")
    f.add_argument("needle")
    f.add_argument("csf", nargs="+")
    d = sub.add_parser("dump", help="write every label and text")
    d.add_argument("csf")
    d.add_argument("-o", "--out", required=True)
    args = ap.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    if args.cmd == "find":
        needle = args.needle.lower()
        for spec in args.csf:
            entries = parse(load(spec))
            print(f"== {spec} ({len(entries)} labels)")
            for label, values in entries:
                if needle in label.lower() or any(needle in v.lower() for v in values):
                    print(line(label, values))
    else:
        entries = parse(load(args.csf))
        with open(args.out, "w", encoding="utf-8", newline="\n") as out:
            for label, values in entries:
                out.write(line(label, values) + "\n")
        print(f"{len(entries)} labels -> {args.out}")


if __name__ == "__main__":
    main()
