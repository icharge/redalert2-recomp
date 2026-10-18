import { afterEach, describe, expect, it } from "vitest";
import type { CopyTarget } from "./opfs";
import { restoreSaves, startSaveSync, type FsLike, type SaveStore } from "./saves";

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
