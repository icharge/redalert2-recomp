// SHP-4 decoder for XCC mod packs (docs/mod-packs.md §2, `enc_shp`).
// Independent implementation of the layout described there; no XCC Utilities
// code (GPLv3) was copied or translated. MIT.

export class Shp4Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Shp4Error";
  }
}

const HEADER_SIZE = 8;
const IMAGE_HEADER_SIZE = 24;

/**
 * Expands the pack's frame stream to a normal SHP(TS) file. `decodedSize` is
 * the size the pack recorded (`vi_cb_d`); when present it must match, which
 * catches a corrupt stream.
 */
export function decodeShp4(data: Uint8Array, decodedSize?: number): Uint8Array {
  if (data.length < 6) throw new Shp4Error("The SHP stream is truncated.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const globalCx = view.getUint16(0, true);
  const globalCy = view.getUint16(2, true);
  const frames = view.getUint16(4, true);
  if (!globalCx || !globalCy || !frames) throw new Shp4Error("The SHP stream has no image.");
  let read = 6;

  const images: { x: number; y: number; cx: number; cy: number; bytes: Uint8Array }[] = [];
  for (let frame = 0; frame < frames; frame++) {
    if (read + 4 > data.length) throw new Shp4Error("The SHP frame header is truncated.");
    const lm = data[read++]!;
    const rm = data[read++]!;
    const tm = data[read++]!;
    const bm = data[read++]!;
    const cx = globalCx - lm - rm;
    const cy = globalCy - tm - bm;
    if (cx < 0 || cy < 0) throw new Shp4Error("An SHP frame's margins are larger than the image.");
    if (!cy) {
      images.push({ x: lm, y: tm, cx, cy, bytes: new Uint8Array(0) });
      continue;
    }
    const rows = new Uint8Array((cx * 2 + 8) * cy + 16);
    let written = 0;
    for (let row = 0; row < cy; row++) {
      if (read + 2 > data.length) throw new Shp4Error("The SHP row header is truncated.");
      const rowLeft = data[read++]!;
      const rowRight = data[read++]!;
      const middleWidth = cx - rowLeft - rowRight;
      if (middleWidth < 0) throw new Shp4Error("An SHP row's margins are larger than its frame.");
      const start = written;
      written += 2; // the scanline length, filled in below
      if (rowLeft) {
        written = put(rows, written, 0);
        written = put(rows, written, rowLeft);
      }
      let middle = 0;
      while (middle < middleWidth) {
        const value = data[read++];
        if (value === undefined) throw new Shp4Error("The SHP row data is truncated.");
        written = put(rows, written, value);
        if (value === 0) {
          const count = data[read++];
          if (count === undefined) throw new Shp4Error("The SHP zero run is truncated.");
          if (middle + count > middleWidth)
            throw new Shp4Error("An SHP zero run is wider than its row.");
          written = put(rows, written, count);
          middle += count;
        } else {
          middle++;
        }
      }
      if (rowRight) {
        written = put(rows, written, 0);
        written = put(rows, written, rowRight);
      }
      const length = written - start;
      rows[start] = length & 0xff;
      rows[start + 1] = (length >> 8) & 0xff;
    }
    images.push({ x: lm, y: tm, cx, cy, bytes: rows.subarray(0, written) });
  }

  let offset = HEADER_SIZE + IMAGE_HEADER_SIZE * frames;
  const offsets: number[] = [];
  for (const image of images) {
    offsets.push(image.cy ? offset : 0);
    offset = align8(offset + image.bytes.length);
  }
  const out = new Uint8Array(offset);
  const outView = new DataView(out.buffer);
  outView.setUint16(0, 0, true);
  outView.setUint16(2, globalCx, true);
  outView.setUint16(4, globalCy, true);
  outView.setUint16(6, frames, true);
  for (let frame = 0; frame < frames; frame++) {
    const image = images[frame]!;
    const at = HEADER_SIZE + frame * IMAGE_HEADER_SIZE;
    outView.setInt16(at, image.x, true);
    outView.setInt16(at + 2, image.y, true);
    outView.setInt16(at + 4, image.cx, true);
    outView.setInt16(at + 6, image.cy, true);
    outView.setInt32(at + 8, 3, true); // scanline compression
    outView.setInt32(at + 12, 0, true);
    outView.setInt32(at + 16, 0, true);
    outView.setInt32(at + 20, offsets[frame]!, true);
    if (image.cy) out.set(image.bytes, offsets[frame]!);
  }
  if (decodedSize !== undefined && decodedSize !== out.length)
    throw new Shp4Error("The SHP size does not match the size the pack recorded.");
  return out;
}

function put(data: Uint8Array, at: number, value: number): number {
  if (at >= data.length) throw new Shp4Error("The SHP frame data is larger than its image.");
  data[at] = value;
  return at + 1;
}

function align8(value: number): number {
  return (value + 7) & ~7;
}
