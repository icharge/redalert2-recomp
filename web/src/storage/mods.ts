import type { FolderSource } from "./importer";
import { Manifest } from "./manifest";
import { gamePath, mountedPath, READ_IN_PLACE_BYTES, readGameFile, type CopyTarget } from "./opfs";
import type { FsLike } from "./saves";
import { shouldLoadImportedGameFile } from "./thai-fonts";

export interface ModRecord {
  name: string;
  files: { name: string; size: number }[];
  bytes: number;
}
const key = (game: string) => `mods:${game}`;
export const listMods = async (manifest: Manifest, game: string): Promise<ModRecord[]> =>
  (await manifest.getSetting<ModRecord[]>(key(game))) ?? [];

/** Flat data mods use the same overlay as native builds. Reject executable patches
 * rather than importing a mod whose required runtime cannot run in the browser. */
export async function importMod(
  source: FolderSource,
  game: string,
  manifest: Manifest,
  target: CopyTarget,
  progress?: (done: number, total: number) => void,
): Promise<ModRecord> {
  const name = source.name.trim();
  if (
    !/^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,63}$/u.test(name) ||
    new TextEncoder().encode(name).length >= 128
  )
    throw new Error(
      "Use a mod folder name of 1–64 letters, numbers, spaces, dots, underscores or dashes.",
    );
  const mods = await listMods(manifest, game);
  if (mods.some((mod) => mod.name.toLowerCase() === name.toLowerCase()))
    throw new Error("That mod is already imported. Remove it before importing its replacement.");
  const files = await source.list();
  if (files.some((f) => /\.(dll|exe)$/i.test(f.path)))
    throw new Error(
      "This mod includes executable patches. Import a data-only mod; Ares and Phobos cannot run on the recompiled game.",
    );
  const kept = files.filter(
    (f) =>
      !/[\\/]/.test(f.path) &&
      !f.path.startsWith(".") &&
      /\.(mix|ini|csf|mmx|map|mpr|yrm|shp|vxl|hva|pal|pcx|wav|aud|bag|idx|fnt|tem|sno|urb|des|lun|ubn)$/i.test(
        f.path,
      ),
  );
  if (!kept.length) throw new Error("That folder has no mod data files.");
  if (new Set(kept.map((f) => f.path.toLowerCase())).size !== kept.length)
    throw new Error("Two mod files have the same name with different capitalisation.");
  const total = kept.reduce((sum, f) => sum + f.size, 0);
  const written: string[] = [];
  let done = 0;
  try {
    for (const file of kept) {
      const path = `game/${game}/mods/${name}/${file.path}`;
      written.push(path);
      await target.write(path, file.stream());
      if ((await target.size(path)) !== file.size)
        throw new Error(`${file.path} changed while it was copied.`);
      done += file.size;
      progress?.(done, total);
    }
    const record = { name, files: kept.map((f) => ({ name: f.path, size: f.size })), bytes: total };
    await manifest.setSetting(key(game), [...mods, record]);
    return record;
  } catch (error) {
    await Promise.all(written.map((path) => target.remove(path)));
    throw error;
  }
}

export async function removeMod(
  manifest: Manifest,
  target: CopyTarget,
  game: string,
  mod: ModRecord,
): Promise<void> {
  await manifest.setSetting(
    key(game),
    (await listMods(manifest, game)).filter((m) => m.name !== mod.name),
  );
  for (const file of mod.files) await target.remove(`game/${game}/mods/${mod.name}/${file.name}`);
}

/**
 * Mod assets share the import's game folder in OPFS; the runtime sees /game/mods. Big files are linked
 * to OPFS (`inPlace`), the rest copied into memory.
 */
export async function loadMods(
  fs: FsLike,
  game: string,
  options: { excludeGameFont?: boolean; inPlace?: boolean } = {},
): Promise<string[]> {
  const manifest = await Manifest.open();
  try {
    const mods = await listMods(manifest, game);
    if (!mods.length) return [];
    fs.mkdir("/game/mods");
    for (const mod of mods) {
      fs.mkdir(`/game/mods/${mod.name}`);
      for (const file of mod.files) {
        if (!shouldLoadImportedGameFile(file.name, options.excludeGameFont ?? false)) continue;
        const path = `mods/${mod.name}/${file.name}`;
        if (options.inPlace && fs.symlink && file.size >= READ_IN_PLACE_BYTES)
          fs.symlink(mountedPath(gamePath(game, path)), `/game/${path}`);
        else fs.writeFile(`/game/${path}`, await readGameFile(game, path));
      }
    }
    return mods.map((mod) => mod.name);
  } finally {
    manifest.close();
  }
}
