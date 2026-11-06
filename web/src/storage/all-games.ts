// "All games" (docs/web/frontend.md): the launcher shows one install, and a setting changed there is
// written to every edition of it, each into its own files.
import {
  emptyIni,
  loadGameSettings,
  serializeIni,
  setIniValue,
  withDefaultHotkeys,
  writeGameSettings,
  type GameSettingsDeps,
  type Ini,
  type LoadedGameSettings,
} from "./game-settings";
import type { GameId } from "./install";
import type { GameRecord } from "./manifest";

export type SettingsFile = "main" | "host" | "keyboard";

/** Runs a local-storage preference write once per edition (video, fullscreen, cursor, intro, Thai font…). */
export function forEachEdition(editions: GameRecord[], write: (game: GameRecord) => void): void {
  for (const game of editions) write(game);
}

function baseIni(file: SettingsFile, game: GameRecord, loaded: LoadedGameSettings): Ini {
  if (file === "main") return loaded.main.ini ?? emptyIni();
  if (file === "host") return loaded.host.ini ?? emptyIni();
  // A game with no keyboard file starts from the built-in bindings, so the file written is complete.
  return loaded.keyboardFromDefaults
    ? withDefaultHotkeys(game.id, loaded.keyboard.ini ?? emptyIni())
    : (loaded.keyboard.ini ?? emptyIni());
}

/**
 * Loads each edition's own file, applies `edit`, and writes it back under its own name, in edition
 * order. An edit returning null skips that edition. Resolves to the ids written; the first failure rejects.
 */
export async function editForAll(
  editions: GameRecord[],
  file: SettingsFile,
  edit: (ini: Ini, game: GameRecord, loaded: LoadedGameSettings) => Ini | null,
  deps: Partial<GameSettingsDeps> = {},
): Promise<GameId[]> {
  const written: GameId[] = [];
  for (const game of editions) {
    const loaded = await loadGameSettings(game, deps);
    const next = edit(baseIni(file, game, loaded), game, loaded);
    if (!next) continue;
    await writeGameSettings(game, loaded[file].name, serializeIni(next), deps);
    written.push(game.id);
  }
  return written;
}

export async function setMainValueForAll(
  editions: GameRecord[],
  section: string,
  key: string,
  value: string,
  deps: Partial<GameSettingsDeps> = {},
): Promise<void> {
  await editForAll(editions, "main", (ini) => setIniValue(ini, section, key, value), deps);
}

/** Skips an edition that has no such command (some are Yuri's Revenge only). */
export function setHotkeyForAll(
  editions: GameRecord[],
  name: string,
  value: number,
  deps: Partial<GameSettingsDeps> = {},
): Promise<GameId[]> {
  return editForAll(
    editions,
    "keyboard",
    (ini, _game, loaded) =>
      loaded.hotkeys.some((hotkey) => hotkey.name === name)
        ? setIniValue(ini, "Hotkey", name, String(value))
        : null,
    deps,
  );
}
