// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import SevenZipFactory from "7z-wasm";
import { describe, expect, it } from "vitest";
import { gameRoot, listArchive, openSevenZip, parseListing, streamArchive } from "./sevenzip";

const wasmBinary = readFileSync(createRequire(import.meta.url).resolve("7z-wasm/7zz.wasm"));
const load = () => openSevenZip(SevenZipFactory, { wasmBinary: wasmBinary.buffer as ArrayBuffer });

/** An archive made by 7-Zip itself, of these files, at `/a.<type>`. */
async function archive(files: Record<string, Uint8Array | string>, type = "7z") {
  const zip = await load();
  const { FS } = zip.module;
  FS.mkdir("/src");
  for (const [path, data] of Object.entries(files)) {
    let dir = "/src";
    for (const part of path.split("/").slice(0, -1)) {
      dir += `/${part}`;
      try {
        FS.mkdir(dir);
      } catch {
        // there already
      }
    }
    FS.writeFile(`/src/${path}`, data);
  }
  FS.chdir("/src");
  zip.module.callMain([
    "a",
    `-t${type}`,
    "-bsp0",
    "-bso0",
    `/a.${type}`,
    ...FS.readdir("/src").slice(2),
  ]);
  FS.chdir("/");
  return { zip, path: `/a.${type}` };
}

const bytes = (size: number, seed: number) => {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = (i * seed) & 255;
  return data;
};

describe("parseListing", () => {
  it("reads files from 7-Zip's technical listing, past progress noise, without folders", () => {
    const lines = [
      "  0M Scan /\b\b\b\b           \b\b\b\bPath = Red Alert 2",
      "Size = 0",
      "Attributes = D drwxrwxrwx",
      "",
      "Path = Red Alert 2/ra2.mix",
      "Size = 1000",
      "Modified = 2026-11-07 16:04:44.0000000",
      "Attributes = A -rw-rw-rw-",
      "",
      "Path = Red Alert 2/empty.ini",
      "Size = 0",
      "Attributes = A -rw-rw-rw-",
    ];
    expect(parseListing(lines)).toEqual([
      { path: "Red Alert 2/ra2.mix", size: 1000, modified: Date.parse("2026-11-07T16:04:44Z") },
      { path: "Red Alert 2/empty.ini", size: 0, modified: 0 },
    ]);
  });
});

describe("gameRoot", () => {
  const entry = (path: string) => ({ path, size: 1, modified: 0 });
  it("is the folder that holds ra2.mix, at any depth", () => {
    expect(gameRoot([entry("Setup/readme.txt"), entry("Setup/Game/RA2.MIX")])).toBe("Setup/Game/");
    expect(gameRoot([entry("ra2.mix"), entry("Mods/x/ra2.mix")])).toBe("");
  });
  it("is a single top folder when there is no ra2.mix, else the top", () => {
    expect(gameRoot([entry("RA2/a.mix"), entry("RA2/b.mix")])).toBe("RA2/");
    expect(gameRoot([entry("a.mix"), entry("RA2/b.mix")])).toBe("");
  });
});

describe("7-Zip", () => {
  it("lists an archive's files with their sizes", async () => {
    const { zip, path } = await archive({
      "Red Alert 2/ra2.mix": bytes(5000, 3),
      "Red Alert 2/Mods/Lite/rulesmd.ini": "x=1",
    });
    expect(
      listArchive(zip, path)
        .map(({ path, size }) => ({ path, size }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    ).toEqual([
      { path: "Red Alert 2/Mods/Lite/rulesmd.ini", size: 3 },
      { path: "Red Alert 2/ra2.mix", size: 5000 },
    ]);
  });

  it("streams the chosen files in one pass, each whole, in the archive's order", async () => {
    const files = {
      "a.ini": "a=1",
      "b.mix": bytes(300_000, 7),
      "empty.ini": "",
      "c.mix": bytes(70_000, 11),
      "skip.mix": bytes(50_000, 13),
    };
    const { zip, path } = await archive(files);
    const entries = listArchive(zip, path);
    const wanted = entries.filter((entry) => entry.path !== "skip.mix");
    // length and a checksum: a diff of arrays this long would take minutes to print
    const sum = (data: Uint8Array) =>
      data.reduce((total, byte, at) => (total + byte * (at + 1)) % 1e9, 0);
    const got = new Map<string, { size: number; sum: number; at: number }>();
    const finished: string[] = [];
    streamArchive(zip, path, wanted, (name, chunk, last) => {
      const seen = got.get(name) ?? { size: 0, sum: 0, at: 0 };
      chunk.forEach((byte) => {
        seen.at++;
        seen.sum = (seen.sum + byte * seen.at) % 1e9;
      });
      seen.size += chunk.length;
      got.set(name, seen);
      if (last) finished.push(name);
    });
    expect(finished).toEqual(wanted.map((entry) => entry.path));
    for (const entry of wanted) {
      const data = files[entry.path as keyof typeof files];
      const expected = typeof data === "string" ? new TextEncoder().encode(data) : data;
      expect(got.get(entry.path) ?? { size: 0, sum: 0 }, entry.path).toMatchObject({
        size: expected.length,
        sum: sum(expected),
      });
    }
    expect(got.has("skip.mix")).toBe(false);
  });

  it("reads a zip the same way", async () => {
    const { zip, path } = await archive({ "RA2/ra2.mix": bytes(1000, 5) }, "zip");
    const [entry] = listArchive(zip, path);
    let size = 0;
    streamArchive(zip, path, [entry!], (_, chunk) => (size += chunk.length));
    expect(size).toBe(1000);
  });

  it("says when a file is not an archive it can open", async () => {
    const zip = await load();
    zip.module.FS.writeFile("/setup.exe", bytes(4000, 1));
    expect(() => listArchive(zip, "/setup.exe")).toThrow(/cannot open/i);
  });
});
