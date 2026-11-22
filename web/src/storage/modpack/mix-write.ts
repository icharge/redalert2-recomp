// Writes the new-format MIX a mod pack's files go into (docs/mod-packs.md §3).
// The layout is independent work from the format description; the reader in
// ../mix.ts is this repo's own MIT code. MIT.

import { mixHash } from "../mix";

export interface MixInput {
  name: string;
  bytes: Uint8Array;
}

export class MixWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MixWriteError";
  }
}

/** A MIX entry that already has its hash (a base archive being merged). */
export interface MixEntryInput {
  id: number;
  bytes: Uint8Array;
}

/**
 * Builds a plain (unencrypted) new-format MIX: a zero u32, the u16 file count,
 * the u32 body size, 12-byte (id, offset, size) entries sorted by id, then the
 * file bytes. Offsets are from the body's start.
 */
export function writeMix(files: MixInput[]): Uint8Array {
  const byId = new Map<number, Uint8Array>();
  for (const file of files) byId.set(mixHash(file.name), file.bytes);
  return writeMixEntries([...byId].map(([id, bytes]) => ({ id, bytes })));
}

export function writeMixEntries(entries: MixEntryInput[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.id - b.id);
  if (sorted.length > 0xffff) throw new MixWriteError("A MIX cannot hold that many files.");
  let bodySize = 0;
  for (const entry of sorted) bodySize += entry.bytes.length;
  if (bodySize > 0xffffffff) throw new MixWriteError("The MIX body is too large.");
  const out = new Uint8Array(10 + sorted.length * 12 + bodySize);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // old/new marker
  view.setUint16(2, 0, true); // flags: not encrypted, no checksum
  view.setUint16(4, sorted.length, true);
  view.setUint32(6, bodySize, true);
  const bodyStart = 10 + sorted.length * 12;
  let at = 0;
  for (let index = 0; index < sorted.length; index++) {
    const entry = sorted[index]!;
    const offset = 10 + index * 12;
    view.setUint32(offset, entry.id, true);
    view.setUint32(offset + 4, at, true);
    view.setUint32(offset + 8, entry.bytes.length, true);
    out.set(entry.bytes, bodyStart + at);
    at += entry.bytes.length;
  }
  return out;
}
