import type { GameId } from "./install";

export interface SettingsFileNames {
  main: string;
  keyboard: string;
}

/** The settings files of an edition, used for case-insensitive lookup. */
export function settingsFileNames(game: GameId): SettingsFileNames {
  return game === "ra2"
    ? { main: "ra2.ini", keyboard: "keyboard.ini" }
    : { main: "ra2md.ini", keyboard: "keyboardmd.ini" };
}

/** The main INI's spelling as the game writes it; writes must use this name. */
export function gameIniName(game: GameId): string {
  return game === "ra2" ? "RA2.INI" : "RA2MD.INI";
}

/** A top-level profile INI, the file the game appends whole copies to. */
export function isProfileIniPath(path: string): boolean {
  return /^(?:ra2|ra2md)\.ini$/i.test(path);
}

/** A main or keyboard settings file, wherever the game keeps it (including a mod's folder and .host). */
export function isSettingsPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return isProfileIniPath(name) || /^(?:keyboard|keyboardmd)\.ini$/i.test(name);
}
