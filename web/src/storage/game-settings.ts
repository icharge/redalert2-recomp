// The game's own settings (docs/web/storage.md, "Saves"). The game keeps them in its edition INI
// (RA2.INI / RA2MD.INI) and its hotkey file (KEYBOARD.INI / KEYBOARDMD.INI). The launcher edits the
// copy in `save/<storage>/`, which `restoreSaves` lays over the imported file at the next start.
//
// The files are ANSI, so they are decoded and encoded as Latin-1: byte-for-byte, the same as the
// game wrote them, and every line the launcher does not change keeps its original bytes.

import { keyFor } from "../game/input";
import type { GameId } from "./install";
import { BROWSER_VIDEO_SIZE, readVideoChoice, type VideoChoice } from "./video-preferences";
import {
  DEFAULT_MATCH_SPEED,
  defaultMainValue,
  gameSettingsDefaults,
} from "./game-settings-defaults";
import type { GameRecord } from "./manifest";
import { readGameFile, readSaveFile, opfsTarget, type SavedSettingsFile } from "./opfs";
import { settingsFileNames, gameIniName, type SettingsFileNames } from "./settings-files";

export { settingsFileNames, gameIniName, type SettingsFileNames };

/** The sections the game saves a match's speed in. Its session reader takes the last occurrence. */
export const MATCH_SPEED_SECTIONS = ["Skirmish", "LAN", "WonlinePref"] as const;

export interface Ini {
  /** The line ending the file uses. */
  eol: "\n" | "\r\n";
  /** The file's lines, without their line endings. */
  lines: string[];
}

/** Latin-1 is a one-to-one mapping of bytes 0..255, so nothing in an untouched line changes. */
export function decodeLatin1(data: Uint8Array): string {
  let out = "";
  for (let index = 0; index < data.length; index += 0x8000)
    out += String.fromCharCode(...data.subarray(index, index + 0x8000));
  return out;
}

export function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

export function parseIni(data: Uint8Array): Ini {
  const text = decodeLatin1(data);
  return {
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    lines: text.split(/\r?\n/),
  };
}

export function serializeIni(ini: Ini): Uint8Array {
  return encodeLatin1(ini.lines.join(ini.eol));
}

/** The INI mode, or undefined when an older profile needs migration. */
export function readIniVideoChoice(ini: Ini): VideoChoice | undefined {
  const dynamic = getIniValue(ini, "Video", "DynamicScreen");
  if (dynamic === null) return undefined;
  if (/^(yes|true|1)$/i.test(dynamic.trim())) return BROWSER_VIDEO_SIZE;
  const w = Number(getIniValue(ini, "Video", "ScreenWidth"));
  const h = Number(getIniValue(ini, "Video", "ScreenHeight"));
  return Number.isInteger(w) &&
    Number.isInteger(h) &&
    w >= 320 &&
    h >= 200 &&
    w <= 8192 &&
    h <= 8192
    ? { w, h }
    : null;
}

export function writeIniVideoChoice(ini: Ini, choice: VideoChoice): Ini {
  let next = setIniValue(
    ini,
    "Video",
    "DynamicScreen",
    choice === BROWSER_VIDEO_SIZE ? "yes" : "no",
  );
  if (choice && choice !== BROWSER_VIDEO_SIZE) {
    next = setIniValue(next, "Video", "ScreenWidth", String(choice.w));
    next = setIniValue(next, "Video", "ScreenHeight", String(choice.h));
  }
  return next;
}

export function emptyIni(): Ini {
  return { eol: "\n", lines: [] };
}

/** A new file holding one section and one key. */
export function iniWithValue(section: string, key: string, value: string): Ini {
  return { eol: "\n", lines: [`[${section}]`, `${key}=${value}`, ""] };
}

const sectionHeader = (line: string): string | null => {
  const match = /^\s*\[([^\]]*)\]/.exec(line);
  return match ? (match[1] ?? "").trim() : null;
};

const keyName = (line: string): string | null => {
  const match = /^\s*([^=;\s]+)\s*=/.exec(line);
  return match ? (match[1] ?? "") : null;
};

/**
 * The first value of a section/key. The game's main settings reader takes the first; the match-mode
 * sections ([Skirmish], [LAN], [WonlinePref]) take the last and use getIniValueLast.
 */
export function getIniValue(ini: Ini, section: string, key: string): string | null {
  const wantedSection = section.toLowerCase();
  const wantedKey = key.toLowerCase();
  let current = "";
  for (const line of ini.lines) {
    const header = sectionHeader(line);
    if (header !== null) {
      current = header.toLowerCase();
      continue;
    }
    if (current !== wantedSection) continue;
    if (keyName(line)?.toLowerCase() !== wantedKey) continue;
    return line.slice(line.indexOf("=") + 1).trim();
  }
  return null;
}

/** The section's first line range: the header index and the index one past its last line. */
function sectionRange(ini: Ini, section: string): { header: number; end: number } | null {
  const wanted = section.toLowerCase();
  for (let index = 0; index < ini.lines.length; index++) {
    const header = sectionHeader(ini.lines[index] ?? "");
    if (header?.toLowerCase() !== wanted) continue;
    let end = ini.lines.length;
    for (let next = index + 1; next < ini.lines.length; next++) {
      if (sectionHeader(ini.lines[next] ?? "") !== null) {
        end = next;
        break;
      }
    }
    return { header: index, end };
  }
  return null;
}

/**
 * The last value of a section/key. The game's main settings reader takes the first value, but its
 * match-mode reader (used for [Skirmish], [LAN] and [WonlinePref]) takes the last, and its session
 * writer appends new copies of those sections.
 */
export function getIniValueLast(ini: Ini, section: string, key: string): string | null {
  const wantedSection = section.toLowerCase();
  const wantedKey = key.toLowerCase();
  let current = "";
  let found: string | null = null;
  for (const line of ini.lines) {
    const header = sectionHeader(line);
    if (header !== null) {
      current = header.toLowerCase();
      continue;
    }
    if (current !== wantedSection) continue;
    if (keyName(line)?.toLowerCase() !== wantedKey) continue;
    found = line.slice(line.indexOf("=") + 1).trim();
  }
  return found;
}

/**
 * The effective Red Alert 2 profile: the last value of each key, in first-seen order. Red Alert 2's
 * reader takes the last duplicate, so a file with the game's appended copies is normalized before the
 * launcher edits it. (Yuri's Revenge takes the first for [Options], so it needs no whole-file
 * normalization; its match-mode sections take the last and use setIniValueLast.)
 */
export function compactIniLast(ini: Ini): Ini {
  interface Section {
    header: string;
    keys: Map<string, string>;
    order: string[];
  }
  const sections = new Map<string, Section>();
  let current: Section | null = null;

  for (const line of ini.lines) {
    const header = sectionHeader(line);
    if (header !== null) {
      const name = header.toLowerCase();
      current = sections.get(name) ?? null;
      if (!current) {
        current = { header: `[${header}]`, keys: new Map(), order: [] };
        sections.set(name, current);
      }
      continue;
    }
    const name = keyName(line);
    if (!name || !current) continue;
    const key = name.toLowerCase();
    if (!current.keys.has(key)) current.order.push(key);
    current.keys.set(key, line);
  }

  const lines: string[] = [];
  for (const section of sections.values()) {
    lines.push(section.header);
    for (const key of section.order) lines.push(section.keys.get(key)!);
  }
  return { ...ini, lines };
}

/** Replaces the first value of a section/key, adding the section or key when it is not there. */
export function setIniValue(ini: Ini, section: string, key: string, value: string): Ini {
  const lines = [...ini.lines];
  const range = sectionRange(ini, section);
  const replacement = `${key}=${value}`;
  const wantedKey = key.toLowerCase();

  if (!range) {
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    lines.push(`[${section}]`, replacement);
    return { ...ini, lines };
  }

  for (let index = range.header + 1; index < range.end; index++) {
    if (keyName(lines[index] ?? "")?.toLowerCase() === wantedKey) {
      lines[index] = replacement;
      return { ...ini, lines };
    }
  }

  let insertAt = range.end;
  while (insertAt > range.header + 1 && (lines[insertAt - 1] ?? "") === "") insertAt--;
  lines.splice(insertAt, 0, replacement);
  return { ...ini, lines };
}

/** Replaces (or adds) the last value of a section/key, for the reader that takes the last value. */
export function setIniValueLast(ini: Ini, section: string, key: string, value: string): Ini {
  const lines = [...ini.lines];
  const replacement = `${key}=${value}`;
  const wantedSection = section.toLowerCase();
  const wantedKey = key.toLowerCase();
  let header = -1;
  for (let index = 0; index < lines.length; index++) {
    if (sectionHeader(lines[index] ?? "")?.toLowerCase() === wantedSection) header = index;
  }
  if (header < 0) {
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    lines.push(`[${section}]`, replacement);
    return { ...ini, lines };
  }

  let end = lines.length;
  for (let index = header + 1; index < lines.length; index++) {
    if (sectionHeader(lines[index] ?? "") !== null) {
      end = index;
      break;
    }
  }
  let at = -1;
  for (let index = header + 1; index < end; index++) {
    if (keyName(lines[index] ?? "")?.toLowerCase() === wantedKey) at = index;
  }
  if (at >= 0) {
    lines[at] = replacement;
    return { ...ini, lines };
  }
  let insertAt = end;
  while (insertAt > header + 1 && (lines[insertAt - 1] ?? "") === "") insertAt--;
  lines.splice(insertAt, 0, replacement);
  return { ...ini, lines };
}

/**
 * Merges the given sections, keeping the last value of each key and one copy of the section. The
 * game's session writer appends a new [Skirmish]/[LAN]/[WonlinePref] section on each save, and its
 * reader then has several copies to choose from; reducing them to one makes the launcher's value
 * unambiguous. Other sections keep their lines and order.
 */
export function compactIniSections(ini: Ini, sections: readonly string[]): Ini {
  interface Merged {
    header: string;
    keys: Map<string, string>;
    order: string[];
  }
  const wanted = new Set(sections.map((section) => section.toLowerCase()));
  const merged = new Map<string, Merged>();
  const lines: string[] = [];
  let current: Merged | null = null;
  for (const line of ini.lines) {
    const header = sectionHeader(line);
    if (header !== null) {
      const name = header.toLowerCase();
      if (!wanted.has(name)) {
        lines.push(line);
        current = null;
        continue;
      }
      let section = merged.get(name);
      if (!section) {
        section = { header: `[${header}]`, keys: new Map(), order: [] };
        merged.set(name, section);
      }
      current = section;
      continue;
    }
    if (current) {
      const name = keyName(line);
      if (!name) continue;
      const key = name.toLowerCase();
      if (!current.keys.has(key)) current.order.push(key);
      current.keys.set(key, line);
      continue;
    }
    lines.push(line);
  }
  for (const section of merged.values()) {
    lines.push(section.header);
    for (const key of section.order) lines.push(section.keys.get(key)!);
  }
  return { ...ini, lines };
}

export interface Hotkey {
  name: string;
  /** The game's value: the Windows virtual key plus 0x100 Shift, 0x200 Ctrl, 0x400 Alt. */
  value: number;
}

export function parseHotkeys(ini: Ini | null): Hotkey[] {
  if (!ini) return [];
  const out: Hotkey[] = [];
  let current = "";
  for (const line of ini.lines) {
    const header = sectionHeader(line);
    if (header !== null) {
      current = header.toLowerCase();
      continue;
    }
    if (current !== "hotkey") continue;
    const name = keyName(line);
    const raw = line.slice(line.indexOf("=") + 1).trim();
    if (!name || !/^-?\d+$/.test(raw)) continue;
    out.push({ name, value: Number(raw) });
  }
  return out;
}

export function hotkeyLabel(value: number): string {
  const key = value & 0xff;
  const parts: string[] = [];
  if (value & 0x100) parts.push("Shift");
  if (value & 0x200) parts.push("Ctrl");
  if (value & 0x400) parts.push("Alt");
  parts.push(virtualKeyName(key));
  return parts.join("+");
}

function virtualKeyName(key: number): string {
  if (key >= 0x30 && key <= 0x39) return String.fromCharCode(key);
  if (key >= 0x41 && key <= 0x5a) return String.fromCharCode(key);
  if (key >= 0x60 && key <= 0x69) return `Numpad ${key - 0x60}`;
  if (key >= 0x70 && key <= 0x87) return `F${key - 0x6f}`;
  const names: Record<number, string> = {
    0x08: "Backspace",
    0x09: "Tab",
    0x0c: "Numpad 5",
    0x0d: "Enter",
    0x13: "Pause",
    0x14: "Caps Lock",
    0x1b: "Esc",
    0x20: "Space",
    0x21: "Page Up",
    0x22: "Page Down",
    0x23: "End",
    0x24: "Home",
    0x25: "Left",
    0x26: "Up",
    0x27: "Right",
    0x28: "Down",
    0x2d: "Insert",
    0x2e: "Delete",
    0x6a: "Numpad *",
    0x6b: "Numpad +",
    0x6d: "Numpad -",
    0x6e: "Numpad .",
    0x6f: "Numpad /",
    0xba: ";",
    0xbb: "=",
    0xbc: ",",
    0xbd: "-",
    0xbe: ".",
    0xbf: "/",
    0xc0: "`",
    0xdb: "[",
    0xdc: "\\",
    0xdd: "]",
    0xde: "'",
  };
  return names[key] ?? `VK ${key}`;
}

/** The key combination of a browser key event as the game stores it, or null for a modifier alone. */
export function hotkeyFromEvent(event: KeyboardEvent): number | null {
  const pair = keyFor(event.code);
  if (!pair) return null;
  if (pair.vk === 0x10 || pair.vk === 0x11 || pair.vk === 0x12) return null;
  return (
    pair.vk +
    (event.shiftKey ? 0x100 : 0) +
    (event.ctrlKey ? 0x200 : 0) +
    (event.altKey ? 0x400 : 0)
  );
}

/**
 * The bindings a game offers before it has ever written its keyboard file. Copied from the shipped
 * files (`Keyboard.ini` for Red Alert 2, `KeyboardMD.ini` for Yuri's Revenge), so an import that has
 * no keyboard file still gets a usable Keyboard tab. The game itself supplies any command missing
 * from the file.
 */
const DEFAULT_KEYBOARD: Record<GameId, string> = {
  ra2: `[Hotkey]
CenterView=12
Options=27
CenterOnRadarEvent=32
RightSidebarUp=33
RightSidebarDown=34
LeftSidebarDown=35
LeftSidebarUp=36
Delete=46
TeamSelect_10=48
TeamSelect_1=49
TeamSelect_2=50
TeamSelect_3=51
TeamSelect_4=52
TeamSelect_5=53
TeamSelect_6=54
TeamSelect_7=55
TeamSelect_8=56
TeamSelect_9=57
ToggleAlliance=65
PlaceBeacon=66
AllToCheer=67
DeployObject=68
InfantryTab=69
Follow=70
GuardObject=71
CenterBase=72
ToggleRepair=75
ToggleSell=76
NextObject=78
CombatantSelect=80
StructureTab=81
UnitTab=82
StopObject=83
TypeSelect=84
PageUser=85
DefenseTab=87
ScatterObject=88
PlanningMode=90
View1=112
View2=113
View3=114
View4=115
Taunt_1=116
Taunt_2=117
Taunt_3=118
Taunt_4=119
Taunt_5=120
Taunt_6=121
Taunt_7=122
Taunt_8=123
TeamAddSelect_10=304
TeamAddSelect_1=305
TeamAddSelect_2=306
TeamAddSelect_3=307
TeamAddSelect_4=308
TeamAddSelect_5=309
TeamAddSelect_6=310
TeamAddSelect_7=311
TeamAddSelect_8=312
TeamAddSelect_9=313
TeamCreate_10=560
TeamCreate_1=561
TeamCreate_2=562
TeamCreate_3=563
TeamCreate_4=564
TeamCreate_5=565
TeamCreate_6=566
TeamCreate_7=567
TeamCreate_8=568
TeamCreate_9=569
ScreenCapture=579
SetView1=624
SetView2=625
SetView3=626
SetView4=627
TeamCenter_10=1072
TeamCenter_1=1073
TeamCenter_2=1074
TeamCenter_3=1075
TeamCenter_4=1076
TeamCenter_5=1077
TeamCenter_6=1078
TeamCenter_7=1079
TeamCenter_8=1080
TeamCenter_9=1081
SidebarPageUp=2085
SidebarUp=2086
SidebarPageDown=2087
SidebarDown=2088
`,
  ra2md: `[Hotkey]
CenterView=12
Options=27
CenterOnRadarEvent=32
TeamSelect_10=48
TeamSelect_1=49
TeamSelect_2=50
TeamSelect_3=51
TeamSelect_4=52
TeamSelect_5=53
TeamSelect_6=54
TeamSelect_7=55
TeamSelect_8=56
TeamSelect_9=57
ToggleAlliance=65
PlaceBeacon=66
AllToCheer=67
DeployObject=68
InfantryTab=69
Follow=70
GuardObject=71
CenterBase=72
ToggleRepair=75
ToggleSell=76
PreviousObject=77
NextObject=78
CombatantSelect=80
StructureTab=81
UnitTab=82
StopObject=83
TypeSelect=84
PageUser=85
DefenseTab=87
ScatterObject=88
VeterancyNav=89
PlanningMode=90
SidebarDown=98
SidebarUp=104
Delete=110
View1=112
View2=113
View3=114
View4=115
Taunt_1=116
Taunt_2=117
Taunt_3=118
Taunt_4=119
Taunt_5=120
Taunt_6=121
Taunt_7=122
Taunt_8=123
CursorCheat=222
TeamAddSelect_10=304
TeamAddSelect_1=305
TeamAddSelect_2=306
TeamAddSelect_3=307
TeamAddSelect_4=308
TeamAddSelect_5=309
TeamAddSelect_6=310
TeamAddSelect_7=311
TeamAddSelect_8=312
TeamAddSelect_9=313
ScreenCapture=339
TeamCreate_10=560
TeamCreate_1=561
TeamCreate_2=562
TeamCreate_3=563
TeamCreate_4=564
TeamCreate_5=565
TeamCreate_6=566
TeamCreate_7=567
TeamCreate_8=568
TeamCreate_9=569
SetView1=624
SetView2=625
SetView3=626
SetView4=627
TeamCenter_10=1072
TeamCenter_1=1073
TeamCenter_2=1074
TeamCenter_3=1075
TeamCenter_4=1076
TeamCenter_5=1077
TeamCenter_6=1078
TeamCenter_7=1079
TeamCenter_8=1080
TeamCenter_9=1081
`,
};

export function defaultKeyboardIni(game: GameId): Ini {
  return parseIni(encodeLatin1(DEFAULT_KEYBOARD[game]));
}

/** The host's defaults when no `.host` file exists yet; smooth scaling is the launcher default. */
export function defaultHostIni(): Ini {
  return parseIni(encodeLatin1("[present]\nscale=smooth\nbars=blur\nhdvox=0\ncontrols=classic\n"));
}

/** A fresh RA2.INI / RA2MD.INI holding the game's own defaults for the sections the launcher edits. */
export function defaultMainIni(game: GameId): Ini {
  const defaults = gameSettingsDefaults(game);
  const lines: string[] = [];
  for (const [section, values] of Object.entries(defaults)) {
    const entries = Object.entries(values).filter(([, value]) => value !== "");
    if (entries.length === 0) continue;
    lines.push(`[${section}]`);
    for (const [key, value] of entries) lines.push(`${key}=${value}`);
    lines.push("");
  }
  // The skirmish screen shows the position, so the stored value is the inverse of the chosen speed.
  const storedMatchSpeed = 6 - DEFAULT_MATCH_SPEED;
  for (const section of MATCH_SPEED_SECTIONS)
    lines.push(`[${section}]`, `GameSpeed=${storedMatchSpeed}`, "");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return { eol: "\n", lines };
}

// ---- the player name (`[MultiPlayer] Handle`) ----------------------------------------------------

const isThai = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x0e01 && code <= 0x0e7f;
};

/** A Windows-874 byte → character map, built once from the browser's own decoder. */
let cp874Encoder: Map<string, number> | null | undefined;

function legacyEncoder(
  label: string,
  cached?: Map<string, number> | null,
): Map<string, number> | null {
  if (cached !== undefined) return cached;
  try {
    const decoder = new TextDecoder(label);
    const map = new Map<string, number>();
    for (let byte = 0; byte < 256; byte++) {
      const char = decoder.decode(Uint8Array.of(byte));
      if (char && !map.has(char)) map.set(char, byte);
    }
    return map;
  } catch {
    return null;
  }
}

function encodeThai(text: string): Uint8Array | null {
  cp874Encoder = legacyEncoder("windows-874", cp874Encoder);
  if (!cp874Encoder) return null;
  const bytes: number[] = [];
  for (const char of text) {
    const byte = cp874Encoder.get(char);
    if (byte === undefined) return null;
    bytes.push(byte);
  }
  return Uint8Array.from(bytes);
}

/**
 * The bytes of a name as the game stores them. Thai names use Windows-874 (the code page the Thai
 * font fix and the game's own `Handle` values use); everything else is a single Latin-1 byte.
 */
export function encodeGameText(text: string): Uint8Array | null {
  if ([...text].some(isThai)) return encodeThai(text);
  if ([...text].some((char) => (char.codePointAt(0) ?? 0) > 0xff)) return null;
  return encodeLatin1(text);
}

/** Reads a name back, preferring Windows-874 when the bytes are Thai. */
export function decodeGameText(bytes: Uint8Array): string {
  try {
    const thai = new TextDecoder("windows-874").decode(bytes);
    // A lone tone mark also appears when Western-1252 bytes are read as 874; require a Thai letter.
    if (
      [...thai].some((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code >= 0x0e01 && code <= 0x0e46;
      })
    )
      return thai;
  } catch {
    // Older browsers: fall through to Latin-1.
  }
  return decodeLatin1(bytes);
}

/** `[MultiPlayer] Handle`: a comma-separated hex encoding of the player's name. */
export function parseHandle(value: string | null): string {
  if (!value) return "";
  const bytes: number[] = [];
  for (const part of value.split(",")) {
    const text = part.trim();
    if (!text) continue;
    const byte = Number.parseInt(text, 16);
    if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) return "";
    bytes.push(byte);
  }
  return decodeGameText(Uint8Array.from(bytes));
}

export function formatHandle(name: string): string | null {
  const bytes = encodeGameText(name);
  if (!bytes) return null;
  if (bytes.length === 0) return "";
  return `${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(",")},`;
}

export { defaultMainValue };

export interface LoadedIni {
  /** The name the file has in OPFS: the saved one, else the imported one, else the default. */
  name: string;
  data: Uint8Array | null;
  ini: Ini | null;
}

export interface LoadedGameSettings {
  main: LoadedIni;
  /** The host's `.host/<edition>.ini` (scaling, controls, mods); null values mean defaults. */
  host: LoadedIni;
  keyboard: LoadedIni;
  hotkeys: Hotkey[];
  /** No settings file: `main` holds the game's defaults. */
  mainFromDefaults: boolean;
  /** No keyboard file (or no bindings in it): `hotkeys` are the game's built-in defaults. */
  keyboardFromDefaults: boolean;
}

export interface GameSettingsDeps {
  readSave(storage: string, name: string): Promise<SavedSettingsFile | null>;
  writeSave(storage: string, name: string, data: Uint8Array): Promise<void>;
  readImported(home: string, name: string): Promise<Uint8Array>;
}

function bytesStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

function defaultReadSave(storage: string, name: string): Promise<SavedSettingsFile | null> {
  return readSaveFile(storage, name);
}

async function defaultWriteSave(storage: string, name: string, data: Uint8Array): Promise<void> {
  await opfsTarget().write(`save/${storage}/${name}`, bytesStream(data));
}

function importedEntry(
  game: GameRecord,
  wanted: string,
): [string, GameRecord["files"][string]] | null {
  for (const entry of Object.entries(game.files)) {
    if (entry[0].toLowerCase() === wanted) return entry;
  }
  return null;
}

/** The game's saved settings, else the imported ones. */
export async function loadGameSettings(
  game: GameRecord,
  deps: Partial<GameSettingsDeps> = {},
): Promise<LoadedGameSettings> {
  const names = settingsFileNames(game.id);
  const readSave = deps.readSave ?? defaultReadSave;
  const readImported = deps.readImported ?? readGameFile;

  const load = async (key: "main" | "keyboard"): Promise<LoadedIni> => {
    const wanted = names[key];
    const saved = await readSave(game.storage, wanted);
    if (saved) return { name: saved.name, data: saved.data, ini: parseIni(saved.data) };

    const imported = importedEntry(game, wanted);
    if (imported) {
      try {
        const data = await readImported(imported[1].home, imported[0]);
        return { name: imported[0], data, ini: parseIni(data) };
      } catch {
        // A partial import may have no INI; changing a setting creates one.
      }
    }
    return { name: wanted, data: null, ini: null };
  };

  const main = await load("main");
  const mainFromDefaults = main.ini === null;
  if (mainFromDefaults) {
    main.ini = defaultMainIni(game.id);
    main.data = serializeIni(main.ini);
  } else if (game.id === "ra2" && main.ini) {
    const ini = compactIniLast(main.ini);
    main.ini = ini;
    main.data = serializeIni(ini);
  }
  if (main.ini) {
    const ini = compactIniSections(main.ini, MATCH_SPEED_SECTIONS);
    main.ini = ini;
    main.data = serializeIni(ini);
  }
  const hostPath = `.host/${names.main}`;
  const savedHost = await readSave(game.storage, hostPath);
  const host: LoadedIni = savedHost
    ? { name: hostPath, data: savedHost.data, ini: parseIni(savedHost.data) }
    : { name: hostPath, data: null, ini: null };

  const keyboard = await load("keyboard");
  const savedHotkeys = parseHotkeys(keyboard.ini);
  const keyboardFromDefaults = savedHotkeys.length === 0;
  return {
    main,
    host,
    keyboard,
    hotkeys: keyboardFromDefaults ? parseHotkeys(defaultKeyboardIni(game.id)) : savedHotkeys,
    mainFromDefaults,
    keyboardFromDefaults,
  };
}

/**
 * A fresh import has no settings file. Write the launcher's defaults into the save store before the
 * game starts, so the first launch already uses them instead of the engine's untouched defaults.
 * Only the file's presence is checked, so a large imported INI is not read a second time.
 *
 * `[Intro] Play` is kept at `no` in the game INI: the start-up intro is the host's
 * `--intro` / `--no-intro`, and the stock INI flag would otherwise play it a second time.
 */
export async function ensureDefaultMainSettings(
  game: GameRecord,
  deps: Partial<GameSettingsDeps> = {},
): Promise<void> {
  const names = settingsFileNames(game.id);
  const saved = await (deps.readSave ?? defaultReadSave)(game.storage, names.main);
  if (saved) {
    const ini = parseIni(saved.data);
    const migrated =
      readIniVideoChoice(ini) === undefined
        ? writeIniVideoChoice(ini, readVideoChoice(game.storage))
        : null;
    const patched = withIntroPlayOff(migrated ? serializeIni(migrated) : saved.data) ?? migrated;
    if (patched) await writeGameSettings(game, saved.name, serializeIni(patched), deps);
    return;
  }
  const imported = importedEntry(game, names.main);
  if (imported) {
    const data = await (deps.readImported ?? readGameFile)(imported[1].home, imported[0]);
    let patched = withIntroPlayOff(data) ?? parseIni(data);
    if (readIniVideoChoice(patched) === undefined)
      patched = writeIniVideoChoice(patched, readVideoChoice(game.storage));
    await writeGameSettings(game, imported[0], serializeIni(patched), deps);
    return;
  }
  await writeGameSettings(
    game,
    gameIniName(game.id),
    serializeIni(
      writeIniVideoChoice(
        setIniValue(defaultMainIni(game.id), "Intro", "Play", "no"),
        readVideoChoice(game.storage),
      ),
    ),
    deps,
  );
}

/** The game INI with `[Intro] Play=no`, or null when it already says that. */
function withIntroPlayOff(data: Uint8Array): Ini | null {
  const ini = parseIni(data);
  if (getIniValue(ini, "Intro", "Play") === "no") return null;
  return setIniValue(ini, "Intro", "Play", "no");
}

/** A fresh profile has no host file either; write its defaults before the host reads them. */
export async function ensureDefaultHostSettings(
  game: GameRecord,
  deps: Partial<GameSettingsDeps> = {},
): Promise<void> {
  const path = `.host/${settingsFileNames(game.id).main}`;
  if (await (deps.readSave ?? defaultReadSave)(game.storage, path)) return;
  await writeGameSettings(game, path, serializeIni(defaultHostIni()), deps);
}

/** Adds every default binding the file does not have yet, keeping the lines that are already there. */
export function withDefaultHotkeys(game: GameId, ini: Ini): Ini {
  let out = ini;
  for (const hotkey of parseHotkeys(defaultKeyboardIni(game)))
    out = setIniValue(out, "Hotkey", hotkey.name, String(hotkey.value));
  return out;
}

/** Writes one settings file to `save/<storage>/`, where the next start restores it. */
export async function writeGameSettings(
  game: GameRecord,
  name: string,
  data: Uint8Array,
  deps: Partial<GameSettingsDeps> = {},
): Promise<void> {
  await (deps.writeSave ?? defaultWriteSave)(game.storage, name, data);
}
