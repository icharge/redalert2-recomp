import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { Manifest, type GameRecord } from "./manifest";
import { gamePath, type CopyTarget } from "./opfs";
import type { SavedFile, SaveStore } from "./saves";
import { listSaves, readSave, removeSaves, type SaveLibraryDeps } from "./save-library";

const enc = (text: string) => new TextEncoder().encode(text);

/** The game's own copy of the saves, as the game wrote them: `save/<storage>/`. */
function fakeStore(written: Record<string, { text: string; modified: number }>): SaveStore {
  const files: SavedFile[] = Object.entries(written).map(([path, file]) => ({
    path,
    size: file.text.length,
    modified: file.modified,
    read: async () => enc(file.text),
  }));
  return { list: async () => files };
}

/** OPFS as a target that records what was removed. */
function fakeTarget() {
  const removed: string[] = [];
  const target: CopyTarget = {
    async write() {},
    async size() {
      return null;
    },
    async remove(path) {
      removed.push(path);
    },
  };
  return { target, removed };
}

/** The import's copies of the saves, by `home/name`. */
const importedBytes: Record<string, string> = {
  "slot-1/SAVE0001.SAV": "DESC imported one",
  "slot-1/SAVE0002.SAV": "DESC imported two",
  "slot-1/RA2MD.INI": "[Options]",
};

async function setup(written: Record<string, { text: string; modified: number }> = {}) {
  const manifest = await Manifest.open(new IDBFactory());
  const planned = [
    { name: "SAVE0001.SAV", size: 20, lastModified: 100, needs: ["ra2md" as const] },
    { name: "SAVE0002.SAV", size: 20, lastModified: 50, needs: ["ra2md" as const] },
    { name: "RA2MD.INI", size: 9, lastModified: 10, needs: ["ra2md" as const] },
  ];
  await manifest.beginImport("ra2md", "Yuri's Revenge", 1, planned);
  for (const file of planned) await manifest.markFileDone("ra2md", file.name);
  const game = (await manifest.getGame("ra2md")) as GameRecord;
  const { target, removed } = fakeTarget();
  const deps: SaveLibraryDeps = {
    store: fakeStore(written),
    manifest,
    target,
    readImported: async (home, name) => {
      const text = importedBytes[`${home}/${name}`];
      if (text === undefined) throw new Error(`${name} is missing`);
      return enc(text);
    },
    readInfo: (data) => {
      const text = new TextDecoder().decode(data);
      if (text.startsWith("GARBAGE")) throw new Error("not a save");
      return text.startsWith("DESC ") ? { description: text.slice(5) } : null;
    },
  };
  return { deps, game, manifest, removed };
}

describe("listSaves", () => {
  it("lists written and imported saves once each, newest first", async () => {
    const { deps, game } = await setup({
      "SAVE0002.SAV": { text: "DESC written two", modified: 200 },
    });
    const saves = await listSaves(deps, game);
    expect(saves.map((s) => [s.name, s.written, s.imported])).toEqual([
      ["SAVE0002.SAV", true, true],
      ["SAVE0001.SAV", false, true],
    ]);
    expect(saves[0]?.info).toEqual({ description: "written two" });
    expect(saves[0]?.modified).toBe(200);
  });

  it("leaves out files that are not saves, such as RA2MD.INI", async () => {
    const { deps, game } = await setup({
      "RA2MD.INI": { text: "[Options]", modified: 300 },
    });
    const names = (await listSaves(deps, game)).map((s) => s.name);
    expect(names).not.toContain("RA2MD.INI");
    expect(names).toEqual(["SAVE0001.SAV", "SAVE0002.SAV"]);
  });

  it("still lists a save it cannot read, with info null", async () => {
    const { deps, game } = await setup({
      "SAVE0002.SAV": { text: "GARBAGE", modified: 200 },
    });
    importedBytes["slot-1/SAVE0001.SAV"] = "GARBAGE";
    try {
      const saves = await listSaves(deps, game);
      expect(saves.map((s) => [s.name, s.info])).toEqual([
        ["SAVE0002.SAV", null],
        ["SAVE0001.SAV", null],
      ]);
    } finally {
      importedBytes["slot-1/SAVE0001.SAV"] = "DESC imported one";
    }
  });
});

describe("readSave", () => {
  it("reads the written copy over the imported one", async () => {
    const { deps, game } = await setup({
      "SAVE0002.SAV": { text: "DESC written two", modified: 200 },
    });
    const save = (await listSaves(deps, game)).find((s) => s.name === "SAVE0002.SAV")!;
    expect(new TextDecoder().decode(await readSave(deps, game, save))).toBe("DESC written two");
  });

  it("reads an imported save the game has not written", async () => {
    const { deps, game } = await setup();
    const save = (await listSaves(deps, game)).find((s) => s.name === "SAVE0001.SAV")!;
    expect(new TextDecoder().decode(await readSave(deps, game, save))).toBe("DESC imported one");
  });
});

describe("removeSaves", () => {
  it("removes both copies of a save, so it does not come back", async () => {
    const { deps, game, manifest, removed } = await setup({
      "SAVE0002.SAV": { text: "DESC written two", modified: 200 },
    });
    const save = (await listSaves(deps, game)).find((s) => s.name === "SAVE0002.SAV")!;
    await removeSaves(deps, game, [save]);
    expect(removed).toEqual(
      expect.arrayContaining([
        "save/slot-1-ra2md/SAVE0002.SAV",
        gamePath("slot-1", "SAVE0002.SAV"),
      ]),
    );
    expect((await manifest.getGame("ra2md"))?.files["SAVE0002.SAV"]).toBeUndefined();
    expect((await manifest.getGame("ra2md"))?.files["SAVE0001.SAV"]).toBeDefined();
  });

  it("removes an imported save the game has not written from the import", async () => {
    const { deps, game, manifest, removed } = await setup();
    const save = (await listSaves(deps, game)).find((s) => s.name === "SAVE0001.SAV")!;
    await removeSaves(deps, game, [save]);
    expect(removed).toEqual([gamePath("slot-1", "SAVE0001.SAV")]);
    expect((await manifest.getGame("ra2md"))?.files["SAVE0001.SAV"]).toBeUndefined();
  });
});
