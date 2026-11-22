// Turns a mod pack into the files XCC Mod Launcher would put in the game
// folder (docs/mod-packs.md §3): the expand and ecache MIX files, a merged
// string table, and the loose files. Independent implementation; MIT.

import { parseCsf, rewriteCsf, type CsfFile } from "../csf";
import { mixHash, readMixIndex } from "../mix";
import { applyIniDiff, parseTextPairs } from "./ini";
import { writeMix, writeMixEntries, type MixInput } from "./mix-write";
import {
  Category,
  Encoding,
  entriesForMode,
  FileType,
  type ModEntry,
  type ModGame,
  type ModPack,
} from "./model";
import { decodeShp4 } from "./shp4";
import { decodeVxl4 } from "./vxl4";

export interface BaseData {
  /** A loose file or the edition's local MIX: rulesmd.ini and friends. */
  ini(name: string): Promise<Uint8Array | null>;
  /** The language MIX's ra2md.csf. */
  csf(): Promise<Uint8Array | null>;
  /** The stock sidec0N.mix, so a sidebar change keeps the untouched entries. */
  sideMix(side: 1 | 2 | 3): Promise<Uint8Array | null>;
}

export interface BuiltPack {
  files: MixInput[];
  warnings: string[];
  /** the edition the pack targets */
  game: ModGame;
}

export async function buildModPack(pack: ModPack, base: BaseData): Promise<BuiltPack> {
  const warnings = [...pack.warnings];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };

  let mode = -1;
  let entries = entriesForMode(pack, -1);
  if (!entries.length && pack.modes.length) {
    const first = [...pack.modes].sort((a, b) => a.id - b.id)[0]!;
    mode = first.id;
    entries = entriesForMode(pack, mode);
    warn(`The pack's files are in the “${first.name}” mode; that mode was imported.`);
  }

  const expand: MixInput[] = [];
  const ecache: MixInput[] = [];
  const loose: MixInput[] = [];
  const sides: Record<1 | 2 | 3, MixInput[]> = { 1: [], 2: [], 3: [] };
  const stringTable: ModEntry[] = [];
  let sawLauncher = false;
  let sawSound = false;

  for (const entry of entries) {
    const decoded = decodeEntry(entry, pack.options.game, warn);
    if (!decoded) continue;
    switch (entry.category) {
      case Category.Launcher:
      case Category.Manual:
        sawLauncher = true;
        break;
      case Category.Sound:
        sawSound = true;
        break;
      case Category.Theme:
      case Category.Video:
        add(loose, entry.fname, decoded);
        break;
      case Category.StringTable:
        stringTable.push({ ...entry, bytes: decoded });
        break;
      case Category.Ini:
        if (entry.fname.toLowerCase() === "missionsmd.pkt") {
          add(loose, entry.fname, decoded);
          break;
        }
        if (entry.encoding === Encoding.Diff) {
          const original = await base.ini(entry.fname);
          if (!original) {
            warn(
              `${entry.fname} is a difference from a file this install does not have; it was left out.`,
            );
            break;
          }
          add(expand, entry.fname, applyIniDiff(original, decoded));
        } else {
          add(expand, entry.fname, decoded);
        }
        break;
      case Category.Screen:
        if (/^(glsmd\.pal|glslmd\.shp)$/i.test(entry.fname)) add(loose, entry.fname, decoded);
        else add(expand, entry.fname, decoded);
        break;
      case Category.Side1:
        add(sides[1], entry.fname, decoded);
        break;
      case Category.Side2:
        add(sides[2], entry.fname, decoded);
        break;
      case Category.Side3:
        add(sides[3], entry.fname, decoded);
        break;
      case Category.Cameo:
      case Category.Shp:
      case Category.Speech:
      case Category.Tmp:
        add(ecache, entry.fname, decoded);
        break;
      case Category.Map:
      case Category.Mix:
      case Category.Hva:
      case Category.Vxl:
      case Category.Interface:
        add(expand, entry.fname, decoded);
        break;
      default:
        add(expand, entry.fname, decoded);
        break;
    }
  }

  if (sawLauncher) warn("The pack's launcher art and manual are not part of the game folder.");
  if (sawSound) warn("The pack's sounds are not imported yet (audio.bag/audio.idx is not merged).");
  for (const [side, list] of Object.entries(sides) as [string, MixInput[]][]) {
    if (!list.length) continue;
    const merged = await mergeSide(Number(side) as 1 | 2 | 3, list, base, warn);
    if (merged)
      expand.push({
        name: sideMixName(pack.options.game, Number(side) as 1 | 2 | 3),
        bytes: merged,
      });
  }

  const csfName = pack.options.game === "ra2md" ? "ra2md.csf" : "ra2.csf";
  const csf = await mergeStringTable(stringTable, base, warn);
  if (csf) loose.push({ name: csfName, bytes: csf });

  const suffix = pack.options.game === "ra2md" ? "md" : "";
  const files: MixInput[] = [];
  if (expand.length)
    files.push({ name: `expand${suffix}${pack.options.mfs}.mix`, bytes: writeMix(expand) });
  if (ecache.length)
    files.push({ name: `ecache${suffix}${pack.options.mfs}.mix`, bytes: writeMix(ecache) });
  files.push(...loose);
  return { files: dedupe(files, warn), warnings, game: pack.options.game };
}

function decodeEntry(
  entry: ModEntry,
  game: ModGame,
  warn: (message: string) => void,
): Uint8Array | null {
  if (entry.category === Category.Launcher || entry.category === Category.Manual)
    return entry.bytes;
  if (entry.ft === FileType.Jpeg) {
    warn(
      `${entry.fname} is JPEG art, which this importer does not convert to PCX yet; it was left out.`,
    );
    return null;
  }
  if (entry.ft === FileType.Ogg) {
    warn(`${entry.fname} is Ogg audio, which this importer does not convert yet; it was left out.`);
    return null;
  }
  if (
    entry.ft === FileType.PcxSingle &&
    (entry.category === Category.Cameo || (entry.category === Category.Screen && game === "ra2"))
  ) {
    warn(
      `${entry.fname} is a one-plane PCX, which this importer does not convert to SHP yet; it was left out.`,
    );
    return null;
  }
  if (entry.ft === FileType.Xif && entry.category === Category.Map) {
    warn(
      `${entry.fname} is a map project, which this importer does not convert yet; it was left out.`,
    );
    return null;
  }
  try {
    if (entry.encoding === Encoding.Shp) return decodeShp4(entry.bytes, entry.decodedSize);
    if (entry.encoding === Encoding.Vxl) return decodeVxl4(entry.bytes, entry.decodedSize);
  } catch (error) {
    warn(`${entry.fname} could not be decoded (${errorMessage(error)}); it was left out.`);
    return null;
  }
  return entry.bytes;
}

async function mergeStringTable(
  entries: ModEntry[],
  base: BaseData,
  warn: (message: string) => void,
): Promise<Uint8Array | null> {
  if (!entries.length) return null;
  let current: CsfFile | null = null;
  for (const entry of entries) {
    if (!/\.csf$/i.test(entry.fname)) continue;
    if (entry.encoding !== Encoding.Diff && entry.ft !== FileType.Text) {
      try {
        current = parseCsf(entry.bytes);
      } catch (error) {
        warn(
          `${entry.fname} is not a readable string table (${errorMessage(error)}); it was left out.`,
        );
      }
    }
  }
  if (!current) {
    const original = await base.csf();
    if (!original) {
      warn(
        "This pack changes the string table, but the base string table is missing; it was left out.",
      );
      return null;
    }
    try {
      current = parseCsf(original);
    } catch (error) {
      warn(
        `The base string table is not readable (${errorMessage(error)}); the pack's changes were left out.`,
      );
      return null;
    }
  }

  const strings: Record<string, string> = {};
  const extra: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    if (entry.encoding === Encoding.Diff) {
      try {
        for (const value of parseCsf(entry.bytes).entries) {
          const first = value.values[0];
          if (!first) continue;
          strings[value.label] = first.value;
          if (first.extra) extra[value.label] = first.extra;
        }
      } catch (error) {
        warn(
          `${entry.fname} is not a readable string-table difference (${errorMessage(error)}); it was left out.`,
        );
      }
    } else if (entry.ft === FileType.Text) {
      for (const pair of parseTextPairs(entry.bytes)) strings[pair.name] = pair.value;
    }
  }
  if (!Object.keys(strings).length) return null;
  try {
    return rewriteCsf(current, { strings, extra, inject: true }).data;
  } catch (error) {
    warn(`The pack's string table could not be written (${errorMessage(error)}); it was left out.`);
    return null;
  }
}

async function mergeSide(
  side: 1 | 2 | 3,
  files: MixInput[],
  base: BaseData,
  warn: (message: string) => void,
): Promise<Uint8Array | null> {
  const original = await base.sideMix(side);
  if (!original) {
    warn(`The stock side ${side} archive is missing; the pack's sidebar changes were left out.`);
    return null;
  }
  try {
    const index = readMixIndex(original);
    const merged = new Map<number, Uint8Array>();
    for (const entry of index.entries) {
      const start = index.bodyOffset + entry.offset;
      merged.set(entry.id, original.subarray(start, start + entry.size));
    }
    for (const file of files) merged.set(mixHash(file.name), file.bytes);
    return writeMixEntries([...merged].map(([id, bytes]) => ({ id, bytes })));
  } catch (error) {
    warn(
      `The stock side ${side} archive could not be read (${errorMessage(error)}); its changes were left out.`,
    );
    return null;
  }
}

function sideMixName(game: ModGame, side: 1 | 2 | 3): string {
  if (game === "ra2md" && side === 3) return "sidec02md.mix";
  return `sidec0${side}.mix`;
}

function add(list: MixInput[], name: string, bytes: Uint8Array): void {
  const at = list.findIndex((file) => file.name.toLowerCase() === name.toLowerCase());
  if (at >= 0) list.splice(at, 1);
  list.push({ name, bytes });
}

function dedupe(files: MixInput[], warn: (message: string) => void): MixInput[] {
  const seen = new Set<string>();
  const out: MixInput[] = [];
  for (const file of files) {
    const key = file.name.toLowerCase();
    if (seen.has(key)) {
      warn(`${file.name} was produced twice; the last copy was kept.`);
      const at = out.findIndex((candidate) => candidate.name.toLowerCase() === key);
      if (at >= 0) out.splice(at, 1);
    }
    seen.add(key);
    out.push(file);
  }
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
