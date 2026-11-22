// Independent implementation of the XIF container (docs/mod-packs.md §1), the
// file XCC Mod Creator writes for a mod. Written from the format description;
// no XCC Utilities code (GPLv3) was copied or translated. MIT.

import { bunzip2 } from "./bzip2";

export const XIF_ID = 0x1a464958;

export class XifError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XifError";
  }
}

/** The value types the format defines (`t_vt` in the reference). */
export const enum XifType {
  Bin32 = 0,
  Binary = 1,
  Int32 = 2,
  String = 3,
  External = 4,
  Float = 5,
}

export interface XifValue {
  type: number;
  /** `Bin32`, `Int32` */
  int?: number;
  /** `Float` */
  float?: number;
  /** `External`: the byte count; the bytes arrive from the external block. */
  size?: number;
  /** `Binary`, `String`, `External` */
  bytes?: Uint8Array;
}

export interface XifNode {
  keys: Map<number, XifNode>;
  values: Map<number, XifValue>;
}

export interface XifLimits {
  /** Decompressed tree size; a crafted header cannot claim more than this. */
  maxOutput?: number;
  maxNodes?: number;
  maxDepth?: number;
  maxExternal?: number;
}

const DEFAULTS: Required<XifLimits> = {
  maxOutput: 512 * 1024 * 1024,
  maxNodes: 1_000_000,
  maxDepth: 64,
  maxExternal: 512 * 1024 * 1024,
};

interface Context {
  limits: Required<XifLimits>;
  nodes: number;
}

class Cursor {
  private at: number;

  constructor(
    private readonly data: Uint8Array,
    start = 0,
    private readonly end: number = data.length,
  ) {
    if (start < 0 || start > end || end > data.length)
      throw new XifError("The XIF cursor is out of bounds.");
    this.at = start;
  }

  get left(): number {
    return this.end - this.at;
  }

  u8(): number {
    if (this.at >= this.end) throw new XifError("The XIF data is truncated.");
    return this.data[this.at++]!;
  }

  u32(): number {
    if (this.at + 4 > this.end) throw new XifError("The XIF data is truncated.");
    const value =
      (this.data[this.at]! |
        (this.data[this.at + 1]! << 8) |
        (this.data[this.at + 2]! << 16) |
        (this.data[this.at + 3]! << 24)) >>>
      0;
    this.at += 4;
    return value;
  }

  i32(): number {
    return this.u32() | 0;
  }

  f32(): number {
    if (this.at + 4 > this.end) throw new XifError("The XIF data is truncated.");
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.at, 4);
    const value = view.getFloat32(0, true);
    this.at += 4;
    return value;
  }

  take(count: number): Uint8Array {
    if (count < 0 || this.at + count > this.end) throw new XifError("The XIF data is truncated.");
    const value = this.data.subarray(this.at, this.at + count);
    this.at += count;
    return value;
  }
}

/** Value as an integer; 0 when absent. */
export function xifInt(value: XifValue | undefined, fallback = 0): number {
  return value?.int ?? value?.size ?? fallback;
}

/** Value as text, up to the stored NUL; Latin-1, as the format stores it. */
export function xifText(value: XifValue | undefined, fallback = ""): string {
  const bytes = value?.bytes;
  if (!bytes) return fallback;
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  let text = "";
  for (let i = 0; i < end; i++) text += String.fromCharCode(bytes[i]!);
  return text;
}

/** Value as bytes; empty when absent. */
export function xifBytes(value: XifValue | undefined): Uint8Array {
  return value?.bytes ?? new Uint8Array(0);
}

/** The key with this id, or undefined. */
export function xifKey(node: XifNode, id: number): XifNode | undefined {
  return node.keys.get(id);
}

/**
 * Reads an XIF container. The header may be an old tree (version 0), a zlib
 * stream (1), or the current header (2) whose tree is raw, zlib or bzip2 and
 * may keep large values in an external block.
 */
export async function readXif(data: Uint8Array, limits: XifLimits = {}): Promise<XifNode> {
  if (data.length < 8) throw new XifError("This is too short to be an XIF file.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== XIF_ID) throw new XifError("This is not an XIF file.");
  const version = view.getUint32(4, true);
  const context: Context = { limits: { ...DEFAULTS, ...limits }, nodes: 0 };

  if (version === 0) {
    const cursor = new Cursor(data, 8);
    return parseOld(cursor, 0, context);
  }

  if (version === 1) {
    if (data.length < 12) throw new XifError("The XIF header is truncated.");
    const size = view.getUint32(8, true);
    if (size > context.limits.maxOutput)
      throw new XifError("The XIF data is larger than the allowed limit.");
    const tree = await inflate(data.subarray(12), context.limits.maxOutput);
    if (tree.length !== size) throw new XifError("The XIF size does not match its header.");
    return parseNew(new Cursor(tree), 0, context);
  }

  if (version !== 2) throw new XifError(`XIF version ${version} is not supported.`);
  if (data.length < 20) throw new XifError("The XIF header is truncated.");
  const sizeUncompressed = view.getUint32(8, true);
  const sizeCompressed = view.getUint32(12, true);
  const sizeExternal = view.getUint32(16, true);
  if (sizeExternal > context.limits.maxExternal)
    throw new XifError("The XIF external data is larger than the allowed limit.");
  const treeStart = 20;
  const treeEnd = treeStart + sizeCompressed;
  if (treeEnd > data.length || treeEnd + sizeExternal > data.length)
    throw new XifError("The XIF data is truncated.");

  let tree: Uint8Array;
  if (sizeUncompressed === 0) {
    if (sizeCompressed > context.limits.maxOutput)
      throw new XifError("The XIF data is larger than the allowed limit.");
    tree = data.subarray(treeStart, treeEnd);
  } else {
    if (sizeUncompressed > context.limits.maxOutput)
      throw new XifError("The XIF data is larger than the allowed limit.");
    const packed = data.subarray(treeStart, treeEnd);
    tree =
      packed[0] === 0x42 && packed[1] === 0x5a && packed[2] === 0x68
        ? bunzip2(packed, context.limits.maxOutput)
        : await inflate(packed, context.limits.maxOutput);
    if (tree.length !== sizeUncompressed)
      throw new XifError("The XIF size does not match its header.");
  }

  const root = parseNew(new Cursor(tree), 0, context);
  if (sizeExternal) fillExternal(root, new Cursor(data, treeEnd, treeEnd + sizeExternal));
  return root;
}

function parseOld(cursor: Cursor, depth: number, context: Context): XifNode {
  enter(depth, context);
  const node: XifNode = { keys: new Map(), values: new Map() };
  const keyCount = cursor.i32();
  if (keyCount < 0) throw new XifError("The XIF key count is negative.");
  for (let i = 0; i < keyCount; i++) {
    const id = cursor.i32();
    if (id < 0) throw new XifError("The XIF key id is negative.");
    node.keys.set(id, parseOld(cursor, depth + 1, context));
  }
  const valueCount = cursor.i32();
  if (valueCount < 0) throw new XifError("The XIF value count is negative.");
  for (let i = 0; i < valueCount; i++) {
    const id = cursor.i32();
    if (id < 0) throw new XifError("The XIF value id is negative.");
    const size = cursor.i32();
    if (size < 0) throw new XifError("The XIF value size is negative.");
    node.values.set(id, inferOldValue(cursor.take(size)));
  }
  return node;
}

/** Old files carry no type byte; the reference guesses it from the bytes. */
function inferOldValue(bytes: Uint8Array): XifValue {
  if (bytes.length) {
    let text = bytes[bytes.length - 1] === 0;
    for (let i = 0; text && i < bytes.length - 1; i++) {
      const value = bytes[i]!;
      if (value !== 9 && value < 0x20) text = false;
    }
    if (text) return { type: XifType.String, bytes };
  }
  if (bytes.length === 4) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, 4);
    return { type: XifType.Int32, int: view.getInt32(0, true) };
  }
  return { type: XifType.Binary, bytes };
}

function parseNew(cursor: Cursor, depth: number, context: Context): XifNode {
  enter(depth, context);
  const node: XifNode = { keys: new Map(), values: new Map() };
  const keyCount = cursor.i32();
  if (keyCount < 0) throw new XifError("The XIF key count is negative.");
  let id = 0;
  for (let i = 0; i < keyCount; i++) {
    id += cursor.i32();
    if (id < 0) throw new XifError("The XIF key id is negative.");
    node.keys.set(id, parseNew(cursor, depth + 1, context));
  }
  const valueCount = cursor.i32();
  if (valueCount < 0) throw new XifError("The XIF value count is negative.");
  id = 0;
  for (let i = 0; i < valueCount; i++) {
    id += cursor.i32();
    if (id < 0) throw new XifError("The XIF value id is negative.");
    node.values.set(id, parseValue(cursor));
  }
  return node;
}

function parseValue(cursor: Cursor): XifValue {
  const type = cursor.u8();
  switch (type) {
    case XifType.Bin32:
      return { type, int: cursor.u32() };
    case XifType.Int32:
      return { type, int: cursor.i32() };
    case XifType.Float:
      return { type, float: cursor.f32() };
    case XifType.External: {
      const size = cursor.i32();
      if (size < 0) throw new XifError("The XIF external size is negative.");
      return { type, size };
    }
    case XifType.Binary:
    case XifType.String: {
      const size = cursor.i32();
      if (size < 0) throw new XifError("The XIF value size is negative.");
      return { type, bytes: cursor.take(size) };
    }
    default: {
      const size = cursor.i32();
      if (size < 0) throw new XifError("The XIF value size is negative.");
      return { type, bytes: cursor.take(size) };
    }
  }
}

function fillExternal(node: XifNode, cursor: Cursor): void {
  for (const child of node.keys.values()) fillExternal(child, cursor);
  for (const value of node.values.values()) {
    if (value.type !== XifType.External) continue;
    const size = value.size ?? 0;
    value.bytes = cursor.take(size);
  }
}

function enter(depth: number, context: Context): void {
  if (depth > context.limits.maxDepth) throw new XifError("The XIF tree is nested too deeply.");
  if (++context.nodes > context.limits.maxNodes)
    throw new XifError("The XIF tree has too many nodes.");
}

async function inflate(data: Uint8Array, maxOutput: number): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const collect = (async () => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > maxOutput) {
        await reader.cancel();
        throw new XifError("The XIF data is larger than the allowed limit.");
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  })();
  try {
    const copy = new Uint8Array(data.length);
    copy.set(data);
    await writer.write(copy);
    await writer.close();
  } catch {
    // The reader reports the format error; awaiting it below gives the reason.
  }
  return collect;
}
