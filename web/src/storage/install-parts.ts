// The parts of one installation the Manage panel measures and removes: settings, saves, maps, mods and
// the game. Settings, saves and maps go file by file, the OPFS file before its record (R5); the game goes
// last, with the installation's records.

import type { ActiveInstall } from "./active-install";
import { classify } from "./install";
import type { GameRecord, Manifest } from "./manifest";
import { listMods, removeMod } from "./mods";
import { deleteInstallFiles, notRemoved } from "./remove-install";
import { gamePath } from "./opfs";
import { isSettingsPath } from "./settings-files";
import {
  collectSaveRemovals,
  listSaves,
  pathsReadElsewhere,
  type SaveLibraryDeps,
} from "./save-library";

export type InstallPart = "game" | "mods" | "maps" | "saves" | "settings";
/** bytes */
export type PartSizes = Record<InstallPart, number>;

const kindOf = (name: string) => classify(name)?.kind;

/** The names of an edition's recorded files of one kind, as classify sorts them. */
function namesOf(game: GameRecord, kind: string): string[] {
  return Object.keys(game.files).filter((name) => kindOf(name) === kind);
}

/** How much of each part the installation holds, across every edition. */
export async function measureParts(
  deps: SaveLibraryDeps,
  install: ActiveInstall,
): Promise<PartSizes> {
  const sizes: PartSizes = { game: 0, mods: 0, maps: 0, saves: 0, settings: 0 };
  for (const game of install.editions) {
    for (const [name, entry] of Object.entries(game.files)) {
      const kind = kindOf(name);
      // a save is measured with the saves below, from the same list the dialog shows
      if (kind === "save") continue;
      if (kind === "map") sizes.maps += entry.size;
      else if (kind === "settings") sizes.settings += entry.size;
      else sizes.game += entry.size;
    }
    for (const save of await listSaves(deps, game)) sizes.saves += save.size;
    for (const file of await deps.store.list(game.storage)) {
      if (isSettingsPath(file.path)) sizes.settings += file.size ?? 0;
    }
    for (const mod of await listMods(deps.manifest, game.storage)) sizes.mods += mod.bytes;
  }
  return sizes;
}

/**
 * Removes the ticked parts, in the order settings, saves, maps, mods, game. Each part's failures are
 * collected and reported in one Error at the end; what could go is gone, and what could not stays
 * listed, so it can be tried again.
 */
export async function removeParts(
  deps: SaveLibraryDeps,
  install: ActiveInstall,
  parts: InstallPart[],
): Promise<void> {
  const wanted = new Set(parts);
  const { manifest, target } = deps;
  const failed: unknown[] = [];
  if (wanted.has("settings")) {
    for (const game of install.editions) {
      for (const file of await deps.store.list(game.storage)) {
        if (!isSettingsPath(file.path)) continue;
        try {
          await target.remove(`save/${game.storage}/${file.path}`);
        } catch (error) {
          failed.push(error);
        }
      }
      await removeRecorded(deps, game, namesOf(game, "settings"), failed);
    }
  }
  if (wanted.has("saves")) {
    for (const game of install.editions) {
      failed.push(...(await collectSaveRemovals(deps, game, await listSaves(deps, game))));
    }
  }
  if (wanted.has("maps")) {
    for (const game of install.editions) {
      await removeRecorded(deps, game, namesOf(game, "map"), failed);
    }
  }
  if (wanted.has("mods")) {
    for (const game of install.editions) {
      for (const mod of await listMods(manifest, game.storage)) {
        try {
          await removeMod(manifest, target, game.storage, mod);
        } catch (error) {
          failed.push(error);
        }
      }
    }
  }
  if (wanted.has("game")) {
    // the same as removeInstall, but its failures join the others in one Error
    const slot = install.installation.slot;
    const stuck = await deleteInstallFiles(manifest, target, slot);
    if (stuck.length) failed.push(...stuck);
    else await manifest.removeInstallation(slot);
  }
  if (failed.length) throw new Error(notRemoved(failed));
}

/**
 * Deletes recorded files of one edition, then forgets them. A file another record outside this edition
 * still reads stays in OPFS, and is only forgotten here. A file that will not delete stays recorded.
 */
async function removeRecorded(
  deps: SaveLibraryDeps,
  game: GameRecord,
  names: string[],
  failed: unknown[],
): Promise<void> {
  if (!names.length) return;
  const { manifest, target } = deps;
  const readElsewhere = await pathsReadElsewhere(manifest, [game]);
  const forget: string[] = [];
  for (const name of names) {
    const entry = game.files[name];
    if (!entry) continue;
    if (!readElsewhere.has(`${entry.home}/${name}`)) {
      try {
        await target.remove(gamePath(entry.home, name));
      } catch (error) {
        failed.push(error);
        continue;
      }
    }
    forget.push(name);
  }
  if (forget.length) {
    try {
      await manifest.deleteFiles(game.slot, game.id, forget);
    } catch (error) {
      failed.push(error);
    }
  }
}

/**
 * Gets the installation ready for a reinstall in the same slot: each edition's game files are marked
 * not copied, so Resume import copies them again. Saves and settings stay as they are.
 */
export async function prepareReinstall(manifest: Manifest, install: ActiveInstall): Promise<void> {
  const slot = install.installation.slot;
  for (const game of install.editions) {
    const names = Object.keys(game.files).filter((name) => {
      const kind = kindOf(name);
      return kind !== "save" && kind !== "settings";
    });
    if (names.length) await manifest.markFilesMissing(game.id, names, slot);
  }
}
