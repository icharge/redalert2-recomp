import { describe, expect, it, vi } from "vitest";
import {
  decodeLatin1,
  encodeLatin1,
  getIniValue,
  parseIni,
  setIniValue,
  type GameSettingsDeps,
} from "./game-settings";
import type { GameId } from "./install";
import type { GameRecord } from "./manifest";
import { editForAll, forEachEdition, setHotkeyForAll, setMainValueForAll } from "./all-games";

const g = (id: GameId): GameRecord => ({
  id,
  slot: 1,
  storage: id === "ra2" ? "ra2-1" : "ra2md-1",
  title: id,
  exeStamp: 0,
  importedAt: 0,
  bytes: 0,
  complete: true,
  files: {},
});
const ra2 = g("ra2");
const yr = g("ra2md");

function fakeDeps(saved: Record<string, string> = {}) {
  const writes: { storage: string; name: string; text: string }[] = [];
  const deps: GameSettingsDeps = {
    readSave: async (storage, name) => {
      const key = Object.keys(saved).find(
        (k) => k.toLowerCase() === `${storage}/${name}`.toLowerCase(),
      );
      return key ? { name: key.slice(storage.length + 1), data: encodeLatin1(saved[key]) } : null;
    },
    writeSave: async (storage, name, data) => {
      writes.push({ storage, name, text: decodeLatin1(data) });
    },
    readImported: async () => {
      throw new Error("no imported file");
    },
  };
  return { deps, writes };
}

describe("setMainValueForAll", () => {
  it("writes RA2.INI and RA2MD.INI", async () => {
    const { deps, writes } = fakeDeps({
      "ra2-1/RA2.INI": "[Options]\nGameSpeed=2\n",
      "ra2md-1/RA2MD.INI": "[Options]\nGameSpeed=1\n",
    });
    await setMainValueForAll([ra2, yr], "Options", "GameSpeed", "4", deps);
    expect(writes.map((w) => [w.storage, w.name])).toEqual([
      ["ra2-1", "RA2.INI"],
      ["ra2md-1", "RA2MD.INI"],
    ]);
    for (const w of writes)
      expect(getIniValue(parseIni(encodeLatin1(w.text)), "Options", "GameSpeed")).toBe("4");
  });

  it("one edition writes one file", async () => {
    const { deps, writes } = fakeDeps();
    await setMainValueForAll([yr], "Options", "GameSpeed", "4", deps);
    expect(writes).toHaveLength(1);
    expect(writes[0].storage).toBe("ra2md-1");
  });

  it("the first failure rejects", async () => {
    const { deps } = fakeDeps();
    deps.writeSave = vi.fn().mockRejectedValue(new Error("disk full"));
    await expect(setMainValueForAll([ra2, yr], "Options", "GameSpeed", "4", deps)).rejects.toThrow(
      "disk full",
    );
    expect(deps.writeSave).toHaveBeenCalledTimes(1);
  });
});

describe("setHotkeyForAll", () => {
  it("a YR-only command skips RA2", async () => {
    const { deps, writes } = fakeDeps();
    await expect(setHotkeyForAll([ra2, yr], "VeterancyNav", 65, deps)).resolves.toEqual(["ra2md"]);
    expect(writes).toHaveLength(1);
    expect(writes[0].name.toLowerCase()).toBe("keyboardmd.ini");
    expect(writes[0].text).toContain("VeterancyNav=65");
  });

  it("a shared command writes both keyboard files", async () => {
    const { deps, writes } = fakeDeps();
    await expect(setHotkeyForAll([ra2, yr], "AllToCheer", 65, deps)).resolves.toEqual([
      "ra2",
      "ra2md",
    ]);
    expect(writes.map((w) => w.name.toLowerCase())).toEqual(["keyboard.ini", "keyboardmd.ini"]);
  });
});

describe("editForAll", () => {
  it("edits the host file of every edition", async () => {
    const { deps, writes } = fakeDeps();
    const ids = await editForAll(
      [ra2, yr],
      "host",
      (ini) => setIniValue(ini, "present", "controls", "modern"),
      deps,
    );
    expect(ids).toEqual(["ra2", "ra2md"]);
    expect(writes.map((w) => w.name)).toEqual([".host/ra2.ini", ".host/ra2md.ini"]);
    for (const w of writes) expect(w.text).toContain("controls=modern");
  });

  it("an edit that returns null writes nothing", async () => {
    const { deps, writes } = fakeDeps();
    await expect(editForAll([ra2, yr], "main", () => null, deps)).resolves.toEqual([]);
    expect(writes).toHaveLength(0);
  });
});

describe("forEachEdition", () => {
  it("calls once per edition", () => {
    const seen: string[] = [];
    forEachEdition([ra2, yr], (game) => seen.push(game.storage));
    expect(seen).toEqual(["ra2-1", "ra2md-1"]);
  });
});
