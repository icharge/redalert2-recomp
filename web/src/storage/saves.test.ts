import { afterEach, describe, expect, it } from "vitest";
import type { CopyTarget } from "./opfs";
import {
  exportSaves,
  importSaves,
  isDirectory,
  isSavePath,
  modifiedMs,
  replaceFile,
  restoreSaves,
  startSaveSync,
  type FsLike,
  type SaveStore,
} from "./saves";
import { writeZip } from "./zip";

/** A tiny in-memory file system, enough for FsLike: paths under /game. */
function fakeFs(initial: Record<string, string> = {}) {
  const files = new Map<string, { data: Uint8Array; mtime: number }>();
  const dirs = new Set<string>(["/game"]);
  let clock = 1000;
  const put = (path: string, text: string) => {
    files.set(path, { data: new TextEncoder().encode(text), mtime: ++clock });
    for (let at = path.lastIndexOf("/"); at > 5; at = path.lastIndexOf("/", at - 1))
      dirs.add(path.slice(0, at));
  };
  for (const [path, text] of Object.entries(initial)) put(path, text);
  const fs: FsLike = {
    readdir(path) {
      const prefix = `${path}/`;
      const names = new Set<string>();
      for (const key of [...files.keys(), ...dirs]) {
        if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0] ?? "");
      }
      return [".", "..", ...names];
    },
    stat(path) {
      if (dirs.has(path)) return { mode: 1, size: 0, mtime: new Date(0) };
      const file = files.get(path);
      if (!file) throw new Error("ENOENT");
      return { mode: 0, size: file.data.length, mtime: new Date(file.mtime) };
    },
    isDir: (mode) => mode === 1,
    readFile(path) {
      const file = files.get(path);
      if (!file) throw new Error("ENOENT");
      return file.data;
    },
    writeFile: (path, data) => void put(path, new TextDecoder().decode(data)),
    mkdir: (path) => void dirs.add(path),
  };
  return { fs, put, files };
}

function memoryTarget(): CopyTarget & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async write(path, stream) {
      const reader = stream.getReader();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      files.set(path, text);
    },
    async size(path) {
      return files.get(path)?.length ?? null;
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

let stop: (() => void) | null = null;
afterEach(() => stop?.());

describe("startSaveSync", () => {
  it("never saves runtime binaries staged after the watcher starts", async () => {
    const game = fakeFs();
    const target = memoryTarget();
    const sync = startSaveSync(game.fs, target, "ra2md", 1e9);
    stop = sync.stop;
    game.put("/game/GAMEMD.EXE", "bundled runtime");
    game.put("/game/Blowfish.dll", "bundled tables");
    game.put("/game/SAVE0001.sav", "saved match");

    expect(await sync.flush()).toBe(1);
    expect([...target.files.keys()]).toEqual(["save/ra2md/SAVE0001.sav"]);
  });

  it("persists host settings separately from the game's RA2.INI", async () => {
    const game = fakeFs({ "/game/RA2.INI": "[Video]" });
    const target = memoryTarget();
    const sync = startSaveSync(game.fs, target, "ra2");
    stop = sync.stop;
    game.put("/game/.host/ra2.ini", "[present]\ncontrols=modern");
    await sync.flush();
    expect([...target.files.keys()]).toEqual(["save/ra2/.host/ra2.ini"]);
    expect(new TextDecoder().decode(game.fs.readFile("/game/RA2.INI"))).toBe("[Video]");
  });
  it("keeps each mod's saves and settings apart from the base game and other mods", async () => {
    const game = fakeFs({ "/game/mods/Alpha/rulesmd.ini": "rules" });
    const target = memoryTarget();
    const sync = startSaveSync(game.fs, target, "ra2md");
    stop = sync.stop;
    game.put("/game/mods/Alpha/RA2MD.INI", "alpha settings");
    game.put("/game/mods/Alpha/Saved Games/slot.sav", "alpha save");
    game.put("/game/mods/Beta/Saved Games/slot.sav", "beta save");
    game.put("/game/Saved Games/slot.sav", "base save");
    await sync.flush();
    expect(target.files.get("save/ra2md/mods/Alpha/Saved Games/slot.sav")).toBe("alpha save");
    expect(target.files.get("save/ra2md/mods/Beta/Saved Games/slot.sav")).toBe("beta save");
    expect(target.files.get("save/ra2md/Saved Games/slot.sav")).toBe("base save");
    expect(target.files.has("save/ra2md/mods/Alpha/rulesmd.ini")).toBe(false);
  });
  it("keeps a new or changed file, not the game's own, and not a log", async () => {
    const game = fakeFs({ "/game/ra2.mix": "archive", "/game/RA2MD.INI": "[Video]" });
    const target = memoryTarget();
    const sync = startSaveSync(game.fs, target, "ra2md", 1e9);
    stop = sync.stop;
    expect(await sync.flush()).toBe(0);

    game.put("/game/Saved Games/one.sav", "save one");
    game.put("/game/RA2MD.INI", "[Video]\nScreenWidth=800");
    game.put("/game/DEBUG.LOG", "noise");
    expect(await sync.flush()).toBe(2);
    expect([...target.files.keys()].sort()).toEqual([
      "save/ra2md/RA2MD.INI",
      "save/ra2md/Saved Games/one.sav",
    ]);
    expect(target.files.get("save/ra2md/Saved Games/one.sav")).toBe("save one");
    expect(target.files.get("save/ra2md/RA2MD.INI")).toBe("[Video]\nScreenWidth=800");

    expect(await sync.flush()).toBe(0);
    game.put("/game/Saved Games/one.sav", "save one, again");
    expect(await sync.flush()).toBe(1);
    expect(target.files.get("save/ra2md/Saved Games/one.sav")).toBe("save one, again");
  });

  it("leaves a file the game is still writing for the next look", async () => {
    const game = fakeFs();
    const target = memoryTarget();
    const sync = startSaveSync(game.fs, target, "ra2md", 1e9);
    stop = sync.stop;
    game.put("/game/Saved Games/big.sav", "part");
    await sync.flush(); // first look notes it; the second would copy it if nothing moved
    game.put("/game/Saved Games/big.sav", "part and more");
    // the file moved between looks: this flush's first look sees a change, its second agrees with the first
    expect(await sync.flush()).toBe(1);
    expect(target.files.get("save/ra2md/Saved Games/big.sav")).toBe("part and more");
  });
});

describe("restoreSaves", () => {
  it("removes stale runtime binaries from the save store without restoring them", async () => {
    const game = fakeFs({ "/game/gamemd.exe": "current runtime" });
    const target = memoryTarget();
    target.files.set("save/ra2md/gamemd.exe", "stale runtime");
    target.files.set("save/ra2md/Blowfish.dll", "stale tables");
    const store: SaveStore = {
      async list() {
        return [
          { path: "gamemd.exe", read: async () => new TextEncoder().encode("stale runtime") },
          { path: "Blowfish.dll", read: async () => new TextEncoder().encode("stale tables") },
          { path: "RA2MD.INI", read: async () => new TextEncoder().encode("saved settings") },
        ];
      },
    };

    expect(await restoreSaves(game.fs, store, "ra2md", () => true, target)).toBe(1);
    expect(new TextDecoder().decode(game.fs.readFile("/game/gamemd.exe"))).toBe("current runtime");
    expect(new TextDecoder().decode(game.fs.readFile("/game/RA2MD.INI"))).toBe("saved settings");
    expect([...target.files.keys()]).toEqual([]);
  });

  it("puts the saved files back over the game's, making the folders", async () => {
    const game = fakeFs({ "/game/RA2MD.INI": "default" });
    const store: SaveStore = {
      async list() {
        return [
          { path: "RA2MD.INI", read: async () => new TextEncoder().encode("mine") },
          { path: "Saved Games/one.sav", read: async () => new TextEncoder().encode("save") },
        ];
      },
    };
    expect(await restoreSaves(game.fs, store, "ra2md")).toBe(2);
    expect(new TextDecoder().decode(game.fs.readFile("/game/RA2MD.INI"))).toBe("mine");
    expect(new TextDecoder().decode(game.fs.readFile("/game/Saved Games/one.sav"))).toBe("save");
  });
});

describe("exportSaves and importSaves", () => {
  const store = (files: Record<string, string>): SaveStore => ({
    async list() {
      return Object.entries(files).map(([path, text]) => ({
        path,
        read: async () => new TextEncoder().encode(text),
      }));
    },
  });

  it("zips the saved games, not the settings, and takes them back in beside the exe", async () => {
    const zip = await exportSaves(
      store({
        "SAVE0001.sav": "one",
        "Saved Games/two.sav": "two",
        "RA2MD.INI": "[Video]",
        "mods/Alpha/x.sav": "a mod's",
      }),
      "ra2md",
    );
    expect(zip).not.toBeNull();
    const { readZip } = await import("./zip");
    expect((await readZip(zip!)).map((file) => file.path).sort()).toEqual([
      "SAVE0001.sav",
      "Saved Games/two.sav",
    ]);
    const target = memoryTarget();
    expect(await importSaves(zip!, target, "ra2md")).toBe(2);
    expect([...target.files.keys()].sort()).toEqual([
      "save/ra2md/SAVE0001.sav",
      "save/ra2md/two.sav",
    ]);
    expect(target.files.get("save/ra2md/two.sav")).toBe("two");
  });

  it("adds the saves that came with the import, and a newer save of the same name wins", async () => {
    const read = (text: string) => async () => new TextEncoder().encode(text);
    const zip = await exportSaves(store({ "SAVE0001.sav": "newer" }), "ra2md", [
      { path: "save0001.SAV", read: read("older") },
      { path: "SAVE0002.sav", read: read("imported") },
      { path: "rules.ini", read: read("not a save") },
    ]);
    const { readZip } = await import("./zip");
    const files = await readZip(zip!);
    expect(files.map((file) => file.path).sort()).toEqual(["SAVE0001.sav", "SAVE0002.sav"]);
    expect(new TextDecoder().decode(files.find((f) => f.path === "SAVE0001.sav")!.data)).toBe(
      "newer",
    );
  });

  it("knows a saved game by its name", () => {
    expect(isSavePath("SAVE0001.SAV")).toBe(true);
    expect(isSavePath("Saved Games/x.sav")).toBe(true);
    expect(isSavePath("RA2MD.INI")).toBe(false);
    expect(isSavePath("mods/Alpha/x.sav")).toBe(false);
  });

  it("has nothing to export before the first save, and takes a flat zip of saves", async () => {
    expect(await exportSaves(store({ "RA2MD.INI": "x" }), "ra2md")).toBeNull();
    const flat = writeZip([
      { path: "a.sav", data: new TextEncoder().encode("a") },
      { path: "readme.exe", data: new TextEncoder().encode("no") },
      { path: "deep/b.sav", data: new TextEncoder().encode("no") },
    ]);
    const target = memoryTarget();
    expect(await importSaves(flat, target, "ra2md")).toBe(1);
    expect([...target.files.keys()]).toEqual(["save/ra2md/a.sav"]);
  });
});

/** WasmFS's side of FsLike: no isDir, times in seconds, and links into the import in OPFS. */
function linkedFs() {
  const links = new Map<string, string>();
  const files = new Map<string, string>();
  const calls: string[] = [];
  const S_IFREG = 0o100000;
  const S_IFDIR = 0o040000;
  const S_IFLNK = 0o120000;
  const fs: FsLike = {
    readdir: () =>
      [".", "..", ...links.keys(), ...files.keys()].map((p) => p.replace("/game/", "")),
    stat(path) {
      if (links.has(path)) {
        calls.push(`stat ${path}`);
        return { mode: S_IFREG, size: 900_000_000, mtime: 5 };
      }
      if (path === "/game") return { mode: S_IFDIR, size: 0, mtime: 0 };
      const text = files.get(path);
      if (text === undefined) throw new Error("ENOENT");
      return { mode: S_IFREG, size: text.length, mtime: 7 };
    },
    lstat(path) {
      if (links.has(path)) return { mode: S_IFLNK, size: 20, mtime: 5 };
      return fs.stat(path);
    },
    readFile: (path) => new TextEncoder().encode(files.get(path) ?? ""),
    writeFile(path, data) {
      // through a link, as the file system does: the import itself would change
      if (links.has(path)) calls.push(`wrote through ${path}`);
      files.set(path, new TextDecoder().decode(data));
    },
    mkdir: () => {},
    unlink(path) {
      links.delete(path);
      files.delete(path);
    },
    symlink: (target, path) => void links.set(path, target),
  };
  return { fs, links, files, calls };
}

describe("a game folder whose big files are links into the import", () => {
  it("reads WasmFS's stat: directories from the mode, times in seconds", () => {
    const { fs } = linkedFs();
    expect(isDirectory(fs, 0o040755)).toBe(true);
    expect(isDirectory(fs, 0o100644)).toBe(false);
    expect(modifiedMs(7)).toBe(7000);
    expect(modifiedMs(new Date(1234))).toBe(1234);
  });

  it("does not look at a link when it watches for what the game wrote", async () => {
    const game = linkedFs();
    game.links.set("/game/ra2.mix", "/opfs/game/slot-1/ra2.mix");
    game.files.set("/game/ra2md.ini", "[Video]");
    const target = memoryTarget();
    const sync = startSaveSync(game.fs, target, "slot-1-ra2md");
    stop = () => sync.stop();
    game.files.set("/game/SAVE0001.sav", "a save");
    await sync.flush();
    expect([...target.files.keys()]).toEqual(["save/slot-1-ra2md/SAVE0001.sav"]);
    expect(game.calls).toEqual([]);
  });

  it("puts a saved copy over a link by removing the link first", async () => {
    const game = linkedFs();
    game.links.set("/game/game.fnt", "/opfs/game/slot-1/game.fnt");
    replaceFile(game.fs, "/game/game.fnt", new TextEncoder().encode("thai"));
    expect(game.calls).toEqual([]);
    expect(game.links.size).toBe(0);
    expect(game.files.get("/game/game.fnt")).toBe("thai");

    game.links.set("/game/ra2md.ini", "/opfs/game/slot-1/ra2md.ini");
    const store: SaveStore = {
      list: async () => [
        { path: "ra2md.ini", read: async () => new TextEncoder().encode("saved") },
      ],
    };
    await restoreSaves(game.fs, store, "slot-1-ra2md");
    expect(game.calls).toEqual([]);
    expect(game.files.get("/game/ra2md.ini")).toBe("saved");
  });
});
