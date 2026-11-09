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

  it("keeps an imported save listed when its file will not delete, so it can be tried again", async () => {
    const { deps, game, manifest } = await setup();
    const save = (await listSaves(deps, game)).find((s) => s.name === "SAVE0001.SAV")!;
    const stuck = gamePath("slot-1", "SAVE0001.SAV");
    deps.target = {
      ...deps.target,
      async remove(path) {
        if (path === stuck) throw new Error("in use");
      },
    };
    await expect(removeSaves(deps, game, [save])).rejects.toThrow(/could not be deleted/);
    expect((await manifest.getGame("ra2md"))?.files["SAVE0001.SAV"]).toBeDefined();
    expect((await listSaves(deps, game)).map((s) => s.name)).toContain("SAVE0001.SAV");
  });

  it("keeps a file another edition still reads, and forgets only this edition's record", async () => {
    const { deps, game, manifest, removed } = await setup();
    await manifest.beginImport("ra2", "Red Alert 2", 2, [
      { name: "SAVE0001.SAV", size: 20, lastModified: 100, needs: ["ra2" as const] },
    ]);
    const save = (await listSaves(deps, game)).find((s) => s.name === "SAVE0001.SAV")!;
    await removeSaves(deps, game, [save]);
    expect(removed).not.toContain(gamePath("slot-1", "SAVE0001.SAV"));
    expect((await manifest.getGame("ra2md"))?.files["SAVE0001.SAV"]).toBeUndefined();
    expect((await manifest.getGame("ra2"))?.files["SAVE0001.SAV"]).toBeDefined();
  });
});

describe("listSaves: names", () => {
  it("lists a written save and its imported copy once when the names differ only in case", async () => {
    const { deps, game } = await setup({
      "save0002.sav": { text: "DESC written two", modified: 200 },
    });
    const saves = await listSaves(deps, game);
    expect(saves.filter((s) => s.name.toLowerCase() === "save0002.sav")).toHaveLength(1);
    expect(saves[0]).toMatchObject({ name: "save0002.sav", written: true, imported: true });
  });
});

/**
 * A two-edition install as a real import makes it: the same folder save (and the base game's files) sit
 * in the RA2 and the YR record, both naming one `home/name`. `written` is what each edition's own
 * `save/<storage>/` holds.
 */
async function setupInstall(
  written: Record<string, Record<string, { text: string; modified?: number; size?: number }>> = {},
) {
  const manifest = await Manifest.open(new IDBFactory());
  const { slot } = await manifest.createInstallation("Main", []);
  const planned = [
    {
      name: "SAVE0001.SAV",
      size: 20,
      lastModified: 100,
      needs: ["ra2" as const, "ra2md" as const],
    },
  ];
  for (const [id, title] of [
    ["ra2", "Red Alert 2"],
    ["ra2md", "Yuri's Revenge"],
  ] as const) {
    await manifest.beginImport(id, title, 1, planned, slot);
    await manifest.markFileDone(id, "SAVE0001.SAV", slot);
  }
  const editions = [
    (await manifest.getGame("ra2", slot)) as GameRecord,
    (await manifest.getGame("ra2md", slot)) as GameRecord,
  ];
  const { target, removed } = fakeTarget();
  const deps: SaveLibraryDeps = {
    store: {
      list: async (storage) =>
        Object.entries(written[storage] ?? {}).map(([path, file]) => ({
          path,
          size: file.size,
          modified: file.modified,
          read: async () => enc(file.text),
        })),
    },
    manifest,
    target,
    readImported: async () => enc("DESC folder save"),
    readInfo: (data) => ({ description: new TextDecoder().decode(data).replace(/^DESC /, "") }),
  };
  return { deps, manifest, editions, removed, slot, home: `slot-${slot}` };
}

describe("an install with two editions", () => {
  it("lists a folder save both editions hold once, under the first edition", async () => {
    const { deps, editions } = await setupInstall();
    const [ra2, md] = editions as [GameRecord, GameRecord];
    expect((await listSaves(deps, ra2, editions)).map((s) => s.name)).toEqual(["SAVE0001.SAV"]);
    expect(await listSaves(deps, md, editions)).toEqual([]);
  });

  it("still lists a copy the second edition wrote as that edition's own save", async () => {
    const { deps, editions } = await setupInstall({
      "slot-1-ra2md": { "SAVE0001.SAV": { text: "DESC yr copy", modified: 500, size: 12 } },
    });
    const [ra2, md] = editions as [GameRecord, GameRecord];
    const first = await listSaves(deps, ra2, editions);
    expect(first.map((s) => [s.name, s.written, s.imported])).toEqual([
      ["SAVE0001.SAV", false, true],
    ]);
    const second = await listSaves(deps, md, editions);
    expect(second.map((s) => [s.name, s.written, s.imported])).toEqual([
      ["SAVE0001.SAV", true, false],
    ]);
  });

  it("removing the folder save deletes the file once and forgets it in every edition", async () => {
    const { deps, manifest, editions, removed, slot, home } = await setupInstall();
    const [ra2] = editions as [GameRecord, GameRecord];
    const [save] = await listSaves(deps, ra2, editions);
    await removeSaves(deps, ra2, [save!], editions);
    expect(removed.filter((p) => p === gamePath(home, "SAVE0001.SAV"))).toHaveLength(1);
    for (const id of ["ra2", "ra2md"] as const) {
      expect((await manifest.getGame(id, slot))?.files["SAVE0001.SAV"]).toBeUndefined();
    }
    const after = [
      (await manifest.getGame("ra2", slot)) as GameRecord,
      (await manifest.getGame("ra2md", slot)) as GameRecord,
    ];
    expect(await listSaves(deps, after[0]!, after)).toEqual([]);
  });

  it("keeps the file when a record outside this install reads it, but forgets it in both editions", async () => {
    const { deps, manifest, editions, removed, slot, home } = await setupInstall();
    const other = await manifest.createInstallation("Other", []);
    await manifest.beginImport(
      "ra2md",
      "Yuri's Revenge",
      1,
      [{ name: "SAVE0001.SAV", size: 20, lastModified: 999, needs: ["ra2md" as const] }],
      other.slot,
    );
    // the other install's record reads the same home/name
    await manifest.putFiles(other.slot, [
      {
        id: "ra2md",
        name: "SAVE0001.SAV",
        entry: { size: 20, lastModified: 100, done: true, needs: ["ra2md"], home },
      },
    ]);
    const [ra2] = editions as [GameRecord, GameRecord];
    const [save] = await listSaves(deps, ra2, editions);
    await removeSaves(deps, ra2, [save!], editions);
    expect(removed).not.toContain(gamePath(home, "SAVE0001.SAV"));
    for (const id of ["ra2", "ra2md"] as const) {
      expect((await manifest.getGame(id, slot))?.files["SAVE0001.SAV"]).toBeUndefined();
    }
  });

  it("removing a copy the second edition wrote leaves the folder save listed", async () => {
    const { deps, manifest, editions, removed, slot, home } = await setupInstall({
      "slot-1-ra2md": { "SAVE0001.SAV": { text: "DESC yr copy", modified: 500, size: 12 } },
    });
    const [ra2, md] = editions as [GameRecord, GameRecord];
    const [own] = await listSaves(deps, md, editions);
    await removeSaves(deps, md, [own!], editions);
    expect(removed).toEqual(["save/slot-1-ra2md/SAVE0001.SAV"]);
    expect(removed).not.toContain(gamePath(home, "SAVE0001.SAV"));
    expect((await manifest.getGame("ra2", slot))?.files["SAVE0001.SAV"]).toBeDefined();
    expect((await manifest.getGame("ra2md", slot))?.files["SAVE0001.SAV"]).toBeDefined();
    expect((await listSaves(deps, ra2, editions)).map((s) => s.name)).toEqual(["SAVE0001.SAV"]);
  });
});

describe("listSaves: a written save with no size or time", () => {
  it("falls back to the import's size and time, else 0", async () => {
    const { deps, editions } = await setupInstall({
      "slot-1-ra2": { "SAVE0001.SAV": { text: "DESC w" }, "SAVE0009.SAV": { text: "DESC n" } },
    });
    const [ra2] = editions as [GameRecord, GameRecord];
    const saves = await listSaves(deps, ra2, editions);
    expect(saves.find((s) => s.name === "SAVE0001.SAV")).toMatchObject({ size: 20, modified: 100 });
    expect(saves.find((s) => s.name === "SAVE0009.SAV")).toMatchObject({ size: 0, modified: 0 });
  });
});
