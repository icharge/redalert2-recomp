// Test-only writer for the XIF format, from the description in
// docs/mod-packs.md §1. It lets the reader tests build a tree without reading
// an XCC-written file. Not imported by the app.

import { deflateSync } from "node:zlib";

/** Decodes an embedded test vector. */
export function decodeBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (value) => value.charCodeAt(0));
}

/** A minimal version 3 CSF with one plain value per label, for build tests. */
export function csfBytes(entries: [string, string][]): Uint8Array {
  const parts: Uint8Array[] = [];
  const header = new Uint8Array(24);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, 0x43534620, true); // " FSC"
  headerView.setUint32(4, 3, true);
  headerView.setUint32(8, entries.length, true);
  headerView.setUint32(12, entries.length, true);
  parts.push(header);
  for (const [label, text] of entries) {
    const labelBytes = new TextEncoder().encode(label);
    const units = Array.from(text, (character) => character.charCodeAt(0));
    const entry = new Uint8Array(12 + labelBytes.length + 8 + units.length * 2);
    const view = new DataView(entry.buffer);
    view.setUint32(0, 0x4c424c20, true); // " LBL"
    view.setUint32(4, 1, true);
    view.setUint32(8, labelBytes.length, true);
    entry.set(labelBytes, 12);
    let at = 12 + labelBytes.length;
    view.setUint32(at, 0x53545220, true); // "STR "
    at += 4;
    view.setUint32(at, units.length, true);
    at += 4;
    for (const unit of units) {
      view.setUint16(at, ~unit & 0xffff, true);
      at += 2;
    }
    parts.push(entry);
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export type FixtureValue =
  | string
  | number
  | Uint8Array
  | { int32: number }
  | { bin32: number }
  | { float: number }
  | { external: Uint8Array };

export interface FixtureNode {
  keys?: [number, FixtureNode][];
  values?: [number, FixtureValue][];
}

export interface FixtureOptions {
  /** `raw` keeps the tree plain (size_uncompressed = 0); `zlib` compresses it. */
  compression?: "raw" | "zlib";
}

/** Builds a version 2 XIF file from a small tree. */
export function buildXif(root: FixtureNode, options: FixtureOptions = {}): Uint8Array {
  const external: number[] = [];
  const body = writeNode(root, external);
  const packed = options.compression === "zlib" ? deflateSync(Uint8Array.from(body)) : null;
  const tree = packed ? new Uint8Array(packed) : Uint8Array.from(body);
  const out = new Uint8Array(20 + tree.length + external.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x1a464958, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, options.compression === "zlib" ? body.length : 0, true);
  view.setUint32(12, tree.length, true);
  view.setUint32(16, external.length, true);
  out.set(tree, 20);
  out.set(Uint8Array.from(external), 20 + tree.length);
  return out;
}

/** Wraps pre-compressed tree bytes in a version 2 header. */
export function packXifTree(tree: Uint8Array, sizeUncompressed = 0): Uint8Array {
  const out = new Uint8Array(20 + tree.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x1a464958, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, sizeUncompressed, true);
  view.setUint32(12, tree.length, true);
  out.set(tree, 20);
  return out;
}

function writeNode(node: FixtureNode, external: number[]): number[] {
  const out: number[] = [];
  const keys = node.keys ?? [];
  writeInt(out, keys.length);
  let id = 0;
  for (const [key, child] of keys) {
    writeInt(out, key - id);
    id = key;
    append(out, writeNode(child, external));
  }
  const values = node.values ?? [];
  writeInt(out, values.length);
  id = 0;
  for (const [key, value] of values) {
    writeInt(out, key - id);
    id = key;
    writeValue(out, value, external);
  }
  return out;
}

/** `instanceof` crosses realms badly under jsdom; the tag check does not. */
function isBytes(value: FixtureValue): value is Uint8Array {
  return Object.prototype.toString.call(value) === "[object Uint8Array]";
}

function writeValue(out: number[], value: FixtureValue, external: number[]): void {
  if (typeof value === "string") {
    const bytes = new Uint8Array(value.length + 1);
    for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff;
    out.push(3);
    writeInt(out, bytes.length);
    append(out, bytes);
    return;
  }
  if (typeof value === "number") {
    out.push(2);
    writeInt(out, value);
    return;
  }
  if (isBytes(value)) {
    const bytes = value;
    out.push(1);
    writeInt(out, bytes.length);
    append(out, bytes);
    return;
  }
  if ("int32" in value) {
    out.push(2);
    writeInt(out, value.int32);
    return;
  }
  if ("bin32" in value) {
    out.push(0);
    writeInt(out, value.bin32);
    return;
  }
  if ("float" in value) {
    out.push(5);
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value.float, true);
    append(out, bytes);
    return;
  }
  out.push(4);
  writeInt(out, value.external.length);
  append(external, value.external);
}

function append(out: number[], bytes: ArrayLike<number>): void {
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]!);
}

function writeInt(out: number[], value: number): void {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  out.push(...bytes);
}
