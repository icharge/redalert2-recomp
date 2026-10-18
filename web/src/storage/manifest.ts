// The import's record of what is in OPFS: IndexedDB, database `ra2-web` (docs/web/storage.md).
//
// `games`: one record per game, with every file the game reads and whether it is copied yet. A file two
// games read is listed by both and kept once, in the folder of the game that was imported first (`home`).
// `settings`: the page's own settings, by name.

import type { GameId } from "./install";

export interface FileEntry {
  size: number;
  lastModified: number;
  /** copied completely */
  done: boolean;
  /** the games that read it */
  needs: GameId[];
  /** the game's folder it is kept in: /game/<home>/<name> */
  home: GameId;
}

export interface GameRecord {
  id: GameId;
  title: string;
  exeStamp: number;
  importedAt: number;
  /** bytes of the files, copied or not */
  bytes: number;
  /** every file is copied */
  complete: boolean;
  files: Record<string, FileEntry>;
}

/** A file the import means to copy, as the plan lists it. */
export interface PlannedFile {
  name: string;
  size: number;
  lastModified: number;
  needs: GameId[];
}

export interface ResumePoint {
  /** already in OPFS and the same as the folder's */
  done: string[];
  /** still to copy: new, changed since, or not finished */
  todo: PlannedFile[];
}

const DB_NAME = "ra2-web";
const GAMES = "games";
const SETTINGS = "settings";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB failed"));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB aborted"));
  });
}

export class Manifest {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<Manifest> {
    const opening = factory.open(DB_NAME, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore(GAMES, { keyPath: "id" });
      db.createObjectStore(SETTINGS);
    };
    return new Manifest(await request(opening));
  }

  close(): void {
    this.db.close();
  }

  async getGame(id: GameId): Promise<GameRecord | undefined> {
    const tx = this.db.transaction(GAMES, "readonly");
    return (await request(tx.objectStore(GAMES).get(id))) as GameRecord | undefined;
  }

  async listGames(): Promise<GameRecord[]> {
    const tx = this.db.transaction(GAMES, "readonly");
    return (await request(tx.objectStore(GAMES).getAll())) as GameRecord[];
  }

  /**
   * Starts an import, or takes up one that stopped. A file already recorded as done with the size and
   * time the folder has now is kept as done; anything else is to copy again. A file another game has
   * already put in OPFS is listed here as done, kept where it is.
   */
  async beginImport(
    id: GameId,
    title: string,
    exeStamp: number,
    planned: PlannedFile[],
  ): Promise<{ record: GameRecord; resume: ResumePoint }> {
    const tx = this.db.transaction(GAMES, "readwrite");
    const store = tx.objectStore(GAMES);
    const before = (await request(store.get(id))) as GameRecord | undefined;
    const others = ((await request(store.getAll())) as GameRecord[]).filter((g) => g.id !== id);
    const resume: ResumePoint = { done: [], todo: [] };
    const files: Record<string, FileEntry> = {};
    for (const file of planned) {
      const had: FileEntry | undefined = before?.files[file.name];
      const shared: FileEntry | undefined = others
        .map((g) => g.files[file.name])
        .find(
          (entry): entry is FileEntry =>
            !!entry &&
            entry.done &&
            entry.size === file.size &&
            entry.lastModified === file.lastModified,
        );
      const matches = (e: FileEntry) =>
        e.done && e.size === file.size && e.lastModified === file.lastModified;
      if (had && matches(had)) {
        files[file.name] = { ...had, needs: file.needs };
        resume.done.push(file.name);
      } else if (shared && matches(shared)) {
        files[file.name] = {
          size: file.size,
          lastModified: file.lastModified,
          done: true,
          needs: file.needs,
          home: shared.home,
        };
        resume.done.push(file.name);
      } else {
        files[file.name] = {
          size: file.size,
          lastModified: file.lastModified,
          done: false,
          needs: file.needs,
          home: had?.home ?? id,
        };
        resume.todo.push(file);
      }
    }
    const record: GameRecord = {
      id,
      title,
      exeStamp,
      importedAt: before?.importedAt ?? Date.now(),
      bytes: planned.reduce((sum, file) => sum + file.size, 0),
      complete: resume.todo.length === 0,
      files,
    };
    store.put(record);
    await finished(tx);
    return { record, resume };
  }

  /** One file is in OPFS, whole. */
  async markFileDone(id: GameId, name: string): Promise<void> {
    const tx = this.db.transaction(GAMES, "readwrite");
    const store = tx.objectStore(GAMES);
    const record = (await request(store.get(id))) as GameRecord | undefined;
    const entry = record?.files[name];
    if (!record || !entry) {
      tx.abort();
      throw new Error(`${name} is not part of the ${id} import`);
    }
    entry.done = true;
    record.complete = Object.values(record.files).every((file) => file.done);
    store.put(record);
    await finished(tx);
  }

  /**
   * Forgets a game. Returns the files to delete from OPFS: those only this game reads. A file another
   * game still reads stays, wherever it is kept.
   */
  async removeGame(id: GameId): Promise<{ home: GameId; name: string }[]> {
    const tx = this.db.transaction(GAMES, "readwrite");
    const store = tx.objectStore(GAMES);
    const record = (await request(store.get(id))) as GameRecord | undefined;
    if (!record) return [];
    const others = ((await request(store.getAll())) as GameRecord[]).filter((g) => g.id !== id);
    const stillNeeded = new Set(others.flatMap((g) => Object.keys(g.files)));
    const doomed = Object.entries(record.files)
      .filter(([name]) => !stillNeeded.has(name))
      .map(([name, entry]) => ({ home: entry.home, name }));
    store.delete(id);
    await finished(tx);
    return doomed;
  }

  async getSetting<T>(name: string): Promise<T | undefined> {
    const tx = this.db.transaction(SETTINGS, "readonly");
    return (await request(tx.objectStore(SETTINGS).get(name))) as T | undefined;
  }

  async setSetting(name: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(SETTINGS, "readwrite");
    tx.objectStore(SETTINGS).put(value, name);
    await finished(tx);
  }
}
