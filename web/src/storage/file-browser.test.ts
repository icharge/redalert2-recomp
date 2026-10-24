import { beforeEach, describe, expect, it, vi } from "vitest";
import { readGameFile } from "./opfs";
import type { GameRecord } from "./manifest";
import type { FsLike } from "./saves";
import { importedFileSource, liveGameFileSource } from "./file-browser";

vi.mock("./opfs", () => ({
  readGameFile: vi.fn(async () => new TextEncoder().encode("[Video]\nScreenWidth=640")),
}));

const game: GameRecord = {
  id: "ra2md",
  slot: 1,
  storage: "ra2md",
  title: "Yuri's Revenge",
  exeStamp: 1,
  importedAt: 1,
  bytes: 100,
  complete: false,
  files: {
    "rulesmd.ini": { size: 20, lastModified: 10, done: true, needs: ["ra2md"], home: "ra2md" },
    "maps/readme.txt": { size: 30, lastModified: 11, done: true, needs: ["ra2md"], home: "ra2" },
    "unfinished.ini": {
      size: 40,
      lastModified: 12,
      done: false,
      needs: ["ra2md"],
      home: "ra2md",
    },
  },
};

const directory = 0x4000;
const regular = 0x8000;

function fakeFs(): FsLike {
  const tree = new Map([
    ["/game", { mode: directory, names: ["rules.ini", "maps", "debug.log"] }],
    ["/game/maps", { mode: directory, names: ["readme.txt"] }],
    ["/game/rules.ini", { mode: regular, names: [], bytes: "[Video]\nWidth=800" }],
    ["/game/debug.log", { mode: regular, names: [], bytes: "running" }],
    ["/game/maps/readme.txt", { mode: regular, names: [], bytes: "Map notes" }],
  ]);
  return {
    readdir: (path) => {
      const node = tree.get(path);
      if (!node || node.mode !== directory) throw new Error(`not a directory: ${path}`);
      return [".", "..", ...node.names];
    },
    stat: (path) => {
      const node = tree.get(path);
      if (!node) throw new Error(`not found: ${path}`);
      return { mode: node.mode, size: node.bytes?.length ?? 0, mtime: new Date(1) };
    },
    isDir: (mode) => mode === directory,
    readFile: (path) => {
      const node = tree.get(path);
      if (!node?.bytes) throw new Error(`not a file: ${path}`);
      return new TextEncoder().encode(node.bytes);
    },
    writeFile: () => {
      throw new Error("the browser should not write files");
    },
    mkdir: () => {
      throw new Error("the browser should not create folders");
    },
  };
}

describe("imported game file browser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists only completed imported files and derives folders", async () => {
    const source = importedFileSource(game);
    expect((await source.list("")).map(({ name, type }) => [name, type]).sort()).toEqual([
      ["maps", "folder"],
      ["rulesmd.ini", "file"],
    ]);
    expect(await source.list("maps")).toEqual([
      { name: "readme.txt", type: "file", size: 30, modified: 11 },
    ]);
  });

  it("opens known text files from the file's shared OPFS home", async () => {
    const source = importedFileSource(game);
    expect(await source.readText("rulesmd.ini")).toContain("ScreenWidth=640");
    expect(readGameFile).toHaveBeenCalledWith("ra2md", "rulesmd.ini");
    expect(await source.readText("maps/readme.txt")).toContain("ScreenWidth=640");
    expect(readGameFile).toHaveBeenCalledWith("ra2", "maps/readme.txt");
  });

  it("does not open binaries, unfinished files, or paths outside the import", async () => {
    const source = importedFileSource(game);
    await expect(source.readText("unfinished.ini")).rejects.toThrow(/completed import/);
    await expect(source.readText("rulesmd.mix")).rejects.toThrow(/not in this game's/);
    await expect(source.readText("../rulesmd.ini")).rejects.toThrow(/not part of/);
  });
});

describe("live VFS file browser", () => {
  it("lists and reads only within /game", async () => {
    const fs = fakeFs();
    const source = liveGameFileSource(fs, "Yuri's Revenge");
    expect((await source.list("")).map(({ name, type }) => [name, type]).sort()).toEqual([
      ["debug.log", "file"],
      ["maps", "folder"],
      ["rules.ini", "file"],
    ]);
    expect(await source.readText("maps/readme.txt")).toBe("Map notes");
    await expect(source.list("../outside")).rejects.toThrow(/not part of/);
    await expect(source.readText("../../outside.txt")).rejects.toThrow(/not part of/);
  });
});
