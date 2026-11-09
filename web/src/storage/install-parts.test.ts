import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { pickActiveInstall, type ActiveInstall } from "./active-install";
import { measureParts, prepareReinstall, removeParts } from "./install-parts";
import { listMods } from "./mods";
import type { GameId } from "./install";
import { Manifest, type PlannedFile } from "./manifest";
import { gamePath, type CopyTarget } from "./opfs";
import type { SaveLibraryDeps } from "./save-library";

/** A file the game wrote since the import, in the save/<storage>/ of an edition. */
interface Written {
  edition: GameId;
  path: string;
  size: number;
}

/** OPFS as a target: what it removed, and the paths that fail to delete with the error given. */
function fakeTarget() {
  const removed: string[] = [];
  const failures = new Map<string, unknown>();
  const target: CopyTarget = {
    async write() {},
    async size() {
      return null;
    },
    async remove(path) {
      const failure = failures.get(path);
      if (failure !== undefined) throw failure;
      removed.push(path);
    },
  };
  return {
    target,
    removed,
    failOn: (path: string, error: unknown) => failures.set(path, error),
  };
}

const file = (name: string, size: number, needs: GameId[]): PlannedFile => ({
  name,
  size,
  lastModified: 1,
  needs,
});

/**
 * One installation with two editions, RA2 and Yuri's Revenge, imported from a folder. Yuri's
 * Revenge also has a map, a settings file and a save from the import; a mod is brought in its
 * storage. `shared` adds a map both editions read, kept once in the first edition's folder.
 */
async function setup(options: { written?: Written[]; shared?: boolean } = {}) {
  const manifest = await Manifest.open(new IDBFactory());
  const { slot } = await manifest.createInstallation("Main", []);
  const home = `slot-${slot}`;
  const shared = options.shared ?? false;
  const ra2 = [
    file("b.mix", 1000, ["ra2"]),
    ...(shared ? [file("shared.map", 5, ["ra2", "ra2md"])] : []),
  ];
  const md = [
    file("a.mix", 1000, ["ra2md"]),
    file("a.yrm", 18, ["ra2md"]),
    file("RA2MD.INI", 4, ["ra2md"]),
    file("SAVE0001.SAV", 9, ["ra2md"]),
    ...(shared ? [file("shared.map", 5, ["ra2", "ra2md"])] : []),
  ];
  for (const [id, title, planned] of [
    ["ra2", "Red Alert 2", ra2],
    ["ra2md", "Yuri's Revenge", md],
  ] as const) {
    await manifest.beginImport(id, title, 1, planned, slot);
    for (const entry of planned) await manifest.markFileDone(id, entry.name, slot);
  }
  await manifest.setSetting(`mods:${home}-ra2md`, [
    { name: "Big", files: [{ name: "x.ini", size: 140 }], bytes: 140 },
  ]);

  const { target, removed, failOn } = fakeTarget();
  const written = options.written ?? [];
  const deps: SaveLibraryDeps = {
    // what the game wrote and what is still there: a removed file is gone from the store too
    store: {
      list: async (storage) =>
        written
          .filter(
            (entry) =>
              `${home}-${entry.edition}` === storage &&
              !removed.includes(`save/${storage}/${entry.path}`),
          )
          .map((entry) => ({
            path: entry.path,
            size: entry.size,
            modified: 1,
            read: async () => new Uint8Array(),
          })),
    },
    manifest,
    target,
    readImported: async () => new Uint8Array(),
    readInfo: () => null,
  };
  return { deps, manifest, slot, home, removed, failOn };
}

/** The installation as the launcher sees it now, with its editions in RA2, YR order. */
async function activeOf(manifest: Manifest, slot: number): Promise<ActiveInstall> {
  return pickActiveInstall(await manifest.listInstallations(), await manifest.listGames(), slot)!;
}

describe("measureParts", () => {
  it("measures each part of a two-edition install", async () => {
    const { deps, manifest, slot } = await setup();
    expect(await measureParts(deps, await activeOf(manifest, slot))).toEqual({
      game: 2000,
      mods: 140,
      maps: 18,
      saves: 9,
      settings: 4,
    });
  });

  it("counts a settings file the game wrote, and leaves a save it wrote in saves", async () => {
    const { deps, manifest, slot } = await setup({
      written: [
        { edition: "ra2md", path: "RA2MD.INI", size: 6 },
        { edition: "ra2md", path: "SAVE0002.SAV", size: 7 },
      ],
    });
    const sizes = await measureParts(deps, await activeOf(manifest, slot));
    expect(sizes.settings).toBe(4 + 6);
    expect(sizes.saves).toBe(9 + 7);
  });
});

describe("removeParts", () => {
  it("removes only the ticked parts", async () => {
    const { deps, manifest, slot } = await setup();
    await removeParts(deps, await activeOf(manifest, slot), ["maps", "mods"]);
    const after = await measureParts(deps, await activeOf(manifest, slot));
    expect(after).toMatchObject({ maps: 0, mods: 0, saves: 9, settings: 4 });
  });

  it("removing only the game deletes the game's files and keeps the install's other parts", async () => {
    const { deps, manifest, slot, home, removed } = await setup();
    await removeParts(deps, await activeOf(manifest, slot), ["game"]);
    // only the game content: no map, save, settings or mod file
    expect(removed.sort()).toEqual([gamePath(home, "a.mix"), gamePath(home, "b.mix")].sort());
    const install = await activeOf(manifest, slot);
    expect(install.editions.map((game) => [game.id, game.storage])).toEqual([
      ["ra2", `${home}-ra2`],
      ["ra2md", `${home}-ra2md`],
    ]);
    expect((await manifest.getGame("ra2md", slot))?.files["a.mix"]?.done).toBe(false);
    expect((await manifest.getGame("ra2", slot))?.files["b.mix"]?.done).toBe(false);
    expect(await listMods(manifest, `${home}-ra2md`)).toHaveLength(1);
    expect(await measureParts(deps, install)).toEqual({
      game: 0,
      mods: 140,
      maps: 18,
      saves: 9,
      settings: 4,
    });
  });

  it("removing every part removes the installation", async () => {
    const { deps, manifest, slot } = await setup();
    await removeParts(deps, await activeOf(manifest, slot), [
      "settings",
      "saves",
      "maps",
      "mods",
      "game",
    ]);
    expect(await manifest.getGame("ra2", slot)).toBeUndefined();
    expect(await manifest.getGame("ra2md", slot)).toBeUndefined();
    expect(await manifest.listInstallations()).toEqual([]);
  });

  it("removing game content keeps saves and settings in save/<storage>/", async () => {
    const { deps, manifest, slot, removed } = await setup({
      written: [
        { edition: "ra2md", path: "SAVE0002.SAV", size: 7 },
        { edition: "ra2md", path: "RA2MD.INI", size: 6 },
      ],
    });
    await removeParts(deps, await activeOf(manifest, slot), ["game"]);
    expect(removed.some((p) => p.startsWith("save/"))).toBe(false);
  });

  it("removes game content last, after the parts that need its records", async () => {
    const { deps, manifest, slot, home, removed } = await setup({
      written: [{ edition: "ra2md", path: "SAVE0002.SAV", size: 7 }],
    });
    await removeParts(deps, await activeOf(manifest, slot), ["game", "saves", "mods"]);
    const lastSave = removed.findLastIndex((p) => p.startsWith("save/"));
    const firstGame = removed.findIndex((p) => p === gamePath(home, "a.mix"));
    expect(lastSave).toBeGreaterThanOrEqual(0);
    expect(firstGame).toBeGreaterThan(lastSave);
  });

  it("reports a file it could not remove and leaves the rest removed", async () => {
    const { deps, manifest, slot, home, failOn } = await setup();
    // a second map that deletes fine, beside the one that will not
    await manifest.putFiles(slot, [
      {
        id: "ra2md",
        name: "c.yrm",
        entry: { size: 2, lastModified: 1, done: true, needs: ["ra2md"], home },
      },
    ]);
    failOn(gamePath(home, "a.yrm"), new DOMException("held", "NoModificationAllowedError"));
    await expect(
      removeParts(deps, await activeOf(manifest, slot), ["maps", "mods"]),
    ).rejects.toThrow(/in use/);
    const yr = await manifest.getGame("ra2md", slot);
    expect(yr?.files["c.yrm"]).toBeUndefined();
    expect(yr?.files["a.yrm"]?.done).toBe(true);
    const after = await measureParts(deps, await activeOf(manifest, slot));
    expect(after).toMatchObject({ mods: 0, maps: 18 });
  });

  it("removes a settings file the game wrote, and the import's copy of it", async () => {
    const { deps, manifest, slot, home, removed } = await setup({
      written: [{ edition: "ra2md", path: "RA2MD.INI", size: 6 }],
    });
    await removeParts(deps, await activeOf(manifest, slot), ["settings"]);
    expect(removed).toEqual(
      expect.arrayContaining([`save/${home}-ra2md/RA2MD.INI`, gamePath(home, "RA2MD.INI")]),
    );
    expect(await measureParts(deps, await activeOf(manifest, slot))).toMatchObject({ settings: 0 });
  });

  it("deletes a map both editions read once, and forgets it from both records", async () => {
    const { deps, manifest, slot, home, removed } = await setup({ shared: true });
    await removeParts(deps, await activeOf(manifest, slot), ["maps"]);
    expect(removed.filter((p) => p === gamePath(home, "shared.map"))).toHaveLength(1);
    for (const id of ["ra2", "ra2md"] as const) {
      expect((await manifest.getGame(id, slot))?.files["shared.map"]).toBeUndefined();
    }
  });
});

describe("prepareReinstall", () => {
  it("prepares a reinstall in the same slot: game files marked missing, saves and settings untouched", async () => {
    const { manifest, slot } = await setup();
    const install = await activeOf(manifest, slot);
    await prepareReinstall(manifest, install);
    const yr = await manifest.getGame("ra2md", slot);
    expect(yr!.files["a.mix"]!.done).toBe(false);
    expect(yr!.files["a.yrm"]!.done).toBe(false);
    expect(yr!.files["SAVE0001.SAV"]!.done).toBe(true);
    expect(yr!.files["RA2MD.INI"]!.done).toBe(true);
    expect((await manifest.getGame("ra2", slot))!.files["b.mix"]!.done).toBe(false);
    expect(yr!.storage).toBe(install.editions[1]!.storage);
  });
});
