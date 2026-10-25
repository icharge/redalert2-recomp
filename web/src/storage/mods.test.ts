import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { Manifest } from "./manifest";
import { importMod, listMods, loadMods, removeMod } from "./mods";
import type { CopyTarget } from "./opfs";
import type { FolderSource } from "./importer";

const folder = (name: string, names = ["rulesmd.ini"]): FolderSource => ({
  name,
  list: async () =>
    names.map((path) => ({
      path,
      size: 4,
      lastModified: 0,
      head: async () => new Uint8Array(4),
      stream: () =>
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(4));
            c.close();
          },
        }),
    })),
});
function target() {
  const files = new Set<string>();
  const copy: CopyTarget = {
    write: async (p) => {
      files.add(p);
    },
    size: async () => 4,
    remove: async (p) => {
      files.delete(p);
    },
  };
  return { copy, files };
}
describe("mods", () => {
  it("copies a separate mod folder, records it only when complete, and removes only its files", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const { copy, files } = target();
    files.add("game/ra2md/rulesmd.ini");
    const mod = await importMod(folder("Fast Tanks"), "ra2md", manifest, copy);
    expect(files.has("game/ra2md/mods/Fast Tanks/rulesmd.ini")).toBe(true);
    expect(await listMods(manifest, "ra2md")).toEqual([mod]);
    expect(await listMods(manifest, "ra2")).toEqual([]);
    await removeMod(manifest, copy, "ra2md", mod);
    expect([...files]).toEqual(["game/ra2md/rulesmd.ini"]);
    manifest.close();
  });
  it("refuses patch DLLs, unsafe names, case collisions and duplicate imports", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const { copy } = target();
    await expect(importMod(folder("../escape"), "ra2md", manifest, copy)).rejects.toThrow(
      "folder name",
    );
    await expect(
      importMod(folder("Phobos", ["rulesmd.ini", "Phobos.dll"]), "ra2md", manifest, copy),
    ).rejects.toThrow("executable patches");
    await expect(
      importMod(folder("Duplicate", ["rules.ini", "RULES.INI"]), "ra2md", manifest, copy),
    ).rejects.toThrow("capitalisation");
    await importMod(folder("Test"), "ra2md", manifest, copy);
    await expect(importMod(folder("test"), "ra2md", manifest, copy)).rejects.toThrow(
      "already imported",
    );
    manifest.close();
  });
  it("cleans up a short copy without recording a playable mod", async () => {
    const manifest = await Manifest.open(new IDBFactory());
    const { copy, files } = target();
    copy.size = async () => 1;
    await expect(importMod(folder("Broken"), "ra2md", manifest, copy)).rejects.toThrow("changed");
    expect(files.size).toBe(0);
    expect(await listMods(manifest, "ra2md")).toEqual([]);
    manifest.close();
  });
});

describe("loadMods", () => {
  it("links a big mod file to its copy in OPFS and copies the small ones", async () => {
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    const manifest = await Manifest.open(factory);
    await manifest.setSetting("mods:slot-1-ra2md", [
      { name: "Big", files: [{ name: "big.mix", size: 5_000_000 }, { name: "rulesmd.ini", size: 4 }], bytes: 5_000_004 },
    ]);
    manifest.close();
    const made: string[] = [];
    const links: string[][] = [];
    const written: string[] = [];
    const fs = {
      readdir: () => [],
      stat: () => ({ mode: 0, size: 0, mtime: 0 }),
      readFile: () => new Uint8Array(),
      writeFile: (path: string) => void written.push(path),
      mkdir: (path: string) => void made.push(path),
      symlink: (target: string, path: string) => void links.push([target, path]),
    };
    // the small file's bytes come from OPFS, which this test has no files in
    await loadMods(fs, "slot-1-ra2md", { inPlace: true }).catch(() => {}).finally(() => vi.unstubAllGlobals());
    expect(links).toEqual([["/opfs/game/slot-1-ra2md/mods/Big/big.mix", "/game/mods/Big/big.mix"]]);
    expect(written).not.toContain("/game/mods/Big/big.mix");
  });
});
