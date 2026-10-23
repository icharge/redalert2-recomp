// What the game writes while it runs, kept across reloads (docs/web/storage.md, "The layout in OPFS").
//
// The game's files live in the in-memory file system for as long as the page is open (game/loader.ts).
// Its writes (a saved game, its settings file) would go with the page, so this puts them in OPFS under
// `save/<game>/` as they happen, and puts them back over the game's files the next time it starts.
// Only files that are new, or changed since the game started, are kept: the game's own files are
// already in OPFS from the import.

import type { GameId } from "./install";
import type { CopyTarget } from "./opfs";

/** The parts of Emscripten's FS this uses. */
export interface FsLike {
  readdir(path: string): string[];
  stat(path: string): { mode: number; size: number; mtime: Date };
  isDir(mode: number): boolean;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array): void;
  mkdir(path: string): void;
}

const GAME = "/game";

/** Files the game writes that are not worth keeping. */
const IGNORED = /^(debug\.log|.*\.tmp)$/i;

interface Seen {
  size: number;
  mtime: number;
}

/** Every file of the game's folder with its size and time: `Saved Games/` and the top level only. */
function scan(fs: FsLike): Map<string, Seen> {
  const out = new Map<string, Seen>();
  const walk = (dir: string, prefix: string, deep: boolean) => {
    for (const name of fs.readdir(dir)) {
      if (name === "." || name === "..") continue;
      const path = `${dir}/${name}`;
      let stat;
      try {
        stat = fs.stat(path);
      } catch {
        continue;
      }
      if (fs.isDir(stat.mode)) {
        if (
          deep &&
          (name.toLowerCase() === "saved games" ||
            name === ".host" ||
            name.toLowerCase() === "mods" ||
            prefix.startsWith("mods/"))
        )
          walk(path, `${prefix}${name}/`, name.toLowerCase() !== "saved games");
      } else if (!IGNORED.test(name)) {
        out.set(`${prefix}${name}`, { size: stat.size, mtime: stat.mtime.getTime() });
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
  list(game: GameId): Promise<{ path: string; read(): Promise<Uint8Array> }[]>;
}

/** Puts the saved files back over the game's own, before the game starts. */
export async function restoreSaves(fs: FsLike, store: SaveStore, game: GameId,
  accept: (path: string) => boolean = () => true): Promise<number> {
  const files = (await store.list(game)).filter((file) => accept(file.path));
  for (const file of files) {
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      try {
        fs.mkdir(`${GAME}/${parts.slice(0, i).join("/")}`);
      } catch {
        // already there
      }
    }
    fs.writeFile(`${GAME}/${file.path}`, await file.read());
  }
  return files.length;
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
  game: GameId,
  everyMs = 2000,
): SaveSync {
  const kept = scan(fs);
  let pending = new Map<string, Seen>();
  let running: Promise<number> | null = null;

  async function once(): Promise<number> {
    const now = scan(fs);
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

const SAVES_FOLDER = "Saved Games/";

/** The saved games of a game, zipped as `Saved Games/<name>`, or null if there are none yet. */
export async function exportSaves(store: SaveStore, game: GameId): Promise<Uint8Array | null> {
  const files = (await store.list(game)).filter((file) => file.path.startsWith(SAVES_FOLDER));
  if (files.length === 0) return null;
  const { writeZip } = await import("./zip");
  return writeZip(
    await Promise.all(files.map(async (f) => ({ path: f.path, data: await f.read() }))),
  );
}

/**
 * Takes the saved games out of a zip into OPFS, to be put back the next time the game starts. A zip made by
 * this page has `Saved Games/<name>`; a zip of just the files is taken too. Returns how many there were.
 */
export async function importSaves(
  zip: Uint8Array,
  target: CopyTarget,
  game: GameId,
): Promise<number> {
  const { readZip } = await import("./zip");
  const files = await readZip(zip);
  let count = 0;
  for (const file of files) {
    const name = file.path.startsWith(SAVES_FOLDER)
      ? file.path.slice(SAVES_FOLDER.length)
      : file.path;
    if (name.includes("/") || !/\.(sav|sva|ini|txt)$/i.test(name)) continue;
    await target.write(`save/${game}/${SAVES_FOLDER}${name}`, bytesStream(file.data));
    count++;
  }
  return count;
}
