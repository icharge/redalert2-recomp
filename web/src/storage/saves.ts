// What the game writes while it runs, kept across reloads (docs/web/storage.md, "The layout in OPFS").
//
// The game's folder is an in-memory file system for as long as the page is open (game/loader.ts); its
// large files are only links to the import in OPFS. What it writes (a saved game, its settings file)
// would go with the page, so this puts it in OPFS under `save/<game>/` as it happens, and puts it back
// over the game's files the next time it starts. Only files that are new, or changed since the game
// started, are kept: the game's own files are already in OPFS from the import.

import type { CopyTarget } from "./opfs";
import { isRuntimeInput } from "./install";

/** What FS.stat answers: WasmFS gives the time in seconds as a number, the older file system a Date. */
export interface StatLike {
  mode: number;
  size: number;
  mtime: Date | number;
}

/** The parts of Emscripten's FS this uses. WasmFS has no isDir; `lstat`, `unlink` and `symlink` are for links. */
export interface FsLike {
  readdir(path: string): string[];
  stat(path: string): StatLike;
  lstat?(path: string): StatLike;
  isDir?(mode: number): boolean;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array): void;
  mkdir(path: string): void;
  unlink?(path: string): void;
  symlink?(target: string, path: string): void;
}

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

export const isDirectory = (fs: FsLike, mode: number): boolean =>
  fs.isDir ? fs.isDir(mode) : (mode & S_IFMT) === S_IFDIR;

/** A stat time as milliseconds. */
export const modifiedMs = (mtime: Date | number): number =>
  typeof mtime === "number" ? mtime * 1000 : mtime.getTime();

/** Whether the path is a link into the import (files the game reads in place), not a file of its own. */
export function isLink(fs: FsLike, path: string): boolean {
  if (!fs.lstat) return false;
  try {
    return (fs.lstat(path).mode & S_IFMT) === S_IFLNK;
  } catch {
    return false;
  }
}

/**
 * Writes a whole file. If the path is a link into the import the link goes first: writing through it
 * would change the imported file itself.
 */
export function replaceFile(fs: FsLike, path: string, data: Uint8Array): void {
  if (fs.unlink && isLink(fs, path)) fs.unlink(path);
  fs.writeFile(path, data);
}

const GAME = "/game";
const PROFILE_INI_COMPACT_THRESHOLD = 1024 * 1024;

/**
 * The current Yuri HLE profile reader uses the first section and key match. Keep those original lines and
 * discard later duplicate sections/keys from oversized saved RA2MD.INI files. The raw byte slices preserve
 * the game's ANSI values; only ASCII section and key names are decoded for comparison.
 */
function compactProfileIni(data: Uint8Array): Uint8Array {
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  const sections = new Set<string>();
  let sectionDuplicate = false;
  let keys = new Set<string>();
  let size = 0;

  const keep = (start: number, end: number) => {
    const chunk = data.subarray(start, end);
    chunks.push(chunk);
    size += chunk.byteLength;
  };

  for (let start = 0; start < data.byteLength;) {
    let end = start;
    while (end < data.byteLength && data[end] !== 0x0a) end++;
    if (end < data.byteLength) end++;

    const contentEnd = end > start && data[end - 1] === 0x0a ? end - 1 : end;
    const lineEnd =
      contentEnd > start && data[contentEnd - 1] === 0x0d ? contentEnd - 1 : contentEnd;
    const lineBytes = data.subarray(start, lineEnd);
    const line = lineBytes.byteLength <= 4096 ? decoder.decode(lineBytes) : "";
    const header = /^\[([^\]]+)\]$/.exec(line);

    if (header) {
      const section = header[1]?.toLowerCase() ?? "";
      sectionDuplicate = sections.has(section);
      if (!sectionDuplicate) {
        sections.add(section);
        keys = new Set();
        keep(start, end);
      }
    } else if (!sectionDuplicate) {
      const key = /^([^=\s]+)=/.exec(line)?.[1]?.toLowerCase();
      if (!key || !keys.has(key)) {
        if (key) keys.add(key);
        keep(start, end);
      }
    }

    // No useful compaction is possible once the retained prefix is already large.
    if (size > PROFILE_INI_COMPACT_THRESHOLD) return data;
    start = end;
  }

  if (size >= data.byteLength) return data;
  const compacted = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    compacted.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return compacted;
}

/** Files the game writes that are not worth keeping. */
const IGNORED = /^(debug\.log|.*\.tmp)$/i;

function isMissingDirectory(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const detail = error as { code?: unknown; errno?: unknown; message?: unknown };
  return (
    detail.code === "ENOENT" ||
    detail.errno === 44 ||
    (typeof detail.message === "string" &&
      /no such directory|no such file or directory/i.test(detail.message))
  );
}

interface Seen {
  size: number;
  mtime: number;
}

/** Every file of the game's folder with its size and time: `Saved Games/` and the top level only. */
function scan(fs: FsLike, retryMissingRoot = false): Map<string, Seen> {
  const out = new Map<string, Seen>();
  const walk = (dir: string, prefix: string, deep: boolean) => {
    let names: string[];
    try {
      names = fs.readdir(dir);
    } catch (error) {
      // A save/mod folder can disappear between parent listing and this read. During later
      // scans, the game root can also be briefly unavailable; the next look will retry it.
      if ((dir !== GAME || retryMissingRoot) && isMissingDirectory(error)) return;
      throw error;
    }
    for (const name of names) {
      if (name === "." || name === "..") continue;
      const path = `${dir}/${name}`;
      let stat;
      try {
        // a link is a file of the import, which the game does not change: not worth the look
        if (isLink(fs, path)) continue;
        stat = fs.stat(path);
      } catch {
        continue;
      }
      if (isDirectory(fs, stat.mode)) {
        if (
          deep &&
          (name.toLowerCase() === "saved games" ||
            name === ".host" ||
            name.toLowerCase() === "mods" ||
            prefix.startsWith("mods/"))
        )
          walk(path, `${prefix}${name}/`, name.toLowerCase() !== "saved games");
      } else if (!IGNORED.test(name) && !(prefix === "" && isRuntimeInput(name))) {
        out.set(`${prefix}${name}`, { size: stat.size, mtime: modifiedMs(stat.mtime) });
      }
    }
  };
  walk(GAME, "", true);
  return out;
}

function bytesStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

/** What is in OPFS under `save/<game>/`, as a source of (path, bytes). */
export interface SaveStore {
  list(game: string): Promise<SavedFile[]>;
}

export interface SavedFile {
  path: string;
  size?: number;
  modified?: number;
  read(): Promise<Uint8Array>;
}

/** Puts the saved files back over the game's own, before the game starts. */
export async function restoreSaves(
  fs: FsLike,
  store: SaveStore,
  game: string,
  accept: (path: string) => boolean = () => true,
  repair?: CopyTarget,
): Promise<number> {
  const files = await store.list(game);
  let restored = 0;
  for (const file of files) {
    if (isRuntimeInput(file.path)) {
      // Older versions saved the build's binaries here. Remove those copies without reading them into Wasm.
      await repair?.remove(`save/${game}/${file.path}`);
      continue;
    }
    if (!accept(file.path)) continue;
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      try {
        fs.mkdir(`${GAME}/${parts.slice(0, i).join("/")}`);
      } catch {
        // already there
      }
    }
    const original = await file.read();
    const isYuriIni =
      game.toLowerCase().endsWith("ra2md") && file.path.toLowerCase() === "ra2md.ini";
    const data =
      isYuriIni && original.byteLength > PROFILE_INI_COMPACT_THRESHOLD
        ? compactProfileIni(original)
        : original;
    if (data !== original) await repair?.write(`save/${game}/${file.path}`, bytesStream(data));
    replaceFile(fs, `${GAME}/${file.path}`, data);
    restored++;
  }
  return restored;
}

export interface SaveSync {
  /** look now: copies what changed. Resolves when it is in OPFS. */
  flush(): Promise<number>;
  stop(): void;
}

/**
 * Watches the game's folder from now on, copying a file to OPFS when it is new or has changed. The
 * files there at the moment of the call count as unchanged. A flush runs every `everyMs`, and on
 * `flush()`; a file still being written (its size moved since the last look) waits for the next look.
 */
export function startSaveSync(
  fs: FsLike,
  target: CopyTarget,
  game: string,
  everyMs = 2000,
): SaveSync {
  const kept = scan(fs);
  let pending = new Map<string, Seen>();
  let running: Promise<number> | null = null;

  async function once(): Promise<number> {
    const now = scan(fs, true);
    const next = new Map<string, Seen>();
    let copied = 0;
    for (const [path, seen] of now) {
      const before = kept.get(path);
      if (before && before.size === seen.size && before.mtime === seen.mtime) continue;
      const earlier = pending.get(path);
      next.set(path, seen);
      // wait until two looks agree, so a file the game is still writing is not cut short
      if (!earlier || earlier.size !== seen.size || earlier.mtime !== seen.mtime) continue;
      await target.write(`save/${game}/${path}`, bytesStream(fs.readFile(`${GAME}/${path}`)));
      kept.set(path, seen);
      next.delete(path);
      copied++;
    }
    pending = next;
    return copied;
  }

  const timer = setInterval(() => {
    running ??= once().finally(() => {
      running = null;
    });
  }, everyMs);

  return {
    async flush() {
      // two looks, as the timer would take: the first notes what changed, the second copies it
      await (running ?? Promise.resolve(0));
      const first = await once();
      return first + (await once());
    },
    stop() {
      clearInterval(timer);
    },
  };
}

// ---- carrying saves between this browser and a desktop install --------------------------------------

/** Older pages kept saves in a `Saved Games/` folder; the game itself writes `SAVE0001.sav` beside its exe. */
const SAVES_FOLDER = "Saved Games/";

/** A saved game: a `.sav` file at the game's top level, or anything in the older `Saved Games/` folder. */
export const isSavePath = (path: string): boolean =>
  /^[^/]+\.sav$/i.test(path) || path.startsWith(SAVES_FOLDER);

/**
 * The saved games of a game, zipped under the names the game keeps them by, or null if there are none yet.
 * `imported` adds saves that came with the import (the game's folder, not what it has saved since); a save
 * of the same name that the game has written since wins.
 */
export async function exportSaves(
  store: SaveStore,
  game: string,
  imported: SavedFile[] = [],
): Promise<Uint8Array | null> {
  const written = (await store.list(game)).filter((file) => isSavePath(file.path));
  const known = new Set(written.map((file) => file.path.toLowerCase()));
  const files = [
    ...written,
    ...imported.filter((file) => isSavePath(file.path) && !known.has(file.path.toLowerCase())),
  ];
  if (files.length === 0) return null;
  const { writeZip } = await import("./zip");
  return writeZip(
    await Promise.all(files.map(async (f) => ({ path: f.path, data: await f.read() }))),
  );
}

/**
 * Takes the saved games out of a zip into OPFS, to be put back the next time the game starts. Only `.sav`
 * files count, and each goes where the game looks for it, beside its exe: a zip made by an older page has
 * `Saved Games/<name>`, a zip of just the files is taken too. Returns how many there were.
 */
export async function importSaves(
  zip: Uint8Array,
  target: CopyTarget,
  game: string,
): Promise<number> {
  const { readZip } = await import("./zip");
  const files = await readZip(zip);
  let count = 0;
  for (const file of files) {
    const name = file.path.startsWith(SAVES_FOLDER)
      ? file.path.slice(SAVES_FOLDER.length)
      : file.path;
    if (name.includes("/") || !/\.sav$/i.test(name)) continue;
    await target.write(`save/${game}/${name}`, bytesStream(file.data));
    count++;
  }
  return count;
}
