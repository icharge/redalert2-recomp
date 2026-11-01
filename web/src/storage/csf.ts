// Red Alert 2 / Yuri's Revenge string tables (CSF).
//
// A CSF is a header and a sequence of label entries:
//
//   " FSC", version, label count, string count, reserved, language
//   " LBL", pair count, label length, label
//     "STR " or "WRTS", character count, inverted UTF-16LE code units
//     (a WRTS value also carries an extra length and raw extra bytes)
//
// The code units are byte values: with windows-1252 the low byte is the
// character code, and the Thai tables use windows-874 bytes. The game's text
// renderer and the Thai font fix both expect those byte values, not Unicode
// code points, so values are converted through an explicit code page.
//
// Rewriting keeps each untouched entry's original bytes. That matters for
// WRTS entries, whose extra data is a sound name or another opaque payload,
// and it makes a no-change rewrite byte-for-byte identical to the input.

export type CsfEncoding = "windows-1252" | "windows-874";

export interface CsfValue {
  /** the visible text */
  value: string;
  /** WRTS extra bytes, or null for a plain STR value */
  extra: Uint8Array | null;
}

export interface CsfEntry {
  /** the label as stored, usually uppercase */
  label: string;
  /** one or more values; the first is the visible text */
  values: CsfValue[];
  /** the entry's original bytes, from LBL through the last value */
  raw: Uint8Array;
}

export interface CsfFile {
  version: number;
  /** the language id from the header, or 0 for version 1 files */
  language: number;
  entries: CsfEntry[];
  /** bytes after the last entry, kept so a rewrite does not drop them */
  trailing: Uint8Array;
  /** the parsed file, so an empty rewrite can return it byte for byte */
  raw: Uint8Array;
}

export interface CsfChanges {
  strings: Record<string, string>;
  /** append labels that are not already in the table */
  inject?: boolean;
  encoding?: CsfEncoding;
  /** optional replacement WRTS extra bytes, by label */
  extra?: Record<string, Uint8Array>;
}

export interface CsfRewriteResult {
  data: Uint8Array;
  /** labels the caller asked to change but the table does not have */
  missing: string[];
  /** labels added to the table */
  injected: string[];
}

const HEADER_MAGIC = 0x43534620; // " FSC"
const LABEL_MAGIC = 0x4c424c20; // " LBL"
const STRING_MAGIC = 0x53545220; // "STR "
const STRING_EXTRA_MAGIC = 0x53545257; // "WRTS"
const HEADER_SIZE = 24;
const MAX_LABEL_LENGTH = 255;
const MAX_FILE_SIZE = 4 * 1024 * 1024;

const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

const CP1252_BY_CHAR = new Map<number, number>(
  Object.entries(CP1252_HIGH).map(([byte, char]) => [char, Number(byte)]),
);

function cp1252Decode(byte: number): string {
  if (byte < 0x80 || (byte >= 0xa0 && byte <= 0xff)) return String.fromCodePoint(byte);
  const char = CP1252_HIGH[byte];
  return char === undefined ? "\ufffd" : String.fromCodePoint(char);
}

function cp1252Encode(codePoint: number): number {
  if (codePoint < 0x80 || (codePoint >= 0xa0 && codePoint <= 0xff)) return codePoint;
  const byte = CP1252_BY_CHAR.get(codePoint);
  if (byte === undefined)
    throw new Error(
      `windows-1252 cannot represent U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}.`,
    );
  return byte;
}

function cp874Decode(byte: number): string {
  if (byte < 0x80 || byte === 0xa0) return String.fromCodePoint(byte);
  if (byte >= 0xa1 && byte <= 0xda) return String.fromCodePoint(0x0e00 + (byte - 0xa0));
  if (byte >= 0xdf && byte <= 0xfb) return String.fromCodePoint(0x0e00 + 0x3f + (byte - 0xdf));
  return "\ufffd";
}

function cp874Encode(codePoint: number): number {
  if (codePoint < 0x80 || codePoint === 0xa0) return codePoint;
  if (codePoint >= 0x0e01 && codePoint <= 0x0e3a) return 0xa0 + (codePoint - 0x0e00);
  if (codePoint >= 0x0e3f && codePoint <= 0x0e5b) return 0xdf + (codePoint - 0x0e3f);
  throw new Error(
    `windows-874 cannot represent U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}.`,
  );
}

function decodeBytes(units: number[], encoding: CsfEncoding): string {
  let text = "";
  for (const unit of units) {
    if (unit > 0xff) {
      text += String.fromCodePoint(unit);
      continue;
    }
    text += encoding === "windows-874" ? cp874Decode(unit) : cp1252Decode(unit);
  }
  return text;
}

function encodeText(text: string, encoding: CsfEncoding): number[] {
  const out: number[] = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    try {
      out.push(encoding === "windows-874" ? cp874Encode(codePoint) : cp1252Encode(codePoint));
    } catch (error) {
      throw new Error(`${(error as Error).message} The ${encoding} table cannot store this value.`);
    }
  }
  return out;
}

function readU32(view: DataView, offset: number, end: number): number {
  if (offset + 4 > end) throw new Error("The CSF file ends in the middle of a value.");
  return view.getUint32(offset, true);
}

function bytesOf(data: Uint8Array, start: number, end: number): Uint8Array {
  return data.subarray(start, end);
}

/** Parse a CSF file. Throws a user-readable error for a malformed table. */
export function parseCsf(data: Uint8Array, encoding: CsfEncoding = "windows-1252"): CsfFile {
  if (data.length < HEADER_SIZE) throw new Error("The CSF file is too short.");
  if (data.length > MAX_FILE_SIZE) throw new Error("The CSF file is larger than 4 MiB.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (readU32(view, 0, data.length) !== HEADER_MAGIC)
    throw new Error("This is not a CSF string table.");
  const version = readU32(view, 4, data.length);
  const labelCount = readU32(view, 8, data.length);
  const stringCount = readU32(view, 12, data.length);
  const language = version >= 2 ? readU32(view, 20, data.length) : 0;
  if (labelCount > 1_000_000 || stringCount > 4_000_000)
    throw new Error("The CSF header has an impossible entry count.");

  const entries: CsfEntry[] = [];
  const decoder = new TextDecoder("windows-1252");
  let at = HEADER_SIZE;
  for (let index = 0; index < labelCount; index++) {
    const start = at;
    if (readU32(view, at, data.length) !== LABEL_MAGIC)
      throw new Error(`The CSF label at entry ${index + 1} is malformed.`);
    at += 4;
    const pairCount = readU32(view, at, data.length);
    at += 4;
    const labelLength = readU32(view, at, data.length);
    at += 4;
    if (labelLength > MAX_LABEL_LENGTH)
      throw new Error(`A CSF label is longer than ${MAX_LABEL_LENGTH} bytes.`);
    if (at + labelLength > data.length) throw new Error("The CSF label is truncated.");
    const label = decoder.decode(bytesOf(data, at, at + labelLength));
    at += labelLength;
    if (pairCount > 1024) throw new Error("A CSF label has an impossible value count.");
    const values: CsfValue[] = [];
    for (let pair = 0; pair < pairCount; pair++) {
      const magic = readU32(view, at, data.length);
      at += 4;
      if (magic !== STRING_MAGIC && magic !== STRING_EXTRA_MAGIC)
        throw new Error(`The CSF value for ${label || "(unnamed)"} is malformed.`);
      const characterCount = readU32(view, at, data.length);
      at += 4;
      const byteCount = characterCount * 2;
      if (at + byteCount > data.length) throw new Error("A CSF value is truncated.");
      const units: number[] = [];
      for (let unit = 0; unit < characterCount; unit++) {
        units.push(~view.getUint16(at + unit * 2, true) & 0xffff);
      }
      at += byteCount;
      let extra: Uint8Array | null = null;
      if (magic === STRING_EXTRA_MAGIC) {
        const extraLength = readU32(view, at, data.length);
        at += 4;
        if (at + extraLength > data.length) throw new Error("A WRTS extra value is truncated.");
        extra = bytesOf(data, at, at + extraLength);
        at += extraLength;
      }
      values.push({ value: decodeValue(units, encoding), extra });
    }
    entries.push({ label, values, raw: bytesOf(data, start, at) });
  }
  return {
    version,
    language,
    entries,
    trailing: bytesOf(data, at, data.length),
    raw: data,
  };
}

/** Decode the code units of a CSF value through the selected code page. */
function decodeValue(units: number[], encoding: CsfEncoding): string {
  return decodeBytes(units, encoding);
}

function writeValue(value: string, extra: Uint8Array | null, encoding: CsfEncoding): Uint8Array {
  const units = encodeText(value, encoding);
  const size = 4 + 4 + units.length * 2 + (extra ? 4 + extra.length : 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, extra ? STRING_EXTRA_MAGIC : STRING_MAGIC, true);
  view.setUint32(4, units.length, true);
  let at = 8;
  for (const unit of units) {
    view.setUint16(at, ~unit & 0xffff, true);
    at += 2;
  }
  if (extra) {
    view.setUint32(at, extra.length, true);
    at += 4;
    out.set(extra, at);
  }
  return out;
}

function writeLabel(label: string, values: CsfValue[], encoding: CsfEncoding): Uint8Array {
  if (!/^[\x20-\x7e]+$/.test(label))
    throw new Error(`The label ${label} must use printable ASCII characters only.`);
  const labelBytes = new TextEncoder().encode(label);
  if (labelBytes.length > MAX_LABEL_LENGTH)
    throw new Error(`The label ${label} is longer than ${MAX_LABEL_LENGTH} bytes.`);
  const valueBytes = values.map((value) => writeValue(value.value, value.extra, encoding));
  const size =
    4 + 4 + 4 + labelBytes.length + valueBytes.reduce((sum, value) => sum + value.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, LABEL_MAGIC, true);
  view.setUint32(4, values.length, true);
  view.setUint32(8, labelBytes.length, true);
  out.set(labelBytes, 12);
  let at = 12 + labelBytes.length;
  for (const value of valueBytes) {
    out.set(value, at);
    at += value.length;
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Apply text overrides to a parsed table. Untouched entries are copied as their
 * original bytes; changed entries are re-encoded in the requested code page.
 */
export function rewriteCsf(base: CsfFile, changes: CsfChanges): CsfRewriteResult {
  const encoding = changes.encoding ?? "windows-1252";
  const wanted = new Map<string, string>();
  for (const [label, value] of Object.entries(changes.strings)) {
    wanted.set(label.toUpperCase(), value);
  }
  const replacements = new Map<string, Uint8Array>();
  for (const [label, extra] of Object.entries(changes.extra ?? {})) {
    replacements.set(label.toUpperCase(), extra);
  }
  if (wanted.size === 0 && !changes.inject) {
    return { data: base.raw, missing: [], injected: [] };
  }

  const present = new Set(base.entries.map((entry) => entry.label.toUpperCase()));
  const missing = changes.inject ? [] : [...wanted.keys()].filter((label) => !present.has(label));
  const injected: string[] = [];
  const parts: Uint8Array[] = [];
  let labelCount = 0;
  let stringCount = 0;

  for (const entry of base.entries) {
    labelCount++;
    stringCount += entry.values.length;
    const label = entry.label.toUpperCase();
    const value = wanted.get(label);
    if (value === undefined) {
      parts.push(entry.raw);
      continue;
    }
    const values = entry.values.map((current, index) => {
      if (index !== 0) return current;
      const extra = replacements.get(label) ?? current.extra;
      return { value, extra };
    });
    if (values.length === 0) values.push({ value, extra: replacements.get(label) ?? null });
    stringCount += values.length - entry.values.length;
    parts.push(writeLabel(entry.label, values, encoding));
  }

  if (changes.inject) {
    for (const [label, value] of wanted) {
      if (present.has(label)) continue;
      labelCount++;
      stringCount++;
      parts.push(writeLabel(label, [{ value, extra: null }], encoding));
      injected.push(label);
    }
  }

  const header = new Uint8Array(HEADER_SIZE);
  const view = new DataView(header.buffer);
  view.setUint32(0, HEADER_MAGIC, true);
  view.setUint32(4, base.version, true);
  view.setUint32(8, labelCount, true);
  view.setUint32(12, stringCount, true);
  view.setUint32(16, 0, true);
  view.setUint32(20, base.language, true);
  parts.unshift(header);
  parts.push(base.trailing);
  return { data: concat(parts), missing, injected };
}
