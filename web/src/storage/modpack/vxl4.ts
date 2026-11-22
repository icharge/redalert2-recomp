// VXL-4 decoder for XCC mod packs (docs/mod-packs.md §2, `enc_vxl`).
// Independent implementation of the layout described there; no XCC Utilities
// code (GPLv3) was copied or translated. MIT.

export class Vxl4Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Vxl4Error";
  }
}

const VXL_ID = "Voxel Animation";
const HEADER_SIZE = 802;
const SECTION_HEADER_SIZE = 28;
const SECTION_TAILER_SIZE = 92;
const SOURCE_SECTION_SIZE = 52;

interface Section {
  id: string;
  sectionIndex: number;
  scale: number;
  min: [number, number, number];
  max: [number, number, number];
  cx: number;
  cy: number;
  cz: number;
  unknown: number;
  starts: Int32Array;
  ends: Int32Array;
  data: Uint8Array;
}

/**
 * Expands the pack's voxel stream to a normal VXL. `decodedSize` is the size
 * the pack recorded (`vi_cb_d`); when present it must match.
 */
export function decodeVxl4(data: Uint8Array, decodedSize?: number): Uint8Array {
  if (data.length < 4) throw new Vxl4Error("The VXL stream is truncated.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  if (!count || count > 4096) throw new Vxl4Error("The VXL stream has a bad section count.");
  let read = 4;
  const sections: Section[] = [];
  let bodySize = 0;
  for (let index = 0; index < count; index++) {
    if (read + SOURCE_SECTION_SIZE > data.length)
      throw new Vxl4Error("The VXL section header is truncated.");
    const at = read;
    const id = fixedText(data, at, 16);
    const sectionIndex = view.getInt32(at + 16, true);
    const scale = view.getFloat32(at + 20, true);
    const min: [number, number, number] = [
      view.getFloat32(at + 24, true),
      view.getFloat32(at + 28, true),
      view.getFloat32(at + 32, true),
    ];
    const max: [number, number, number] = [
      view.getFloat32(at + 36, true),
      view.getFloat32(at + 40, true),
      view.getFloat32(at + 44, true),
    ];
    const cx = data[at + 48]!;
    const cy = data[at + 49]!;
    const cz = data[at + 50]!;
    const unknown = (data[at + 51]! << 24) >> 24;
    read += SOURCE_SECTION_SIZE;

    const spans = cx * cy;
    const starts = new Int32Array(spans);
    const ends = new Int32Array(spans);
    const spanData = new Growable();
    for (let span = 0; span < spans; span++) {
      const start = spanData.length;
      let z = 0;
      while (z < cz) {
        if (read >= data.length) throw new Vxl4Error("The VXL span data is truncated.");
        const step = data[read++]!;
        if (step === cz) break;
        z += step;
        if (read >= data.length) throw new Vxl4Error("The VXL span data is truncated.");
        const pixels = data[read++]!;
        spanData.push(step);
        spanData.push(pixels);
        for (let pixel = 0; pixel < pixels; pixel++) {
          if (read + 2 > data.length) throw new Vxl4Error("The VXL span data is truncated.");
          spanData.push(data[read++]!);
          spanData.push(data[read++]!);
          z++;
        }
        spanData.push(pixels);
        if (z > cz) throw new Vxl4Error("A VXL span runs past its section.");
      }
      if (spanData.length === start) {
        starts[span] = -1;
        ends[span] = -1;
      } else {
        starts[span] = start;
        ends[span] = spanData.length - 1;
      }
    }
    bodySize += 8 * spans + spanData.length;
    sections.push({
      id,
      sectionIndex,
      scale,
      min,
      max,
      cx,
      cy,
      cz,
      unknown,
      starts,
      ends,
      data: spanData.result(),
    });
  }

  const total = HEADER_SIZE + SECTION_HEADER_SIZE * count + bodySize + SECTION_TAILER_SIZE * count;
  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  writeFixed(out, 0, VXL_ID, 16);
  outView.setInt32(16, 1, true);
  outView.setUint32(20, count, true);
  outView.setUint32(24, count, true);
  outView.setUint32(28, bodySize, true);
  outView.setInt16(32, 0x1f10, true);
  // The palette at 34..801 is zero: the stream does not carry one.

  const bodyStart = HEADER_SIZE + SECTION_HEADER_SIZE * count;
  const tailerStart = bodyStart + bodySize;
  let bodyAt = bodyStart;
  for (let index = 0; index < count; index++) {
    const section = sections[index]!;
    const headerAt = HEADER_SIZE + index * SECTION_HEADER_SIZE;
    writeFixed(out, headerAt, section.id, 16);
    outView.setInt32(headerAt + 16, section.sectionIndex, true);
    outView.setInt32(headerAt + 20, 1, true);
    outView.setInt32(headerAt + 24, 0, true);

    const spans = section.cx * section.cy;
    const startOfs = bodyAt - bodyStart;
    for (let span = 0; span < spans; span++) {
      outView.setInt32(bodyAt, section.starts[span]!, true);
      bodyAt += 4;
    }
    const endOfs = bodyAt - bodyStart;
    for (let span = 0; span < spans; span++) {
      outView.setInt32(bodyAt, section.ends[span]!, true);
      bodyAt += 4;
    }
    const dataOfs = bodyAt - bodyStart;
    out.set(section.data, bodyAt);
    bodyAt += section.data.length;

    const tailer = tailerStart + index * SECTION_TAILER_SIZE;
    outView.setInt32(tailer, startOfs, true);
    outView.setInt32(tailer + 4, endOfs, true);
    outView.setInt32(tailer + 8, dataOfs, true);
    outView.setFloat32(tailer + 12, section.scale, true);
    // 16..63: the transform, zero (the stream carries no transform).
    outView.setFloat32(tailer + 64, section.min[0], true);
    outView.setFloat32(tailer + 68, section.min[1], true);
    outView.setFloat32(tailer + 72, section.min[2], true);
    outView.setFloat32(tailer + 76, section.max[0], true);
    outView.setFloat32(tailer + 80, section.max[1], true);
    outView.setFloat32(tailer + 84, section.max[2], true);
    out[tailer + 88] = section.cx;
    out[tailer + 89] = section.cy;
    out[tailer + 90] = section.cz;
    out[tailer + 91] = section.unknown & 0xff;
  }

  if (decodedSize !== undefined && decodedSize !== out.length)
    throw new Vxl4Error("The VXL size does not match the size the pack recorded.");
  return out;
}

class Growable {
  private data = new Uint8Array(1024);
  length = 0;

  push(value: number): void {
    if (this.length === this.data.length) {
      const bigger = new Uint8Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length++] = value;
  }

  result(): Uint8Array {
    return this.data.slice(0, this.length);
  }
}

function fixedText(data: Uint8Array, at: number, size: number): string {
  let end = at;
  while (end < at + size && data[end]) end++;
  let text = "";
  for (let i = at; i < end; i++) text += String.fromCharCode(data[i]!);
  return text;
}

function writeFixed(data: Uint8Array, at: number, text: string, size: number): void {
  for (let i = 0; i < size; i++) data[at + i] = i < text.length ? text.charCodeAt(i) & 0xff : 0;
}
