import { describe, expect, it } from "vitest";
import { partProgress } from "./import-progress";
import { planImport, type BuildInfo, type ImportOptions } from "./install";

const yuri: BuildInfo = {
  games: {
    ra2md: {
      title: "Yuri's Revenge",
      exe: "gamemd.exe",
      ini: "RA2MD.INI",
      stamp: 0x3bdf544e,
      build: "test",
      runtime: { edition: "ra2md", build: "test", exeSha256: "a", blowfishSha256: "b" },
    },
  },
};

const folder = [
  { path: "gamemd.exe", size: 6_000_000 },
  { path: "ra2.mix", size: 400 },
  { path: "maps01.mix", size: 100 },
  { path: "multi.mix", size: 10 },
  { path: "ra2md.mix", size: 300 },
  { path: "movmd03.mix", size: 280 },
  { path: "movies01.mix", size: 70 },
  { path: "audio.bag", size: 50 },
  { path: "rulesmd.ini", size: 4 },
  { path: "EA_WWLOGO.BIK", size: 9 },
  { path: "Saved Games/one.sav", size: 5 },
  { path: "RA2MD.INI", size: 2 },
  { path: "Maps/x.map", size: 1 },
  { path: "x.map", size: 1 },
  { path: "Mods/Good/rules.ini", size: 30 },
  { path: "Mods/Good/art.mix", size: 20 },
  { path: "Mods/Patched/mod.dll", size: 7 },
  { path: "Mods/Patched/rules.ini", size: 7 },
];

const everything: ImportOptions = { movies: true, saves: true, settings: true };
const plan = (options: Partial<ImportOptions> = {}) =>
  planImport(folder, yuri, { ...everything, ...options });

describe("partProgress", () => {
  it("groups the copy into parts, in order, without empty parts", () => {
    const parts = partProgress(plan(), new Set(), null, false);
    expect(parts.map((part) => part.id)).toEqual([
      "game",
      "movies",
      "mods",
      "maps",
      "saves",
      "settings",
    ]);
    expect(parts.map((part) => part.label)).toEqual([
      "Game content",
      "Movies",
      "Mods",
      "Custom maps",
      "Saved games",
      "Settings and hotkeys",
    ]);
    const bare = partProgress(
      planImport(folder.slice(0, 9), yuri, { movies: false, saves: false, settings: false }),
      new Set(),
      null,
      false,
    );
    expect(bare.map((part) => part.id)).toEqual(["game"]);
  });

  it("leaves stubbed movies out", () => {
    const parts = partProgress(plan({ movies: false }), new Set(), null, false);
    expect(parts.map((part) => part.id)).not.toContain("movies");
  });

  it("a part is done when all its files are, copying when one is current or some are done, waiting otherwise", () => {
    const all = plan();
    const game = all.copy.filter((file) => file.kind !== "movie" && file.kind !== "map");
    const state = (done: string[], current: string | null) => {
      const parts = partProgress(all, new Set(done), current, false);
      return Object.fromEntries(parts.map((part) => [part.id, part]));
    };
    expect(state([], null).game?.state).toBe("waiting");
    expect(state([], "ra2.mix").game?.state).toBe("copying");
    expect(state([], "movmd03.mix").movies?.state).toBe("copying");
    expect(state([], "movmd03.mix").game?.state).toBe("waiting");
    const some = state(["ra2.mix"], null).game;
    expect(some?.state).toBe("copying");
    expect(some?.doneBytes).toBe(400);
    const every = state(
      game.map((file) => file.path),
      null,
    ).game;
    expect(every?.state).toBe("done");
    expect(every?.doneBytes).toBe(every?.bytes);
  });

  it("mods wait until the files are finished", () => {
    const waiting = partProgress(plan(), new Set(), null, false).find((part) => part.id === "mods");
    expect(waiting).toMatchObject({ bytes: 50, doneBytes: 0, state: "waiting" });
    const bringing = partProgress(plan(), new Set(), null, true).find((part) => part.id === "mods");
    expect(bringing?.state).toBe("copying");
    const left = partProgress(plan({ mods: false }), new Set(), null, true);
    expect(left.map((part) => part.id)).not.toContain("mods");
  });

  it("the parts' bytes add up to the copy's real files", () => {
    const all = plan();
    const parts = partProgress(all, new Set(), null, false).filter((part) => part.id !== "mods");
    const real = all.copy.filter((file) => !file.stub).reduce((sum, file) => sum + file.size, 0);
    expect(parts.reduce((sum, part) => sum + part.bytes, 0)).toBe(real);
  });
});
