// The content model of an XCC mod pack (docs/mod-packs.md §2), read from the
// XIF tree. Independent implementation; no XCC Utilities code (GPLv3) was
// copied or translated. MIT.

import { xifBytes, xifInt, xifKey, xifText, type XifNode } from "./xif";

export type ModGame = "ra2" | "ra2md";

/** Root value ids (`xcc_mod.cpp:152-187`). */
const VI_FNAME = 3;
const VI_FT = 4;
const VI_FDATA = 5;
const VI_ENCODING = 6;
const VI_NAME = 7;
const VI_MAIL = 8;
const VI_LINK_TITLE = 9;
const VI_LINK = 10;
const VI_GAME = 11;
const VI_MOD_NAME = 12;
const VI_MOD_VERSION = 21;
const VI_MOD_UCF = 22;
const VI_MF_VERSION = 24;
const VI_CB_D = 27;
const VI_MODE = 28;
const VI_MODULE = 29;
const VI_MOD_MFS = 30;
const KI_MODES = 0x100;
const KI_MODULES = 0x101;
const MAX_FORMAT_VERSION = 2;

export const enum Category {
  Cameo = 0,
  Hva = 1,
  Ini = 2,
  Map = 3,
  Mix = 4,
  Screen = 5,
  Shp = 6,
  Sound = 7,
  Speech = 8,
  StringTable = 9,
  Theme = 10,
  Video = 11,
  Vxl = 12,
  Launcher = 13,
  Manual = 14,
  Interface = 15,
  Tmp = 16,
  Side1 = 17,
  Side2 = 18,
  Side3 = 19,
}

export const CATEGORY_NAMES: Record<number, string> = {
  0: "cameo",
  1: "hva",
  2: "ini",
  3: "map",
  4: "mix",
  5: "screen",
  6: "shp",
  7: "sound",
  8: "speech",
  9: "string table",
  10: "theme",
  11: "video",
  12: "vxl",
  13: "launcher",
  14: "manual",
  15: "interface",
  16: "tmp",
  17: "side 1",
  18: "side 2",
  19: "side 3",
};

/** `t_file_type` values the builder asks about (`cc_file.h:24`). */
export const FileType = {
  Csf: 7,
  Ini: 16,
  Jpeg: 17,
  MapRa2: 24,
  Mix: 25,
  Ogg: 30,
  PcxSingle: 34,
  Pcx: 35,
  Shp: 43,
  ShpTs: 44,
  StringTable: 47,
  Text: 48,
  TmpTs: 55,
  Vxl: 60,
  Wav: 62,
  Xif: 69,
} as const;

export const Encoding = {
  None: 0,
  Diff: 1,
  Shp: 7,
  Vxl: 8,
} as const;

export interface ModOptions {
  author: string;
  mail: string;
  linkTitle: string;
  link: string;
  /** the folder/launcher title */
  modName: string;
  version: string;
  updateLink: string;
  game: ModGame;
  /** the `expand##.mix` / `ecache##.mix` number, normally "98" */
  mfs: string;
}

export interface ModEntry {
  category: number;
  /** base name only */
  fname: string;
  /** `t_file_type`, or -1 when the pack did not record it */
  ft: number;
  encoding: number;
  /** decoded size for an SHP/VXL stream */
  decodedSize?: number;
  /** -1 = always */
  mode: number;
  /** -1 = base file, otherwise the module that brought it */
  module: number;
  bytes: Uint8Array;
}

export interface ModNamedId {
  id: number;
  name: string;
}

export interface ModPack {
  options: ModOptions;
  modes: ModNamedId[];
  modules: ModNamedId[];
  entries: ModEntry[];
  warnings: string[];
}

export class ModPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModPackError";
  }
}

/** Reads the key tree into the pack's options, modes, modules and entries. */
export function parseModPack(root: XifNode, nameHint = ""): ModPack {
  const warnings: string[] = [];
  const format = xifInt(root.values.get(VI_MF_VERSION), 0);
  if (format > MAX_FORMAT_VERSION)
    throw new ModPackError(
      "This mod pack needs a newer XCC Mod Launcher than this page understands.",
    );

  const gameValue = xifInt(root.values.get(VI_GAME), 6);
  const game: ModGame = gameValue === 5 ? "ra2" : "ra2md";
  if (gameValue !== 5 && gameValue !== 6)
    warnings.push(`The pack's game value ${gameValue} is unknown; importing it as Yuri's Revenge.`);

  const mfs = mixNumber(xifText(root.values.get(VI_MOD_MFS), "98"), warnings);
  const options: ModOptions = {
    author: xifText(root.values.get(VI_NAME)),
    mail: xifText(root.values.get(VI_MAIL)),
    linkTitle: xifText(root.values.get(VI_LINK_TITLE)),
    link: xifText(root.values.get(VI_LINK)),
    modName: xifText(root.values.get(VI_MOD_NAME)) || nameHint || "XCC Mod",
    version: xifText(root.values.get(VI_MOD_VERSION), "1.00"),
    updateLink: xifText(root.values.get(VI_MOD_UCF)),
    game,
    mfs,
  };

  const modes = readNamedIds(xifKey(root, KI_MODES));
  const modules = readNamedIds(xifKey(root, KI_MODULES));

  const entries: ModEntry[] = [];
  const seen = new Set<string>();
  for (const [category, node] of root.keys) {
    if (category === KI_MODES || category === KI_MODULES) continue;
    if (category < Category.Cameo || category > Category.Side3) {
      warnings.push(`The pack has an unknown category ${category}; its files were left out.`);
      continue;
    }
    for (const entryNode of node.keys.values()) {
      const entry = readEntry(category, entryNode, warnings);
      if (!entry) continue;
      const key = `${category}/${entry.fname.toLowerCase()}`;
      if (seen.has(key)) {
        warnings.push(
          `${entry.fname} appears twice in ${CATEGORY_NAMES[category]}; the last was kept.`,
        );
        const at = entries.findIndex(
          (candidate) =>
            candidate.category === category &&
            candidate.fname.toLowerCase() === entry.fname.toLowerCase(),
        );
        if (at >= 0) entries.splice(at, 1);
      }
      seen.add(key);
      entries.push(entry);
    }
  }

  return { options, modes, modules, entries, warnings };
}

/** The entries that apply to a mode: the always-on ones plus that mode's. */
export function entriesForMode(pack: ModPack, mode = -1): ModEntry[] {
  return pack.entries.filter((entry) => entry.mode === -1 || entry.mode === mode);
}

/** Adds a sibling module pack's entries; module files carry no options. */
export function mergeModule(pack: ModPack, module: ModPack): void {
  for (const entry of module.entries) pack.entries.push(entry);
  pack.warnings.push(...module.warnings);
}

/**
 * The mod's folder name, safe for the importer's 1-64 character rule: a letter
 * or number first, then letters, numbers, space, dot, underscore or dash.
 */
export function packFolderName(pack: ModPack, fileStem = ""): string {
  const raw = pack.options.modName || fileStem || "XCC Mod";
  let name = Array.from(raw)
    .map((char) => (/[\p{L}\p{N} _.-]/u.test(char) ? char : " "))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  name = name.replace(/^[^\p{L}\p{N}]+/u, "");
  if (!name) name = "XCC Mod";
  name = Array.from(name).slice(0, 64).join("").trim();
  if (!name) name = "XCC Mod";
  if (new TextEncoder().encode(name).length >= 128) name = Array.from(name).slice(0, 60).join("");
  return name;
}

function readNamedIds(node: XifNode | undefined): ModNamedId[] {
  if (!node) return [];
  const out: ModNamedId[] = [];
  for (const [id, value] of node.values) out.push({ id, name: xifText(value) });
  return out.sort((a, b) => a.id - b.id);
}

function readEntry(category: number, node: XifNode, warnings: string[]): ModEntry | null {
  const fname = baseName(xifText(node.values.get(VI_FNAME)));
  if (!fname) {
    warnings.push(`A file in ${CATEGORY_NAMES[category]} has no usable name; it was left out.`);
    return null;
  }
  const bytes = xifBytes(node.values.get(VI_FDATA));
  if (!bytes.length) {
    warnings.push(`${fname} has no data in the pack; it was left out.`);
    return null;
  }
  const entry: ModEntry = {
    category,
    fname,
    ft: xifInt(node.values.get(VI_FT), -1),
    encoding: xifInt(node.values.get(VI_ENCODING), Encoding.None),
    mode: xifInt(node.values.get(VI_MODE), -1),
    module: xifInt(node.values.get(VI_MODULE), -1),
    bytes,
  };
  if (node.values.has(VI_CB_D)) entry.decodedSize = xifInt(node.values.get(VI_CB_D));
  return entry;
}

/** The last path part, with `/`, `\` and control characters removed. */
function baseName(name: string): string {
  const parts = name.split(/[\\/]/);
  const base = parts[parts.length - 1] ?? "";
  let cleaned = "";
  for (const character of base) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) continue;
    if ('<>:"|?*'.includes(character)) continue;
    cleaned += character;
  }
  return cleaned.trim();
}

function mixNumber(value: string, warnings: string[]): string {
  const digits = value.replace(/\D/g, "").slice(0, 2);
  if (!digits) {
    if (value) warnings.push(`The pack's mix number "${value}" is not a number; using 98.`);
    return "98";
  }
  return digits.padStart(2, "0");
}
