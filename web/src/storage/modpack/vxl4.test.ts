import { describe, expect, it } from "vitest";
import { decodeVxl4, Vxl4Error } from "./vxl4";

function source(): Uint8Array {
  const data = new Uint8Array(4 + 52 + 5 + 3);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, true);
  const at = 4;
  for (let i = 0; i < 4; i++) data[at + i] = "body".charCodeAt(i);
  view.setInt32(at + 16, 0, true);
  view.setFloat32(at + 20, 1, true);
  view.setFloat32(at + 24, 0, true);
  view.setFloat32(at + 28, 0, true);
  view.setFloat32(at + 32, 0, true);
  view.setFloat32(at + 36, 2, true);
  view.setFloat32(at + 40, 2, true);
  view.setFloat32(at + 44, 4, true);
  data[at + 48] = 2;
  data[at + 49] = 2;
  data[at + 50] = 4;
  data[at + 51] = 0;
  // One span with a pixel, ended by the cz marker, then three empty spans.
  data.set([0, 1, 0x11, 0x22, 4, 4, 4, 4], 4 + 52);
  return data;
}

function i32(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset).getInt32(at, true);
}

function f32(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset).getFloat32(at, true);
}

describe("decodeVxl4", () => {
  it("rebuilds the VXL header, section, offset lists and span data", () => {
    const out = decodeVxl4(source(), 959);
    expect(out.length).toBe(959);
    expect(String.fromCharCode(...out.subarray(0, 15))).toBe("Voxel Animation");
    expect(i32(out, 16)).toBe(1);
    expect(new DataView(out.buffer).getUint32(20, true)).toBe(1);
    expect(new DataView(out.buffer).getUint32(24, true)).toBe(1);
    expect(new DataView(out.buffer).getUint32(28, true)).toBe(37);
    expect(new DataView(out.buffer).getInt16(32, true)).toBe(0x1f10);

    expect(String.fromCharCode(...out.subarray(802, 806))).toBe("body");
    expect(i32(out, 802 + 16)).toBe(0);
    expect(i32(out, 802 + 20)).toBe(1);

    const body = 802 + 28;
    expect([0, 1, 2, 3].map((span) => i32(out, body + span * 4))).toEqual([0, -1, -1, -1]);
    expect([0, 1, 2, 3].map((span) => i32(out, body + 16 + span * 4))).toEqual([4, -1, -1, -1]);
    expect([...out.subarray(body + 32, body + 37)]).toEqual([0, 1, 0x11, 0x22, 1]);

    const tailer = 867;
    expect(i32(out, tailer)).toBe(0);
    expect(i32(out, tailer + 4)).toBe(16);
    expect(i32(out, tailer + 8)).toBe(32);
    expect(f32(out, tailer + 12)).toBe(1);
    expect(f32(out, tailer + 64)).toBe(0);
    expect(f32(out, tailer + 76)).toBe(2);
    expect(f32(out, tailer + 84)).toBe(4);
    expect([...out.subarray(tailer + 88, tailer + 92)]).toEqual([2, 2, 4, 0]);
  });

  it("refuses a truncated stream", () => {
    expect(() => decodeVxl4(source().subarray(0, 20))).toThrow(Vxl4Error);
    expect(() => decodeVxl4(source().subarray(0, 60))).toThrow(Vxl4Error);
  });

  it("refuses a size that does not match the pack's record", () => {
    expect(() => decodeVxl4(source(), 958)).toThrow(/size/);
  });
});
