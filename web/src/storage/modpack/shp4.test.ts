import { describe, expect, it } from "vitest";
import { decodeShp4, Shp4Error } from "./shp4";

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

// 4x4 image, two frames. Frame 0 has one pixel at (1,1); frame 1 is empty.
const stream = bytes(
  4,
  0,
  4,
  0,
  2,
  0, // cx, cy, frames
  1,
  2,
  1,
  2, // frame 0 margins: lm, rm, tm, bm
  0,
  0,
  5, // row margins, then the one pixel
  4,
  0,
  4,
  0, // frame 1: an empty frame at (4,4)
);

function u16(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset).getUint16(at, true);
}

function i16(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset).getInt16(at, true);
}

function i32(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset).getInt32(at, true);
}

describe("decodeShp4", () => {
  it("rebuilds the SHP header, frames and scanlines", () => {
    const out = decodeShp4(stream, 64);
    expect(out.length).toBe(64);
    expect(u16(out, 0)).toBe(0);
    expect(u16(out, 2)).toBe(4);
    expect(u16(out, 4)).toBe(4);
    expect(u16(out, 6)).toBe(2);

    expect(i16(out, 8)).toBe(1);
    expect(i16(out, 10)).toBe(1);
    expect(i16(out, 12)).toBe(1);
    expect(i16(out, 14)).toBe(1);
    expect(i32(out, 16)).toBe(3);
    expect(i32(out, 28)).toBe(56);

    expect(i16(out, 32)).toBe(4);
    expect(i16(out, 34)).toBe(4);
    expect(i16(out, 36)).toBe(0);
    expect(i16(out, 38)).toBe(0);
    expect(i32(out, 52)).toBe(0);

    // The first scanline: length 3, then the pixel.
    expect([...out.subarray(56, 59)]).toEqual([3, 0, 5]);
  });

  it("decodes a zero run and the row margins", () => {
    // 4x2 image, one frame: lm=1, rm=0, tm=0, bm=1 -> 3x1 frame.
    // Row: lm=0, rm=1, middle: one zero run of 1, then a pixel.
    const out = decodeShp4(bytes(4, 0, 2, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 9), undefined);
    expect(u16(out, 2)).toBe(4);
    expect(u16(out, 4)).toBe(2);
    const offset = i32(out, 28);
    // length 7: [0,1] zero run, 9, then [0,1] for the right margin
    expect([...out.subarray(offset, offset + 7)]).toEqual([7, 0, 0, 1, 9, 0, 1]);
  });

  it("refuses a truncated stream", () => {
    expect(() => decodeShp4(stream.subarray(0, 8))).toThrow(Shp4Error);
  });

  it("refuses margins larger than the image", () => {
    expect(() => decodeShp4(bytes(2, 0, 2, 0, 1, 0, 3, 0, 0, 0))).toThrow(/margins/);
  });

  it("refuses a size that does not match the pack's record", () => {
    expect(() => decodeShp4(stream, 63)).toThrow(/size/);
  });
});
