import { describe, expect, it } from "vitest";
import {
  checkExe,
  checkSpace,
  classify,
  loadBuildInfo,
  planImport,
  readExeStamp,
  type BuildInfo,
} from "./install";

const yuri: BuildInfo = {
  games: {
    ra2md: { title: "Yuri's Revenge", exe: "gamemd.exe", ini: "RA2MD.INI", stamp: 0x3bdf544e },
  },
};

describe("classify", () => {
  it("knows what the game reads, without regard to case", () => {
    expect(classify("RA2MD.MIX")).toEqual({ kind: "archive", needs: ["ra2md"] });
    expect(classify("ra2.mix")).toEqual({ kind: "archive", needs: ["ra2", "ra2md"] });
    expect(classify("Audio.BAG")).toEqual({ kind: "sound", needs: ["ra2", "ra2md"] });
    expect(classify("audiomd.idx")).toEqual({ kind: "sound", needs: ["ra2md"] });
    expect(classify("rulesmd.ini")).toEqual({ kind: "data", needs: ["ra2md"] });
    expect(classify("rules.ini")).toEqual({ kind: "data", needs: ["ra2", "ra2md"] });
    expect(classify("game.fnt")).toEqual({ kind: "data", needs: ["ra2", "ra2md"] });
    expect(classify("GAME.FNT")).toEqual({ kind: "data", needs: ["ra2", "ra2md"] });
    expect(classify("GameMD.exe")).toEqual({ kind: "exe", needs: ["ra2md"] });
    expect(classify("Game.exe")).toEqual({ kind: "exe", needs: ["ra2"] });
    expect(classify("Blowfish.dll")).toEqual({ kind: "library", needs: ["ra2", "ra2md"] });
    expect(classify("movmd01.mix")?.kind).toBe("movie");
    expect(classify("MOVIES01.MIX")?.kind).toBe("movie");
    expect(classify("Saved Games\\a.sav")?.kind).toBe("save");
    // what the game writes beside its exe: SAVE%04lX.sav
    expect(classify("SAVE0001.SAV")).toEqual({ kind: "save", needs: ["ra2", "ra2md"] });
  });

  it("leaves out what it should", () => {
    for (const name of [
      "Ares.dll",
      "Syringe.exe",
      "expandmd01.mix.bak",
      "ra2.mix.bak",
      "Maps/Custom/x.map",
      "Saved Games",
      "readme.txt",
      "ddraw.dll",
    ])
      expect(classify(name), name).toBeNull();
  });
});

const folder = [
  { path: "gamemd.exe", size: 6_000_000 },
  { path: "game.exe", size: 5_000_000 },
  { path: "ra2.mix", size: 400_000_000 },
  { path: "ra2md.mix", size: 300_000_000 },
  { path: "expandmd01.mix", size: 12_000_000 },
  { path: "movmd01.mix", size: 280_000_000 },
  { path: "audio.bag", size: 50_000_000 },
  { path: "rulesmd.ini", size: 400_000 },
  { path: "Ares.dll", size: 900_000 },
  { path: "Syringe.exe", size: 100_000 },
  { path: "Blowfish.dll", size: 30_000 },
  { path: "binkw32.dll", size: 300_000 },
  { path: "Saved Games/one.sav", size: 5_000 },
  { path: "Maps/x.map", size: 1_000 },
];

describe("planImport", () => {
  it("brings a loose game font into the game folder for archive override", () => {
    const plan = planImport([...folder, { path: "GAME.FNT", size: 131100 }], yuri,
      { movies: false, saves: false });
    expect(plan.error).toBeNull();
    expect(plan.copy).toContainEqual({ path: "GAME.FNT", size: 131100, kind: "data", needs: ["ra2", "ra2md"] });
    expect(plan.skipped.some((file) => file.path === "GAME.FNT")).toBe(false);
    expect(classify("fonts/game.fnt")).toBeNull();
    expect(classify("game.fnt.bak")).toBeNull();
  });

  it("copies what the game reads for the game this build runs", () => {
    const plan = planImport(folder, yuri, { movies: true, saves: true });
    expect(plan.error).toBeNull();
    expect(plan.games).toEqual(["ra2md"]);
    expect(plan.copy.map((f) => f.path).sort()).toEqual(
      [
        "Saved Games/one.sav",
        "Blowfish.dll",
        "audio.bag",
        "binkw32.dll",
        "expandmd01.mix",
        "gamemd.exe",
        "movmd01.mix",
        "ra2.mix",
        "ra2md.mix",
        "rulesmd.ini",
      ].sort(),
    );
    expect(plan.bytes).toBe(
      6_000_000 +
        400_000_000 +
        300_000_000 +
        12_000_000 +
        280_000_000 +
        50_000_000 +
        400_000 +
        5_000 +
        30_000 +
        300_000,
    );
    expect(plan.skipped.map((s) => s.path)).toContain("Ares.dll");
    expect(plan.skipped.find((s) => s.path === "game.exe")?.reason).toMatch(/does not have/);
    expect(plan.warnings).toEqual([]);
  });

  it("leaves the movies and the saves out when asked, and says how big the movies are", () => {
    const plan = planImport(folder, yuri, { movies: false, saves: false });
    expect(plan.copy.some((f) => f.kind === "save")).toBe(false);
    // the game stops at start without the archive, so an empty one is written in its place
    expect(plan.copy.find((f) => f.path === "movmd01.mix")).toMatchObject({ size: 12, stub: true });
    expect(plan.movieBytes).toBe(280_000_000);
    expect(plan.bytes).toBeLessThan(plan.movieBytes + 1_000_000_000 - 280_000_000);
  });

  it("stops without Blowfish.dll, warns without binkw32.dll, and explains a folder with no program", () => {
    const thin = planImport([{ path: "gamemd.exe", size: 1 }], yuri, { movies: true, saves: true });
    expect(thin.error).toMatch(/Blowfish.dll is missing/);
    expect(thin.warnings).toHaveLength(1);
    const noBink = planImport(
      [
        { path: "gamemd.exe", size: 1 },
        { path: "Blowfish.dll", size: 1 },
      ],
      yuri,
      { movies: true, saves: true },
    );
    expect(noBink.error).toBeNull();
    expect(noBink.warnings[0]).toMatch(/binkw32.dll/);
    const none = planImport([{ path: "ra2.mix", size: 1 }], yuri, { movies: true, saves: true });
    expect(none.error).toMatch(/no gamemd\.exe at the top/);
    const wrong = planImport([{ path: "game.exe", size: 1 }], yuri, { movies: true, saves: true });
    expect(wrong.error).toMatch(/different game/);
  });
});

/** The first 4 KB of a PE file with a timestamp in it. */
function pe(stamp: number, lfanew = 0x80): Uint8Array {
  const head = new Uint8Array(4096);
  const view = new DataView(head.buffer);
  head[0] = 0x4d;
  head[1] = 0x5a;
  view.setUint32(0x3c, lfanew, true);
  if (lfanew + 12 <= head.length) view.setUint32(lfanew + 8, stamp, true);
  return head;
}

describe("the exe's stamp", () => {
  it("reads the timestamp the way src/web/main.c does", () => {
    expect(readExeStamp(pe(0x3bdf544e))).toBe(0x3bdf544e);
    expect(readExeStamp(new Uint8Array(10))).toBe(0);
    expect(readExeStamp(pe(1, 5000))).toBe(0);
  });

  it("accepts the lifted build and says what it found otherwise", () => {
    expect(checkExe(pe(0x3bdf544e), 0x3bdf544e, "gamemd.exe")).toEqual({ ok: true, message: null });
    const other = checkExe(pe(0x12345678), 0x3bdf544e, "gamemd.exe");
    expect(other.ok).toBe(false);
    expect(other.message).toMatch(/0x12345678.*0x3BDF544E/);
    expect(checkExe(new Uint8Array(100), 1, "gamemd.exe").message).toMatch(/not a Windows program/);
  });
});

describe("checkSpace", () => {
  const MB = 1024 * 1024;
  it("fits when the free room covers the copy and a margin", () => {
    expect(checkSpace({ quota: 10_000 * MB, usage: 100 * MB }, 1000 * MB, 0)).toEqual({
      fits: true,
      short: 0,
      advice: null,
    });
  });

  it("says how much is short, and suggests skipping the movies when that would be enough", () => {
    const tight = checkSpace({ quota: 1000 * MB, usage: 0 }, 1200 * MB, 400 * MB);
    expect(tight.fits).toBe(false);
    expect(tight.short).toBe(1200 * MB + 64 * MB - 1000 * MB);
    expect(tight.advice).toMatch(/movies/);
    expect(checkSpace({ quota: 100 * MB, usage: 0 }, 1200 * MB, 400 * MB).advice).toMatch(
      /Free some space/,
    );
    expect(checkSpace({}, 1, 0).fits).toBe(false);
  });
});

describe("loadBuildInfo", () => {
  it("reads build.json and refuses a page or an error in its place", async () => {
    const ok = async () => new Response(JSON.stringify(yuri));
    expect(await loadBuildInfo(ok as typeof fetch)).toEqual(yuri);
    const missing = async () => new Response("", { status: 404 });
    await expect(loadBuildInfo(missing as typeof fetch)).rejects.toThrow(/not built/);
    const page = async () => new Response("<html>");
    await expect(loadBuildInfo(page as typeof fetch)).rejects.toThrow();
  });
});
