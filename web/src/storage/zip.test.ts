import { describe, expect, it } from "vitest";
import { crc32, readZip, safePath, writeZip } from "./zip";

const text = (s: string) => new TextEncoder().encode(s);
const read = (data: Uint8Array) => new TextDecoder().decode(data);

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("writeZip and readZip", () => {
  it("round-trips files with folders in their names, and non-ASCII names", async () => {
    const files = [
      { path: "Saved Games/one.sav", data: text("save one") },
      { path: "Saved Games/ünï.sav", data: new Uint8Array([0, 1, 2, 255]) },
      { path: "empty.txt", data: new Uint8Array(0) },
    ];
    const back = await readZip(writeZip(files, new Date(2026, 9, 18, 12, 30, 10)));
    expect(back.map((f) => f.path)).toEqual(files.map((f) => f.path));
    expect(read(back[0]!.data)).toBe("save one");
    expect([...back[1]!.data]).toEqual([0, 1, 2, 255]);
    expect(back[2]!.data.length).toBe(0);
  });

  it("reads a deflated entry, as a zip made by a tool has", async () => {
    const original = text("a deflated save ".repeat(50));
    const packed = new Uint8Array(
      await new Response(
        new Response(original as BodyInit).body!.pipeThrough(new CompressionStream("deflate-raw")),
      ).arrayBuffer(),
    );
    // a zip with one deflated entry, built by hand from the stored one
    const stored = writeZip([{ path: "a.sav", data: original }]);
    const view = new DataView(stored.buffer);
    const name = text("a.sav");
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, view.getUint32(14, true), true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, original.length, true);
    local.setUint16(26, name.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, 8, true);
    central.setUint32(16, view.getUint32(14, true), true);
    central.setUint32(20, packed.length, true);
    central.setUint32(24, original.length, true);
    central.setUint16(28, name.length, true);
    const dir = 30 + name.length + packed.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, 1, true);
    end.setUint16(10, 1, true);
    end.setUint32(12, 46 + name.length, true);
    end.setUint32(16, dir, true);
    const parts = [
      new Uint8Array(local.buffer),
      name,
      packed,
      new Uint8Array(central.buffer),
      name,
      new Uint8Array(end.buffer),
    ];
    const zip = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      zip.set(p, at);
      at += p.length;
    }
    const back = await readZip(zip);
    expect(read(back[0]!.data)).toBe(read(original));
  });

  it("refuses what is not a zip, and a file whose checksum is wrong", async () => {
    await expect(readZip(text("not a zip at all, just text"))).rejects.toThrow(/not a zip/);
    const zip = writeZip([{ path: "a.sav", data: text("hello") }]);
    zip[30 + 5] = (zip[30 + 5] ?? 0) ^ 0xff; // a byte of the data
    await expect(readZip(zip)).rejects.toThrow(/checksum/);
  });

  it("leaves out folders and paths that climb out", async () => {
    const zip = writeZip([
      { path: "good.sav", data: text("a") },
      { path: "../evil.sav", data: text("b") },
      { path: "/abs.sav", data: text("c") },
      { path: "C:/win.sav", data: text("d") },
      { path: "a/../../x.sav", data: text("e") },
    ]);
    expect((await readZip(zip)).map((f) => f.path)).toEqual(["good.sav"]);
    expect(safePath("Saved Games/x.sav")).toBe(true);
    expect(safePath("dir/")).toBe(false);
  });
});
