import { describe, expect, it } from "vitest";
import type { GameRecord } from "./manifest";
import {
  compactIniLast,
  compactIniSections,
  defaultKeyboardIni,
  defaultMainIni,
  emptyIni,
  encodeLatin1,
  ensureDefaultHostSettings,
  ensureDefaultMainSettings,
  formatHandle,
  getIniValue,
  getIniValueLast,
  hotkeyFromEvent,
  hotkeyLabel,
  loadGameSettings,
  MATCH_SPEED_SECTIONS,
  parseHandle,
  parseHotkeys,
  parseIni,
  readIniVideoChoice,
  serializeIni,
  setIniValue,
  setIniValueLast,
  settingsFileNames,
  withDefaultHotkeys,
  writeGameSettings,
  writeIniVideoChoice,
  type GameSettingsDeps,
} from "./game-settings";
import { isSettingsPath } from "./settings-files";

const bytes = (text: string) => encodeLatin1(text);
const text = (data: Uint8Array) => new TextDecoder("latin1").decode(data);

describe("INI video mode", () => {
  it("uses DynamicScreen as the durable resolution choice", () => {
    const ini = parseIni(
      bytes("[Video]\r\nDynamicScreen=YES\r\nScreenWidth=1920\r\nScreenHeight=1080\r\n"),
    );
    expect(readIniVideoChoice(ini)).toBe("browser");
    const fixed = writeIniVideoChoice(ini, { w: 1280, h: 720 });
    expect(readIniVideoChoice(fixed)).toEqual({ w: 1280, h: 720 });
    expect(text(serializeIni(fixed))).toContain("DynamicScreen=no\r\n");
    expect(readIniVideoChoice(parseIni(bytes("[Video]\nScreenWidth=800\n")))).toBeUndefined();
  });
});

function record(id: GameRecord["id"], files: Record<string, string> = {}): GameRecord {
  return {
    id,
    slot: 1,
    storage: `slot-1-${id}`,
    title: id === "ra2" ? "Red Alert 2" : "Yuri's Revenge",
    exeStamp: 0,
    importedAt: 0,
    bytes: 0,
    complete: true,
    files: Object.fromEntries(
      Object.entries(files).map(([name, value]) => [
        name,
        {
          size: value.length,
          lastModified: 0,
          done: true,
          needs: [id],
          home: id,
        },
      ]),
    ),
  };
}

describe("settings file names", () => {
  it("names the files per edition", () => {
    expect(settingsFileNames("ra2")).toEqual({ main: "ra2.ini", keyboard: "keyboard.ini" });
    expect(settingsFileNames("ra2md")).toEqual({
      main: "ra2md.ini",
      keyboard: "keyboardmd.ini",
    });
  });
});

describe("settings paths", () => {
  it("finds the game's settings wherever a mod or host overlay keeps them", () => {
    expect(isSettingsPath("RA2MD.INI")).toBe(true);
    expect(isSettingsPath("mods/Alpha/RA2MD.INI")).toBe(true);
    expect(isSettingsPath(".host/ra2.ini")).toBe(true);
    expect(isSettingsPath("Keyboard.INI")).toBe(true);
    expect(isSettingsPath("mods/Alpha/KeyboardMD.ini")).toBe(true);
    expect(isSettingsPath("SAVE0001.SAV")).toBe(false);
    expect(isSettingsPath("Screenshot.ini")).toBe(false);
  });
});

describe("INI editing", () => {
  it("keeps CRLF and every untouched line", () => {
    const original = "[Video]\r\nScreenWidth=800\r\nScreenHeight=600\r\n";
    const ini = parseIni(bytes(original));
    expect(ini.eol).toBe("\r\n");
    expect(text(serializeIni(ini))).toBe(original);

    const changed = setIniValue(ini, "Video", "ScreenWidth", "1024");
    expect(text(serializeIni(changed))).toBe("[Video]\r\nScreenWidth=1024\r\nScreenHeight=600\r\n");
  });

  it("uses the first section and key, as the game's reader does", () => {
    const ini = parseIni(
      bytes("[Options]\nGameSpeed=1\n[Options]\nGameSpeed=9\n[Video]\nScreenWidth=800\n"),
    );
    expect(getIniValue(ini, "options", "gamespeed")).toBe("1");
    expect(getIniValue(ini, "VIDEO", "screenwidth")).toBe("800");
    expect(getIniValue(ini, "Audio", "SoundVolume")).toBeNull();

    const changed = setIniValue(ini, "Options", "GameSpeed", "5");
    const saved = text(serializeIni(changed));
    expect(saved.startsWith("[Options]\nGameSpeed=5\n[Options]\nGameSpeed=9\n")).toBe(true);
  });

  it("reads and writes the last value for the game's match-mode sections", () => {
    const ini = parseIni(
      bytes("[Skirmish]\nGameSpeed=1\n[LAN]\nGameSpeed=2\n[Skirmish]\nGameSpeed=6\n"),
    );
    expect(getIniValue(ini, "Skirmish", "GameSpeed")).toBe("1");
    expect(getIniValueLast(ini, "skirmish", "gamespeed")).toBe("6");
    expect(getIniValueLast(ini, "LAN", "GameSpeed")).toBe("2");
    expect(getIniValueLast(ini, "WonlinePref", "GameSpeed")).toBeNull();

    const changed = setIniValueLast(ini, "Skirmish", "GameSpeed", "5");
    expect(getIniValue(changed, "Skirmish", "GameSpeed")).toBe("1");
    expect(getIniValueLast(changed, "Skirmish", "GameSpeed")).toBe("5");
    expect(text(serializeIni(changed))).toBe(
      "[Skirmish]\nGameSpeed=1\n[LAN]\nGameSpeed=2\n[Skirmish]\nGameSpeed=5\n",
    );

    const added = setIniValueLast(ini, "LAN", "GameSpeed", "5");
    expect(getIniValueLast(added, "LAN", "GameSpeed")).toBe("5");
    expect(getIniValueLast(added, "Skirmish", "GameSpeed")).toBe("6");

    const compacted = compactIniSections(ini, ["Skirmish"]);
    expect(text(serializeIni(compacted))).toBe("[LAN]\nGameSpeed=2\n[Skirmish]\nGameSpeed=6");
  });

  it("adds a missing key inside the section and a missing section at the end", () => {
    const ini = parseIni(bytes("[Video]\nScreenWidth=800\n\n[Options]\nGameSpeed=2\n"));
    const audio = setIniValue(ini, "Audio", "SoundVolume", "0.700000");
    expect(text(serializeIni(audio))).toBe(
      "[Video]\nScreenWidth=800\n\n[Options]\nGameSpeed=2\n[Audio]\nSoundVolume=0.700000",
    );

    const video = setIniValue(ini, "Video", "StretchMovies", "no");
    expect(text(serializeIni(video))).toBe(
      "[Video]\nScreenWidth=800\nStretchMovies=no\n\n[Options]\nGameSpeed=2\n",
    );

    const fresh = setIniValue(emptyIni(), "Options", "GameSpeed", "3");
    expect(text(serializeIni(fresh))).toBe("[Options]\nGameSpeed=3");
  });

  it("normalizes Red Alert 2's last-value profile before editing", () => {
    const ini = parseIni(
      bytes("[Options]\nGameSpeed=1\nAutoScroll=yes\n[Options]\nAutoScroll=no\nToolTips=no\n"),
    );
    const compacted = compactIniLast(ini);
    expect(text(serializeIni(compacted))).toBe(
      "[Options]\nGameSpeed=1\nAutoScroll=no\nToolTips=no",
    );
    expect(getIniValue(compacted, "Options", "AutoScroll")).toBe("no");
  });

  it("keeps a value's spaces exactly as the game wrote them", () => {
    const ini = parseIni(bytes("[Options]\nGameSpeed = 4 \n"));
    expect(getIniValue(ini, "Options", "GameSpeed")).toBe("4");
    expect(text(serializeIni(setIniValue(ini, "Options", "GameSpeed", "4")))).toBe(
      "[Options]\nGameSpeed=4\n",
    );
  });
});

describe("hotkeys", () => {
  it("reads the game's values and labels the modifiers", () => {
    const ini = parseIni(
      bytes(
        "[Hotkey]\nTeamSelect_1=49\nTeamAddSelect_1=305\nTeamCreate_1=561\nTeamCenter_1=1073\n",
      ),
    );
    expect(parseHotkeys(ini)).toEqual([
      { name: "TeamSelect_1", value: 49 },
      { name: "TeamAddSelect_1", value: 305 },
      { name: "TeamCreate_1", value: 561 },
      { name: "TeamCenter_1", value: 1073 },
    ]);
    expect(hotkeyLabel(49)).toBe("1");
    expect(hotkeyLabel(305)).toBe("Shift+1");
    expect(hotkeyLabel(561)).toBe("Ctrl+1");
    expect(hotkeyLabel(1073)).toBe("Alt+1");
    expect(hotkeyLabel(0x70)).toBe("F1");
    expect(hotkeyLabel(0x60)).toBe("Numpad 0");
  });

  it("turns a browser key event into the game's value", () => {
    expect(hotkeyFromEvent(new KeyboardEvent("keydown", { code: "Digit1" }))).toBe(49);
    expect(hotkeyFromEvent(new KeyboardEvent("keydown", { code: "Digit1", shiftKey: true }))).toBe(
      305,
    );
    expect(hotkeyFromEvent(new KeyboardEvent("keydown", { code: "Digit1", ctrlKey: true }))).toBe(
      561,
    );
    expect(hotkeyFromEvent(new KeyboardEvent("keydown", { code: "Digit1", altKey: true }))).toBe(
      1073,
    );
    expect(hotkeyFromEvent(new KeyboardEvent("keydown", { code: "ShiftLeft" }))).toBeNull();
    expect(hotkeyFromEvent(new KeyboardEvent("keydown", { code: "Escape" }))).toBe(27);
  });
});

describe("loadGameSettings", () => {
  it("prefers the saved file and does not read the imported one", async () => {
    const game = record("ra2md", { "RA2MD.INI": "[Video]\nScreenWidth=640\n" });
    const readImported = async () => {
      throw new Error("the imported file must not be read");
    };
    const deps: Partial<GameSettingsDeps> = {
      readSave: async (storage, name) => {
        expect(storage).toBe("slot-1-ra2md");
        if (name !== "ra2md.ini") return null;
        return { name: "RA2MD.INI", data: bytes("[Video]\nScreenWidth=1024\n") };
      },
      readImported,
    };

    const loaded = await loadGameSettings(game, deps);
    expect(loaded.main.name).toBe("RA2MD.INI");
    expect(getIniValue(loaded.main.ini!, "Video", "ScreenWidth")).toBe("1024");
    expect(loaded.keyboard.name).toBe("keyboardmd.ini");
    expect(loaded.keyboard.ini).toBeNull();
  });

  it("reads Red Alert 2's last duplicate value through the launcher", async () => {
    const game = record("ra2");
    const loaded = await loadGameSettings(game, {
      readSave: async () => ({
        name: "RA2.INI",
        data: bytes("[Options]\nAutoScroll=yes\n[Options]\nAutoScroll=no\n"),
      }),
      readImported: async () => {
        throw new Error("nothing was imported");
      },
    });
    expect(getIniValue(loaded.main.ini!, "Options", "AutoScroll")).toBe("no");
    expect(text(loaded.main.data!)).toBe("[Options]\nAutoScroll=no");
  });

  it("uses the imported spelling when there is no saved copy", async () => {
    const imported: Record<string, string> = {
      "Ra2.Ini": "[Options]\nGameSpeed=2\n",
      "Keyboard.INI": "[Hotkey]\nOptions=27\n",
    };
    const game = record("ra2", imported);
    const deps: Partial<GameSettingsDeps> = {
      readSave: async () => null,
      readImported: async (home, name) => {
        expect(home).toBe("ra2");
        return bytes(imported[name] ?? "");
      },
    };

    const loaded = await loadGameSettings(game, deps);
    expect(loaded.main.name).toBe("Ra2.Ini");
    expect(loaded.keyboard.name).toBe("Keyboard.INI");
    expect(loaded.hotkeys).toEqual([{ name: "Options", value: 27 }]);
    expect(getIniValue(loaded.main.ini!, "Options", "GameSpeed")).toBe("2");
  });

  it("falls back to the canonical name, the default settings and the built-in hotkeys", async () => {
    const loaded = await loadGameSettings(record("ra2"), {
      readSave: async () => null,
      readImported: async () => {
        throw new Error("nothing was imported");
      },
    });
    expect(loaded.main.name).toBe("ra2.ini");
    expect(loaded.main.ini).not.toBeNull();
    expect(loaded.main.data).not.toBeNull();
    expect(loaded.mainFromDefaults).toBe(true);
    expect(getIniValue(loaded.main.ini!, "Options", "GameSpeed")).toBe("5");
    expect(getIniValue(loaded.main.ini!, "Options", "Difficulty")).toBe("2");
    expect(getIniValue(loaded.main.ini!, "Options", "ShowHidden")).toBe("yes");
    expect(getIniValue(loaded.main.ini!, "Audio", "SoundVolume")).toBe("0.700000");
    expect(getIniValue(loaded.main.ini!, "Audio", "ScoreVolume")).toBe("0.400000");
    expect(getIniValue(loaded.main.ini!, "Audio", "IsScoreShuffle")).toBe("yes");
    expect(getIniValue(loaded.main.ini!, "Video", "ScreenWidth")).toBe("1920");
    expect(getIniValue(loaded.main.ini!, "Video", "ScreenHeight")).toBe("1080");
    expect(getIniValue(loaded.main.ini!, "Video", "StretchMovies")).toBe("yes");
    expect(getIniValue(loaded.main.ini!, "Options", "CampDifficulty")).toBeNull();
    expect(loaded.keyboard.name).toBe("keyboard.ini");
    expect(loaded.keyboardFromDefaults).toBe(true);
    expect(loaded.hotkeys).toContainEqual({ name: "Options", value: 27 });
    expect(loaded.hotkeys).toContainEqual({ name: "ScreenCapture", value: 579 });
    expect(loaded.hotkeys.length).toBeGreaterThan(30);
  });

  it("keeps the edition's own default profile", () => {
    const ra2 = defaultMainIni("ra2");
    const yuri = defaultMainIni("ra2md");
    expect(getIniValue(yuri, "Options", "CampDifficulty")).toBe("2");
    expect(getIniValue(ra2, "Options", "CampDifficulty")).toBeNull();
    expect(getIniValue(ra2, "Audio", "IsScoreShuffle")).toBe("yes");
    expect(getIniValue(yuri, "Audio", "IsScoreShuffle")).toBe("yes");
    for (const edition of [ra2, yuri])
      for (const section of MATCH_SPEED_SECTIONS)
        expect(getIniValueLast(edition, section, "GameSpeed")).toBe("0"); // shown as 6, Fastest
  });

  it("does not treat an imported settings file as a missing one", async () => {
    const game = record("ra2md", { "RA2MD.INI": "[Options]\nGameSpeed=4\n" });
    const loaded = await loadGameSettings(game, {
      readSave: async () => null,
      readImported: async () => bytes("[Options]\nGameSpeed=4\n"),
    });
    expect(loaded.mainFromDefaults).toBe(false);
    expect(getIniValue(loaded.main.ini!, "Options", "GameSpeed")).toBe("4");
  });

  it("uses the edition's own built-in hotkeys", () => {
    const ra2 = parseHotkeys(defaultKeyboardIni("ra2"));
    const yuri = parseHotkeys(defaultKeyboardIni("ra2md"));
    expect(ra2.some((hotkey) => hotkey.name === "PreviousObject")).toBe(false);
    expect(yuri).toContainEqual({ name: "PreviousObject", value: 77 });
    expect(yuri).toContainEqual({ name: "CursorCheat", value: 222 });
    expect(ra2).toContainEqual({ name: "SidebarPageUp", value: 2085 });
  });

  it("seeds every default binding before the first change", () => {
    const seeded = withDefaultHotkeys("ra2md", emptyIni());
    const changed = setIniValue(seeded, "Hotkey", "Options", "113");
    const hotkeys = parseHotkeys(changed);
    expect(hotkeys.find((hotkey) => hotkey.name === "Options")?.value).toBe(113);
    expect(hotkeys).toContainEqual({ name: "TeamCreate_1", value: 561 });
    expect(hotkeys.length).toBeGreaterThan(30);
  });
});

describe("player name", () => {
  it("decodes the game's Handle bytes", () => {
    expect(parseHandle("69,43,68,61,72,67,65,ca,c7,d1,ca,b4,d5,")).toBe("iChargeสวัสดี");
    expect(parseHandle("5b,4e,65,77,20,50,6c,61,79,65,72,5d,")).toBe("[New Player]");
    expect(parseHandle(null)).toBe("");
  });

  it("writes the name back as the same handle", () => {
    const handle = formatHandle("iChargeสวัสดี");
    expect(handle).toBe("69,43,68,61,72,67,65,ca,c7,d1,ca,b4,d5,");
    expect(parseHandle(handle)).toBe("iChargeสวัสดี");
  });

  it("keeps an ASCII name to one byte per character", () => {
    expect(formatHandle("Player")).toBe("50,6c,61,79,65,72,");
  });

  it("rejects characters the game cannot store", () => {
    expect(formatHandle("🙂")).toBeNull();
  });
});

describe("ensureDefaultMainSettings", () => {
  it("migrates the existing fixed preference but respects an explicit INI mode", async () => {
    localStorage.setItem("ra2.video.slot-1-ra2md", JSON.stringify({ w: 1280, h: 720 }));
    try {
      const writes: string[] = [];
      const deps = {
        readSave: async () => ({
          name: "RA2MD.INI",
          data: bytes("[Video]\nScreenWidth=1920\nScreenHeight=1080\n"),
        }),
        writeSave: async (_storage: string, _name: string, data: Uint8Array) => {
          writes.push(text(data));
        },
      };
      await ensureDefaultMainSettings(record("ra2md"), deps);
      expect(writes[0]).toContain("DynamicScreen=no");
      expect(writes[0]).toContain("ScreenWidth=1280");
      const explicit = {
        ...deps,
        readSave: async () => ({
          name: "RA2MD.INI",
          data: bytes("[Video]\nDynamicScreen=yes\n[Intro]\nPlay=no\n"),
        }),
      };
      writes.length = 0;
      await ensureDefaultMainSettings(record("ra2md"), explicit);
      expect(writes).toEqual([]);
    } finally {
      localStorage.removeItem("ra2.video.slot-1-ra2md");
    }
  });
  it("writes the defaults into the save store when the game has no settings file", async () => {
    const writes: { name: string; text: string }[] = [];
    await ensureDefaultMainSettings(record("ra2md"), {
      readSave: async () => null,
      readImported: async () => {
        throw new Error("nothing was imported");
      },
      writeSave: async (_storage, name, data) => {
        writes.push({ name, text: text(data) });
      },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.name).toBe("RA2MD.INI");
    expect(writes[0]?.text).toContain("GameSpeed=5");
    expect(writes[0]?.text).toContain("ScreenWidth=1920");
  });

  it("keeps the import's settings but forces the intro flag off", async () => {
    const writes: { name: string; text: string }[] = [];
    await ensureDefaultMainSettings(record("ra2md", { "RA2MD.INI": "[Options]" }), {
      readSave: async () => null,
      readImported: async () => bytes("[Options]\nGameSpeed=1\n[Intro]\nPlay=yes\n"),
      writeSave: async (_storage, name, data) => {
        writes.push({ name, text: text(data) });
      },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.name).toBe("RA2MD.INI");
    expect(writes[0]?.text).toContain("GameSpeed=1");
    expect(writes[0]?.text).toMatch(/\[Intro\]\r?\nPlay=no/);
  });
});

describe("ensureDefaultHostSettings", () => {
  it("writes smooth scaling and the host defaults when there is no host file", async () => {
    const writes: { name: string; text: string }[] = [];
    await ensureDefaultHostSettings(record("ra2md"), {
      readSave: async () => null,
      writeSave: async (_storage, name, data) => {
        writes.push({ name, text: text(data) });
      },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.name).toBe(".host/ra2md.ini");
    expect(writes[0]?.text).toContain("scale=smooth");
    expect(writes[0]?.text).toContain("bars=blur");
    expect(writes[0]?.text).toContain("hdvox=0");
    expect(writes[0]?.text).toContain("controls=classic");
  });

  it("does not overwrite an existing host file", async () => {
    const writes: string[] = [];
    await ensureDefaultHostSettings(record("ra2md"), {
      readSave: async (_storage, name) =>
        name === ".host/ra2md.ini"
          ? { name: "ra2md.ini", data: bytes("[present]\nscale=crt\n") }
          : null,
      writeSave: async (_storage, name) => {
        writes.push(name);
      },
    });
    expect(writes).toEqual([]);
  });
});

describe("writeGameSettings", () => {
  it("writes the resolved name into the game's save folder", async () => {
    const calls: { storage: string; name: string; text: string }[] = [];
    const game = record("ra2md");
    await writeGameSettings(game, "RA2MD.INI", bytes("[Video]\n"), {
      writeSave: async (storage, name, data) => {
        calls.push({ storage, name, text: text(data) });
      },
    });
    expect(calls).toEqual([{ storage: "slot-1-ra2md", name: "RA2MD.INI", text: "[Video]\n" }]);
  });
});
