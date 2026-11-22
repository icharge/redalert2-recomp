// The install data a diff pack is merged against (docs/mod-packs.md §5): the
// base INI from localmd.mix, the string table from langmd.mix, and the stock
// side archives. Everything is read by range, so a 204 MB ra2md.mix is never
// loaded whole. Independent implementation; MIT.

import { Blowfish, extractBlowfishKey, mixHash, readMixEntry, type MixEntry } from "../mix";
import type { BaseData } from "./build";
import type { ModGame } from "./model";

const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const RSA_BLOCK = 80;

export interface RangeSource {
  size: number;
  read(start: number, length: number): Promise<Uint8Array>;
}

export interface MixIndexRange {
  kind: "old" | "new";
  flags: number;
  entries: MixEntry[];
  bodyOffset: number;
}

export interface RangeOptions {
  /** Override the RSA modulus in tests; production uses the MIX public key. */
  rsaModulus?: bigint;
}

/** A range source over bytes already in memory (tests, and nested archives). */
export function bufferSource(data: Uint8Array): RangeSource {
  return {
    size: data.length,
    read: async (start, length) => data.subarray(start, start + length),
  };
}

/** Reads a MIX header and index without loading the body. */
export async function readMixIndexRange(
  source: RangeSource,
  options: RangeOptions = {},
): Promise<MixIndexRange> {
  if (source.size < 4) throw new Error("The MIX file is too short.");
  const head = await source.read(0, 10);
  const first = u16(head, 0);
  if (first !== 0) {
    if (first * 12 > MAX_INDEX_BYTES) throw new Error("The MIX index is too large.");
    const index = await source.read(0, 6 + first * 12);
    return {
      kind: "old",
      flags: 0,
      entries: entriesAt(index, 6, first),
      bodyOffset: 6 + first * 12,
    };
  }
  const flags = u16(head, 2);
  if (flags & 0x0002) {
    const start = 4 + RSA_BLOCK;
    const block = await source.read(4, RSA_BLOCK);
    const key = extractBlowfishKey(block, options.rsaModulus);
    const cipher = new Blowfish(key);
    const firstBlock = cipher.decrypt(await source.read(start, 8));
    const count = u16(firstBlock, 0);
    if (count * 12 > MAX_INDEX_BYTES) throw new Error("The MIX index is too large.");
    const encryptedSize = Math.ceil((6 + count * 12) / 8) * 8;
    const decrypted = cipher.decrypt(await source.read(start, encryptedSize));
    return {
      kind: "new",
      flags,
      entries: entriesAt(decrypted, 6, count),
      bodyOffset: start + encryptedSize,
    };
  }
  const count = u16(head, 4);
  if (count * 12 > MAX_INDEX_BYTES) throw new Error("The MIX index is too large.");
  const index = await source.read(0, 10 + count * 12);
  return { kind: "new", flags, entries: entriesAt(index, 10, count), bodyOffset: 10 + count * 12 };
}

/** One entry by name, read from its offset only. */
export async function readMixEntryRange(
  source: RangeSource,
  index: MixIndexRange,
  name: string,
): Promise<Uint8Array | null> {
  const id = mixHash(name);
  const entry = index.entries.find((candidate) => candidate.id === id);
  if (!entry) return null;
  const start = index.bodyOffset + entry.offset;
  if (start + entry.size > source.size) throw new Error(`The MIX entry ${name} is truncated.`);
  return source.read(start, entry.size);
}

/** A source of the files in the game's folder, by name, without regard to case. */
export interface InstallFiles {
  find(name: string): Promise<RangeSource | null>;
}

export function createBaseData(game: ModGame, files: InstallFiles): BaseData {
  const yuri = game === "ra2md";
  const mainName = yuri ? "ra2md.mix" : "ra2.mix";
  const localName = yuri ? "localmd.mix" : "local.mix";
  const languageName = yuri ? "langmd.mix" : "language.mix";
  const csfName = yuri ? "ra2md.csf" : "ra2.csf";
  const local = new Lazy<Uint8Array | null>(async () => {
    const source = await files.find(mainName);
    if (!source) return null;
    const index = await readMixIndexRange(source);
    return readMixEntryRange(source, index, localName);
  });
  const language = new Lazy<RangeSource | null>(() => files.find(languageName));

  return {
    async ini(name) {
      const loose = await files.find(name);
      if (loose) return whole(loose);
      const mix = await local.get();
      if (!mix) return null;
      try {
        return readMixEntry(mix, name);
      } catch {
        return null;
      }
    },
    async csf() {
      const loose = await files.find(csfName);
      if (loose) return whole(loose);
      const source = await language.get();
      if (!source) return null;
      try {
        return await readMixEntryRange(source, await readMixIndexRange(source), csfName);
      } catch {
        return null;
      }
    },
    async sideMix(side) {
      const name = yuri && side === 3 ? "sidec02md.mix" : `sidec0${side}.mix`;
      const from = yuri && side === 3 ? mainName : "ra2.mix";
      const source = from === mainName ? await files.find(mainName) : await files.find(from);
      if (!source) return null;
      try {
        return await readMixEntryRange(source, await readMixIndexRange(source), name);
      } catch {
        return null;
      }
    },
  };
}

/** The real game folder of an import, as `InstallFiles`. */
export function opfsInstallFiles(
  home: string,
  root?: Promise<FileSystemDirectoryHandle>,
): InstallFiles {
  return {
    async find(name) {
      const base = root ?? navigator.storage.getDirectory();
      const dir = await openFolder(base, `game/${home}`);
      if (!dir) return null;
      const wanted = name.toLowerCase();
      const entries = (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
      for await (const entry of entries) {
        if (entry.kind !== "file" || entry.name.toLowerCase() !== wanted) continue;
        const file = await (entry as FileSystemFileHandle).getFile();
        return {
          size: file.size,
          read: async (start, length) =>
            new Uint8Array(await file.slice(start, start + length).arrayBuffer()),
        };
      }
      return null;
    },
  };
}

class Lazy<T> {
  private value?: Promise<T>;

  constructor(private readonly make: () => Promise<T>) {}

  get(): Promise<T> {
    return (this.value ??= this.make());
  }
}

async function whole(source: RangeSource): Promise<Uint8Array> {
  return source.read(0, source.size);
}

async function openFolder(
  root: Promise<FileSystemDirectoryHandle>,
  path: string,
): Promise<FileSystemDirectoryHandle | null> {
  let dir = await root;
  for (const part of path.split("/").filter(Boolean)) {
    try {
      dir = await dir.getDirectoryHandle(part);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return null;
      throw error;
    }
  }
  return dir;
}

function u16(data: Uint8Array, at: number): number {
  if (at + 2 > data.length) throw new Error("The MIX header is truncated.");
  return (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);
}

function entriesAt(data: Uint8Array, start: number, count: number): MixEntry[] {
  const out: MixEntry[] = [];
  for (let i = 0; i < count; i++) {
    const at = start + i * 12;
    if (at + 12 > data.length) throw new Error("The MIX index is truncated.");
    const view = new DataView(data.buffer, data.byteOffset + at, 12);
    out.push({
      id: view.getUint32(0, true),
      offset: view.getUint32(4, true),
      size: view.getUint32(8, true),
    });
  }
  return out;
}
