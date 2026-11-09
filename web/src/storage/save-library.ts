// The saved games of one installed game, as the Saved games dialog lists them: what the game wrote since
// the import (`save/<storage>/`) and what came with the import (the game's own folder). A save both have
// is one entry, read from the written copy.

import type { FileEntry, GameRecord, Manifest } from "./manifest";
import { gamePath, type CopyTarget } from "./opfs";
import { isSavePath, type SaveStore } from "./saves";

/** What a save says about itself, as the game's save file parser reads it. */
export interface SaveInfo {
  description: string;
  scenario?: string;
  /** ms since epoch */
  savedAt?: number;
}

export interface SaveEntry {
  /** as the game keeps it, e.g. "SAVE0003.SAV" or "Saved Games/x.sav" */
  name: string;
  size: number;
  /** ms */
  modified: number;
  info: SaveInfo | null;
  /** the game wrote it since the import (in save/<storage>/) */
  written: boolean;
  /** it came with the import (in game.files) */
  imported: boolean;
}

export interface SaveLibraryDeps {
  store: SaveStore;
  manifest: Manifest;
  target: CopyTarget;
  readImported(home: string, name: string): Promise<Uint8Array>;
  /** Reads a save's details from its bytes; throws or returns null for a file it cannot read. */
  readInfo(data: Uint8Array): SaveInfo | null;
}

/** The import's record of a save, matched without regard to case as exportSaves does. */
function importedSave(game: GameRecord, name: string) {
  const wanted = name.toLowerCase();
  for (const [key, entry] of Object.entries(game.files)) {
    if (isSavePath(key) && key.toLowerCase() === wanted) return { key, entry };
  }
  return null;
}

/** A save's details, or null when they cannot be read. */
async function infoOf(
  read: () => Promise<Uint8Array>,
  deps: SaveLibraryDeps,
): Promise<SaveInfo | null> {
  try {
    return deps.readInfo(await read());
  } catch {
    return null;
  }
}

/** Every save of the game, the newest first. A save that cannot be read is still listed, with info null. */
export async function listSaves(deps: SaveLibraryDeps, game: GameRecord): Promise<SaveEntry[]> {
  const written = (await deps.store.list(game.storage)).filter((file) => isSavePath(file.path));
  const writtenByName = new Map(written.map((file) => [file.path.toLowerCase(), file]));
  const names = new Set(writtenByName.keys());
  for (const key of Object.keys(game.files)) if (isSavePath(key)) names.add(key.toLowerCase());

  const entries: SaveEntry[] = [];
  for (const key of names) {
    const file = writtenByName.get(key);
    const imported = importedSave(game, key);
    if (!file && !imported) continue;
    const read = file
      ? () => file.read()
      : () => deps.readImported(imported!.entry.home, imported!.key);
    const size = file?.size ?? imported!.entry.size;
    const modified = file?.modified ?? imported!.entry.lastModified;
    entries.push({
      name: file ? file.path : imported!.key,
      size,
      modified,
      info: await infoOf(read, deps),
      written: !!file,
      imported: !!imported,
    });
  }
  return entries.sort((a, b) => b.modified - a.modified);
}

/** One save's bytes: the written copy if the game has written it, else the copy from the import. */
export async function readSave(
  deps: SaveLibraryDeps,
  game: GameRecord,
  save: SaveEntry,
): Promise<Uint8Array> {
  const wanted = save.name.toLowerCase();
  const file = (await deps.store.list(game.storage)).find((f) => f.path.toLowerCase() === wanted);
  if (file) return file.read();
  const imported = importedSave(game, save.name);
  if (!imported) throw new Error(`${save.name} is not in this game's saves.`);
  return deps.readImported(imported.entry.home, imported.key);
}

/**
 * Removes saves from both copies: the written one in `save/<storage>/`, and the import's record and
 * file, so the save does not come back. Collects failures and throws one Error afterwards.
 */
export async function removeSaves(
  deps: SaveLibraryDeps,
  game: GameRecord,
  saves: SaveEntry[],
): Promise<void> {
  const failed = await collectSaveRemovals(deps, game, saves);
  if (failed.length) throw new Error(notRemoved(failed));
}

/** As removeSaves, but returns the errors of the files that would not go, for a caller that reports them with others. */
export async function collectSaveRemovals(
  deps: SaveLibraryDeps,
  game: GameRecord,
  saves: SaveEntry[],
): Promise<unknown[]> {
  const failed: unknown[] = [];
  const imported: { key: string; entry: FileEntry }[] = [];
  for (const save of saves) {
    if (save.written) {
      try {
        await deps.target.remove(`save/${game.storage}/${save.name}`);
      } catch (error) {
        failed.push(error);
      }
    }
    const record = importedSave(game, save.name);
    if (record) imported.push(record);
  }
  // Files go before the records that name them, as removeInstall does: a file that will not delete
  // stays listed, so it can be tried again.
  if (imported.length) {
    const read = await pathsReadElsewhere(deps.manifest, [game]);
    const forget: string[] = [];
    for (const { key, entry } of imported) {
      if (!read.has(`${entry.home}/${key}`)) {
        try {
          await deps.target.remove(gamePath(entry.home, key));
        } catch (error) {
          failed.push(error);
          continue;
        }
      }
      forget.push(key);
    }
    if (forget.length) {
      try {
        // the files are already gone, so the paths it returns are not removed again
        await deps.manifest.deleteFiles(game.slot, game.id, forget);
      } catch (error) {
        failed.push(error);
      }
    }
  }
  return failed;
}

/**
 * Every `home/name` a record outside `exclude` reads, in any installation. A file in that set is still
 * another game's, so it stays in OPFS when `exclude` forgets it.
 */
export async function pathsReadElsewhere(
  manifest: Manifest,
  exclude: GameRecord[],
): Promise<Set<string>> {
  const paths = new Set<string>();
  for (const record of await manifest.listGames()) {
    if (exclude.some((game) => game.slot === record.slot && game.id === record.id)) continue;
    for (const [name, entry] of Object.entries(record.files)) paths.add(`${entry.home}/${name}`);
  }
  return paths;
}

function notRemoved(errors: unknown[]): string {
  const count = errors.length === 1 ? "A save" : `${errors.length} saves`;
  const first = errors[0];
  return `${count} could not be deleted (${first instanceof Error ? first.message : String(first)}). Try again.`;
}
