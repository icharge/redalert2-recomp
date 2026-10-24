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
  home: string;
}

export interface InstallationRecord {
  slot: number;
  name: string;
  /** User-facing name, when changed from the detected game title. */
  displayName?: string;
  importedAt: number;
  /** Persisted before copying, so an interruption between editions is resumable. */
  editions?: GameId[];
}

export interface GameRecord {
  id: GameId;
  slot: number;
  /** Save, mod, and game-specific preference namespace; legacy imports keep their old paths. */
  storage: string;
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
const GAMES = "installation-games";
const INSTALLATIONS = "installations";
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
    const opening = factory.open(DB_NAME, 2);
    opening.onupgradeneeded = (event) => {
      const db = opening.result;
      const editions = db.createObjectStore(GAMES, { keyPath: ["slot", "id"] });
      const installations = db.createObjectStore(INSTALLATIONS, {
        keyPath: "slot",
        autoIncrement: true,
      });
      if (event.oldVersion === 0) db.createObjectStore(SETTINGS);
      else {
        const legacy = opening.transaction!.objectStore("games").getAll();
        legacy.onsuccess = () => {
          const games = legacy.result as Omit<GameRecord, "slot" | "storage">[];
          if (!games.length) return;
          installations.put({
            slot: 1,
            name: "Imported installation",
            importedAt: Math.min(...games.map((game) => game.importedAt)),
            editions: games.map((game) => game.id),
          });
          for (const game of games) editions.put({ ...game, slot: 1, storage: game.id });
        };
      }
    };
    const db = await request(opening);
    db.onversionchange = () => db.close();
    return new Manifest(db);
  }

  close(): void {
    this.db.close();
  }

  async createInstallation(name: string, editions: GameId[] = []): Promise<InstallationRecord> {
    const tx = this.db.transaction(INSTALLATIONS, "readwrite");
    const entry = { name, importedAt: Date.now(), editions };
    const slot = Number(await request(tx.objectStore(INSTALLATIONS).add(entry)));
    await finished(tx);
    return { ...entry, slot };
  }

  async getInstallation(slot: number): Promise<InstallationRecord | undefined> {
    const tx = this.db.transaction(INSTALLATIONS, "readonly");
    return (await request(tx.objectStore(INSTALLATIONS).get(slot))) as
      InstallationRecord | undefined;
  }

  async renameInstallation(slot: number, displayName: string): Promise<void> {
    const tx = this.db.transaction(INSTALLATIONS, "readwrite");
    const store = tx.objectStore(INSTALLATIONS);
    const installation = (await request(store.get(slot))) as InstallationRecord | undefined;
    if (!installation) {
      tx.abort();
      throw new Error("That installation does not exist.");
    }
    installation.displayName = displayName;
    store.put(installation);
    await finished(tx);
  }

  async listInstallations(): Promise<InstallationRecord[]> {
    const tx = this.db.transaction(INSTALLATIONS, "readonly");
    return (await request(tx.objectStore(INSTALLATIONS).getAll())) as InstallationRecord[];
  }

  async getGame(id: GameId, slot = 1): Promise<GameRecord | undefined> {
    const tx = this.db.transaction(GAMES, "readonly");
    return (await request(tx.objectStore(GAMES).get([slot, id]))) as GameRecord | undefined;
  }

  async listGames(slot?: number): Promise<GameRecord[]> {
    const tx = this.db.transaction(GAMES, "readonly");
    const games = (await request(tx.objectStore(GAMES).getAll())) as GameRecord[];
    return slot === undefined ? games : games.filter((game) => game.slot === slot);
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
    installationSlot?: number,
  ): Promise<{ record: GameRecord; resume: ResumePoint }> {
    const slot = installationSlot ?? 1;
    if (!(await this.getInstallation(slot))) {
      if (installationSlot !== undefined) throw new Error("That installation does not exist.");
      const created = await this.createInstallation("Imported installation");
      if (created.slot !== slot) throw new Error("Choose an installation to import into.");
    }
    const tx = this.db.transaction([GAMES, INSTALLATIONS], "readwrite");
    const store = tx.objectStore(GAMES);
    const installation = await request(tx.objectStore(INSTALLATIONS).get(slot)) as InstallationRecord;
    if (!installation) { tx.abort(); throw new Error("That installation does not exist."); }
    if (!installation.editions?.includes(id)) {
      installation.editions = [...(installation.editions ?? []), id];
      tx.objectStore(INSTALLATIONS).put(installation);
    }
    const before = (await request(store.get([slot, id]))) as GameRecord | undefined;
    const others = ((await request(store.getAll())) as GameRecord[]).filter(
      (g) => g.slot === slot && g.id !== id,
    );
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
          home: had?.home ?? `slot-${slot}`,
        };
        resume.todo.push(file);
      }
    }
    const record: GameRecord = {
      id,
      slot,
      storage: before?.storage ?? `slot-${slot}-${id}`,
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
  async markFileDone(id: GameId, name: string, slot = 1): Promise<void> {
    const tx = this.db.transaction(GAMES, "readwrite");
    const store = tx.objectStore(GAMES);
    const record = (await request(store.get([slot, id]))) as GameRecord | undefined;
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
   * Adds files to editions of an installation, or replaces what they list under that name: the player
   * put them there from the Library. A file two editions share is listed by both, with the same `home`.
   */
  async putFiles(
    slot: number,
    puts: { id: GameId; name: string; entry: FileEntry }[],
  ): Promise<void> {
    const tx = this.db.transaction(GAMES, "readwrite");
    const store = tx.objectStore(GAMES);
    for (const id of new Set(puts.map((put) => put.id))) {
      const record = (await request(store.get([slot, id]))) as GameRecord | undefined;
      if (!record) {
        tx.abort();
        throw new Error(`${id} is not part of this installation`);
      }
      for (const put of puts) if (put.id === id) record.files[put.name] = put.entry;
      record.bytes = Object.values(record.files).reduce((sum, file) => sum + file.size, 0);
      record.complete = Object.values(record.files).every((file) => file.done);
      store.put(record);
    }
    await finished(tx);
  }

  /**
   * Adds an edition to an installation that lacks it, with the files it reads: the player uploaded its exe
   * from the Library. Files the installation already keeps are listed by the new edition as they are, in
   * the same `home`, so both editions share them.
   */
  async addEdition(
    slot: number,
    id: GameId,
    title: string,
    exeStamp: number,
    files: Record<string, FileEntry>,
  ): Promise<GameRecord> {
    const tx = this.db.transaction([GAMES, INSTALLATIONS], "readwrite");
    const installation = (await request(tx.objectStore(INSTALLATIONS).get(slot))) as
      InstallationRecord | undefined;
    if (!installation) {
      tx.abort();
      throw new Error("That installation does not exist.");
    }
    if (await request(tx.objectStore(GAMES).get([slot, id]))) {
      tx.abort();
      throw new Error("That game is already in this installation.");
    }
    const record: GameRecord = {
      id,
      slot,
      storage: `slot-${slot}-${id}`,
      title,
      exeStamp,
      importedAt: Date.now(),
      bytes: Object.values(files).reduce((sum, file) => sum + file.size, 0),
      complete: Object.values(files).every((file) => file.done),
      files,
    };
    tx.objectStore(GAMES).put(record);
    if (!installation.editions?.includes(id)) {
      installation.editions = [...(installation.editions ?? []), id];
      tx.objectStore(INSTALLATIONS).put(installation);
    }
    await finished(tx);
    return record;
  }

  /**
   * Takes files out of one edition's record. Returns those no edition reads any more, to delete from OPFS:
   * a file the other edition (or another installation, in an older layout) still lists stays where it is.
   */
  async deleteFiles(
    slot: number,
    id: GameId,
    names: string[],
  ): Promise<{ home: string; name: string }[]> {
    const tx = this.db.transaction(GAMES, "readwrite");
    const store = tx.objectStore(GAMES);
    const all = (await request(store.getAll())) as GameRecord[];
    const record = all.find((game) => game.slot === slot && game.id === id);
    if (!record) {
      tx.abort();
      throw new Error("That game does not exist.");
    }
    const removed = names.flatMap((name) => {
      const entry = record.files[name];
      return entry ? [{ home: entry.home, name }] : [];
    });
    for (const { name } of removed) delete record.files[name];
    record.bytes = Object.values(record.files).reduce((sum, file) => sum + file.size, 0);
    store.put(record);
    const stillNeeded = new Set(
      all.flatMap((game) =>
        Object.entries(game.files).map(([name, entry]) => `${entry.home}/${name}`),
      ),
    );
    await finished(tx);
    return removed.filter(({ home, name }) => !stillNeeded.has(`${home}/${name}`));
  }

  /**
   * Forgets a game. Returns the files to delete from OPFS: those only this game reads. A file another
   * game still reads stays, wherever it is kept.
   */
  async removeGame(id: GameId, slot = 1): Promise<{ home: string; name: string }[]> {
    return this.removeRecords(slot, id);
  }

  async removeInstallation(slot: number): Promise<{ home: string; name: string }[]> {
    return this.removeRecords(slot);
  }

  private async removeRecords(
    slot: number,
    id?: GameId,
  ): Promise<{ home: string; name: string }[]> {
    const tx = this.db.transaction([GAMES, INSTALLATIONS, SETTINGS], "readwrite");
    const store = tx.objectStore(GAMES);
    const all = (await request(store.getAll())) as GameRecord[];
    const selected = (game: GameRecord) =>
      game.slot === slot && (id === undefined || game.id === id);
    const removed = all.filter(selected);
    const stillNeeded = new Set(
      all
        .filter((game) => !selected(game))
        .flatMap((game) =>
          Object.entries(game.files).map(([name, entry]) => `${entry.home}/${name}`),
        ),
    );
    const doomed = new Map<string, { home: string; name: string }>();
    for (const game of removed) {
      for (const [name, entry] of Object.entries(game.files)) {
        const path = `${entry.home}/${name}`;
        if (!stillNeeded.has(path)) doomed.set(path, { home: entry.home, name });
      }
      const mods = (await request(tx.objectStore(SETTINGS).get(`mods:${game.storage}`))) as
        { name: string; files: { name: string }[] }[] | undefined;
      for (const mod of mods ?? [])
        for (const file of mod.files) {
          const name = `mods/${mod.name}/${file.name}`;
          doomed.set(`${game.storage}/${name}`, { home: game.storage, name });
        }
      tx.objectStore(SETTINGS).delete(`mods:${game.storage}`);
      store.delete([slot, game.id]);
    }
    if (id === undefined) tx.objectStore(INSTALLATIONS).delete(slot);
    await finished(tx);
    return [...doomed.values()];
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
