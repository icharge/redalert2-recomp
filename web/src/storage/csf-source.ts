// Find the string table the game will read for an edition: the active mod's
// loose CSF, the import's loose CSF, or the copy inside the language MIX.

import { readMixEntry } from "./mix";
import { settingsFileNames } from "./settings-files";

export type CsfGame = "ra2" | "ra2md";

export interface CsfSourceFs {
  readdir(path: string): string[];
  readFile(path: string): Uint8Array;
  stat?(path: string): { size: number } | undefined;
  /**
   * Reads a large imported file (the language MIX) from the save store rather
   * than through a WasmFS symlink. The page can read it; the game thread's
   * symlink target is not always visible to the page's FS.
   */
  readBigFile?(path: string): Promise<Uint8Array> | Uint8Array;
}

export interface BaseCsf {
  data: Uint8Array;
  /** the in-memory path it came from, for the launcher's explanation */
  path: string;
  source: "mod" | "loose" | "mix";
}

export interface FindBaseCsfOptions {
  /** Only archives up to this size are scanned after the language MIX. */
  maxScanBytes?: number;
}

const LANGUAGE_MIX: Record<CsfGame, string> = {
  ra2: "language.mix",
  ra2md: "langmd.mix",
};

const CSF_NAME: Record<CsfGame, string> = {
  ra2: "ra2.csf",
  ra2md: "ra2md.csf",
};

export function csfName(game: CsfGame): string {
  return CSF_NAME[game];
}

export function languageMixName(game: CsfGame): string {
  return LANGUAGE_MIX[game];
}

/** The host settings file, where the active mod is remembered. */
export function hostIniPath(game: CsfGame): string {
  return `/game/.host/${settingsFileNames(game).main}`;
}

function findCaseInsensitive(fs: CsfSourceFs, dir: string, wanted: string): string | null {
  let names: string[];
  try {
    names = fs.readdir(dir);
  } catch {
    return null;
  }
  const lower = wanted.toLowerCase();
  return names.find((name) => name.toLowerCase() === lower) ?? null;
}

async function fileAt(fs: CsfSourceFs, path: string): Promise<Uint8Array | null> {
  if (fs.readBigFile) {
    try {
      return await fs.readBigFile(path);
    } catch {
      // fall through to the in-memory file, which is right for a loose CSF or a mod
    }
  }
  try {
    return fs.readFile(path);
  } catch {
    return null;
  }
}

async function activeMod(game: CsfGame, fs: CsfSourceFs): Promise<string> {
  const path = hostIniPath(game);
  const data = await fileAt(fs, path);
  if (!data) return "";
  const text = new TextDecoder("latin1").decode(data);
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = (header[1] ?? "").trim().toLowerCase();
      continue;
    }
    const equals = line.indexOf("=");
    if (equals < 0) continue;
    if (section !== "mods") continue;
    if (line.slice(0, equals).trim().toLowerCase() !== "active") continue;
    const value = line.slice(equals + 1).trim();
    return /^none$/i.test(value) ? "" : value;
  }
  return "";
}

/** The base CSF for this edition, in the game's in-memory file system. */
export async function findBaseCsf(
  fs: CsfSourceFs,
  game: CsfGame,
  options: FindBaseCsfOptions = {},
): Promise<BaseCsf | null> {
  const name = csfName(game);
  const mod = await activeMod(game, fs);
  if (mod) {
    const modDir = findCaseInsensitive(fs, "/game/mods", mod);
    if (modDir) {
      const csf = findCaseInsensitive(fs, `/game/mods/${modDir}`, name);
      if (csf) {
        const data = await fileAt(fs, `/game/mods/${modDir}/${csf}`);
        if (data) return { data, path: `/game/mods/${modDir}/${csf}`, source: "mod" };
      }
    }
  }

  const loose = findCaseInsensitive(fs, "/game", name);
  if (loose) {
    const data = await fileAt(fs, `/game/${loose}`);
    if (data) return { data, path: `/game/${loose}`, source: "loose" };
  }

  const language = findCaseInsensitive(fs, "/game", LANGUAGE_MIX[game]);
  if (language) {
    const archive = await fileAt(fs, `/game/${language}`);
    if (archive) {
      const data = readMixEntrySafe(archive, name);
      if (data) return { data, path: `/game/${language}:${name}`, source: "mix" };
    }
  }

  // A mod or an expansion can put the table in another archive. Only small
  // archives are scanned: reading a multi-hundred-megabyte `ra2.mix` just to
  // look for a name would cost more than the feature is worth.
  const maxScan = options.maxScanBytes ?? 32 * 1024 * 1024;
  let names: string[] = [];
  try {
    names = fs.readdir("/game");
  } catch {
    return null;
  }
  for (const entry of names) {
    if (!/\.mix$/i.test(entry)) continue;
    if (entry.toLowerCase() === LANGUAGE_MIX[game]) continue;
    const path = `/game/${entry}`;
    if (fs.stat) {
      let size: number | undefined;
      try {
        size = fs.stat(path)?.size;
      } catch {
        size = undefined;
      }
      if (size === undefined || size > maxScan) continue;
    }
    const archive = await fileAt(fs, path);
    if (!archive) continue;
    const data = readMixEntrySafe(archive, name);
    if (data) return { data, path: `${path}:${name}`, source: "mix" };
  }
  return null;
}

function readMixEntrySafe(archive: Uint8Array, name: string): Uint8Array | null {
  try {
    return readMixEntry(archive, name);
  } catch {
    return null;
  }
}
