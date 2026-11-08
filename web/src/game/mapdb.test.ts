// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { downloadMap, firstZipEntry, searchMaps } from "./mapdb";

/** A zip with one stored file, as MapDB serves them. */
function storedZip(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + nameBytes.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(data, 30 + nameBytes.length);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  return Uint8Array.from([...local, ...central, ...end]);
}

const sha1 = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes.slice().buffer as ArrayBuffer))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

describe("mapdb", () => {
  it("reads the file in a stored zip", async () => {
    const data = new TextEncoder().encode("[Basic]\nName=Test\n");
    const entry = await firstZipEntry(storedZip("x.map", data));
    expect(entry.name).toBe("x.map");
    expect(entry.bytes).toEqual(data);
  });

  it("refuses a file that is not a zip", async () => {
    await expect(firstZipEntry(new Uint8Array(100))).rejects.toThrow("not a zip");
  });

  it("downloads a map once its hash matches the name", async () => {
    const data = new TextEncoder().encode("[Basic]\nName=Test\n");
    const hash = await sha1(data);
    const fetcher = vi.fn(async () => new Response(storedZip(`${hash}.map`, data) as BodyInit));
    await expect(downloadMap(hash, undefined, fetcher as never)).resolves.toEqual(data);
    const wrong = "0".repeat(40);
    await expect(downloadMap(wrong, undefined, fetcher as never)).rejects.toThrow("hash");
  });

  it("lists the maps that have a file hash", async () => {
    const body = {
      results: [
        {
          id: "1",
          map_name: "Lake",
          latest_map_file_hash: "a".repeat(40),
          is_published: false,
          incomplete_upload: true,
          is_temporary: false,
        },
        { id: "2", map_name: "No file", latest_map_file_hash: null, is_published: true },
      ],
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(body)));
    const found = await searchMaps("lake", undefined, fetcher as never);
    expect(found).toEqual([
      { id: "1", name: "Lake", sha1: "a".repeat(40), published: false, incomplete: true },
    ]);
  });
});
