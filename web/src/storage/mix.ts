// Read an entry from a MIX archive, for the launcher's base CSF.
//
// A MIX is a header and an index of (id, offset, size) entries. The id is
// CRC-32 of the uppercased file name, padded the Westwood way. Old archives
// have a u16 count first; new archives have flags and may encrypt the index
// with Blowfish, whose 56-byte key is recovered from an 80-byte RSA block with
// the public key below. This reads only the data it needs from a byte array.
//
// The launcher uses it to get ra2.csf/ra2md.csf out of language.mix/langmd.mix
// when the player has no loose CSF. The RSA key and the Blowfish tables are
// public format constants; no game data is stored here.

import { BLOWFISH_INIT_B64 } from "./blowfish-tables";
import { crc32 } from "./crc32";

export interface MixEntry {
  id: number;
  offset: number;
  size: number;
}

export interface MixIndex {
  kind: "old" | "new";
  flags: number;
  entries: MixEntry[];
  bodyOffset: number;
}

export interface MixReadOptions {
  /** Override the RSA modulus in tests; production uses the MIX public key. */
  rsaModulus?: bigint;
}

const FLAG_ENCRYPTED = 0x0002;
const RSA_KEY_BLOCK_SIZE = 80;
const RSA_HALF_SIZE = 40;
const RSA_COMBINE_SHIFT_BITS = 312n;
const RSA_EXPONENT = 65537n;
const RSA_MODULUS = BigInt(
  "0x51BCDA086D39FCE4565160D651713FA2E8AA54FA6682B04AABDD0E6AF8B0C1E6D1FB4F3DAA437F15",
);
const MAX_INDEX_SIZE = 4 * 1024 * 1024;

let tables: Uint32Array | null = null;

function initTables(): Uint32Array {
  if (tables) return tables;
  const binary = atob(BLOWFISH_INIT_B64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.length !== (18 + 1024) * 4) throw new Error("The Blowfish tables are damaged.");
  tables = new Uint32Array(bytes.buffer, bytes.byteOffset, 18 + 1024);
  return tables;
}

function bigintToBytes(value: bigint, size?: number): Uint8Array {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0n) {
    bytes.unshift(Number(rest & 0xffn));
    rest >>= 8n;
  }
  if (bytes.length === 0) bytes.push(0);
  if (size !== undefined) {
    if (bytes.length > size) return new Uint8Array(bytes.slice(bytes.length - size));
    const padded = new Uint8Array(size);
    padded.set(bytes, size - bytes.length);
    return padded;
  }
  return new Uint8Array(bytes);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

/** Recover the Blowfish key from a MIX's 80-byte RSA block. */
export function extractBlowfishKey(block: Uint8Array, modulus = RSA_MODULUS): Uint8Array {
  if (block.length < RSA_KEY_BLOCK_SIZE) throw new Error("The MIX RSA key block is truncated.");
  const reversed = block.slice(0, RSA_KEY_BLOCK_SIZE).reverse();
  const s0 = modPow(
    BigInt(
      `0x${[...reversed.slice(0, RSA_HALF_SIZE)].map((b) => b.toString(16).padStart(2, "0")).join("")}`,
    ),
    RSA_EXPONENT,
    modulus,
  );
  const s1 = modPow(
    BigInt(
      `0x${[...reversed.slice(RSA_HALF_SIZE, RSA_KEY_BLOCK_SIZE)].map((b) => b.toString(16).padStart(2, "0")).join("")}`,
    ),
    RSA_EXPONENT,
    modulus,
  );
  const combined = (s0 << RSA_COMBINE_SHIFT_BITS) + s1;
  return bigintToBytes(combined, 56).reverse();
}

/** Exported for the cipher's own test vectors; the MIX reader is the normal entry point. */
export class Blowfish {
  private readonly p = new Uint32Array(18);
  private readonly s0 = new Uint32Array(256);
  private readonly s1 = new Uint32Array(256);
  private readonly s2 = new Uint32Array(256);
  private readonly s3 = new Uint32Array(256);

  constructor(key: Uint8Array) {
    if (key.length === 0) throw new Error("The Blowfish key is empty.");
    const init = initTables();
    this.p.set(init.subarray(0, 18));
    this.s0.set(init.subarray(18, 18 + 256));
    this.s1.set(init.subarray(18 + 256, 18 + 512));
    this.s2.set(init.subarray(18 + 512, 18 + 768));
    this.s3.set(init.subarray(18 + 768, 18 + 1024));
    for (let i = 0, k = 0; i < 18; i++) {
      let word = 0;
      for (let j = 0; j < 4; j++, k = (k + 1) % key.length)
        word = ((word << 8) | (key[k] ?? 0)) >>> 0;
      this.p[i] = (this.p[i] ?? 0) ^ word;
    }
    let left = 0;
    let right = 0;
    for (let i = 0; i < 18; i += 2) {
      [left, right] = this.encrypt(left, right);
      this.p[i] = left;
      this.p[i + 1] = right;
    }
    for (const box of [this.s0, this.s1, this.s2, this.s3]) {
      for (let i = 0; i < 256; i += 2) {
        [left, right] = this.encrypt(left, right);
        box[i] = left;
        box[i + 1] = right;
      }
    }
  }

  private f(x: number): number {
    const a = ((this.s0[x >>> 24] ?? 0) + (this.s1[(x >>> 16) & 0xff] ?? 0)) >>> 0;
    const b = (a ^ (this.s2[(x >>> 8) & 0xff] ?? 0)) >>> 0;
    return (b + (this.s3[x & 0xff] ?? 0)) >>> 0;
  }

  private encrypt(left: number, right: number): [number, number] {
    let l = left;
    let r = right;
    for (let i = 0; i < 16; i += 2) {
      l = (l ^ (this.p[i] ?? 0)) >>> 0;
      r = (r ^ this.f(l)) >>> 0;
      r = (r ^ (this.p[i + 1] ?? 0)) >>> 0;
      l = (l ^ this.f(r)) >>> 0;
    }
    return [(r ^ (this.p[17] ?? 0)) >>> 0, (l ^ (this.p[16] ?? 0)) >>> 0];
  }

  decryptBlock(left: number, right: number): [number, number] {
    let l = left;
    let r = right;
    for (let i = 17; i > 1; i -= 2) {
      l = (l ^ (this.p[i] ?? 0)) >>> 0;
      r = (r ^ this.f(l)) >>> 0;
      r = (r ^ (this.p[i - 1] ?? 0)) >>> 0;
      l = (l ^ this.f(r)) >>> 0;
    }
    return [(r ^ (this.p[0] ?? 0)) >>> 0, (l ^ (this.p[1] ?? 0)) >>> 0];
  }

  decrypt(data: Uint8Array): Uint8Array {
    if (data.length % 8 !== 0)
      throw new Error("The Blowfish data is not a whole number of blocks.");
    const out = data.slice();
    for (let at = 0; at < out.length; at += 8) {
      const left =
        (((out[at] ?? 0) << 24) |
          ((out[at + 1] ?? 0) << 16) |
          ((out[at + 2] ?? 0) << 8) |
          (out[at + 3] ?? 0)) >>>
        0;
      const right =
        (((out[at + 4] ?? 0) << 24) |
          ((out[at + 5] ?? 0) << 16) |
          ((out[at + 6] ?? 0) << 8) |
          (out[at + 7] ?? 0)) >>>
        0;
      const [l, r] = this.decryptBlock(left, right);
      out[at] = (l >>> 24) & 0xff;
      out[at + 1] = (l >>> 16) & 0xff;
      out[at + 2] = (l >>> 8) & 0xff;
      out[at + 3] = l & 0xff;
      out[at + 4] = (r >>> 24) & 0xff;
      out[at + 5] = (r >>> 16) & 0xff;
      out[at + 6] = (r >>> 8) & 0xff;
      out[at + 7] = r & 0xff;
    }
    return out;
  }
}

/** MIX file-name hash: CRC-32 of the uppercased, Westwood-padded name. */
export function mixHash(name: string): number {
  return crc32(westwoodPad(new TextEncoder().encode(name.toUpperCase())));
}

function westwoodPad(data: Uint8Array): Uint8Array {
  const residue = data.length % 4;
  if (residue === 0) return data;
  const padding = 4 - residue;
  const rounded = data.length - residue;
  const fill = data[rounded] ?? 0;
  const out = new Uint8Array(data.length + padding);
  out.set(data);
  out[data.length] = residue;
  for (let i = 1; i < padding; i++) out[data.length + i] = fill;
  return out;
}

function readU16(data: Uint8Array, at: number): number {
  if (at + 2 > data.length) throw new Error("The MIX header is truncated.");
  return (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);
}

function readU32(data: Uint8Array, at: number): number {
  if (at + 4 > data.length) throw new Error("The MIX index is truncated.");
  return (
    ((data[at] ?? 0) |
      ((data[at + 1] ?? 0) << 8) |
      ((data[at + 2] ?? 0) << 16) |
      ((data[at + 3] ?? 0) << 24)) >>>
    0
  );
}

function parseEntries(data: Uint8Array, start: number, count: number): MixEntry[] {
  if (count * 12 > MAX_INDEX_SIZE) throw new Error("The MIX index is too large.");
  const entries: MixEntry[] = [];
  for (let i = 0; i < count; i++) {
    const at = start + i * 12;
    entries.push({
      id: readU32(data, at),
      offset: readU32(data, at + 4),
      size: readU32(data, at + 8),
    });
  }
  return entries;
}

/** Parse a MIX header and index. */
export function readMixIndex(data: Uint8Array, options: MixReadOptions = {}): MixIndex {
  if (data.length < 4) throw new Error("The MIX file is too short.");
  const first = readU16(data, 0);
  if (first === 0) {
    const flags = readU16(data, 2);
    if (flags & FLAG_ENCRYPTED) {
      const encryptedStart = 4 + RSA_KEY_BLOCK_SIZE;
      if (data.length < encryptedStart + 8) throw new Error("The MIX key block is truncated.");
      const key = extractBlowfishKey(
        data.subarray(4, encryptedStart),
        options.rsaModulus ?? RSA_MODULUS,
      );
      const cipher = new Blowfish(key);
      const firstBlock = cipher.decrypt(data.subarray(encryptedStart, encryptedStart + 8));
      const count = readU16(firstBlock, 0);
      const total = 6 + count * 12;
      const encryptedSize = Math.ceil(total / 8) * 8;
      if (encryptedStart + encryptedSize > data.length)
        throw new Error("The MIX encrypted index is truncated.");
      const decrypted = cipher.decrypt(
        data.subarray(encryptedStart, encryptedStart + encryptedSize),
      );
      return {
        kind: "new",
        flags,
        entries: parseEntries(decrypted, 6, count),
        bodyOffset: encryptedStart + encryptedSize,
      };
    }
    const count = readU16(data, 4);
    return {
      kind: "new",
      flags,
      entries: parseEntries(data, 10, count),
      bodyOffset: 10 + count * 12,
    };
  }
  return {
    kind: "old",
    flags: 0,
    entries: parseEntries(data, 6, first),
    bodyOffset: 6 + first * 12,
  };
}

/** Extract one entry from a MIX by file name, or null when it is absent. */
export function readMixEntry(
  data: Uint8Array,
  name: string,
  options: MixReadOptions = {},
): Uint8Array | null {
  const index = readMixIndex(data, options);
  const id = mixHash(name);
  const entry = index.entries.find((candidate) => candidate.id === id);
  if (!entry) return null;
  const start = index.bodyOffset + entry.offset;
  const end = start + entry.size;
  if (start > data.length || end > data.length || end < start)
    throw new Error(`The MIX entry ${name} points past the end of the archive.`);
  return data.subarray(start, end);
}
