// The active mod is the host's `[mods] active=` in the edition's `.host` INI, the value
// src/web/settings.c reads at start-up and F9 changes in game. "" is Vanilla.
import {
  decodeLatin1,
  defaultHostIni,
  encodeLatin1,
  getIniValue,
  loadGameSettings,
  serializeIni,
  setIniValue,
  writeGameSettings,
  type GameSettingsDeps,
} from "./game-settings";
import type { GameRecord } from "./manifest";
import type { ModRecord } from "./mods";

/** The active mod's name as `mods` spells it; "" for Vanilla or a mod that is no longer there. */
export async function readActiveMod(
  game: GameRecord,
  mods: ModRecord[],
  deps: Partial<GameSettingsDeps> = {},
): Promise<string> {
  const { host } = await loadGameSettings(game, deps);
  const raw = host.ini ? getIniValue(host.ini, "mods", "active") : null;
  const name = raw === null ? "" : fromHostBytes(raw).trim();
  if (!name) return "";
  return mods.find((mod) => mod.name.toLowerCase() === name.toLowerCase())?.name ?? "";
}

export async function writeActiveMod(
  game: GameRecord,
  name: string,
  deps: Partial<GameSettingsDeps> = {},
): Promise<void> {
  const { host } = await loadGameSettings(game, deps);
  const ini = setIniValue(host.ini ?? defaultHostIni(), "mods", "active", toHostBytes(name));
  await writeGameSettings(game, host.name, serializeIni(ini), deps);
}

// The INI is held as Latin-1 (one char per byte); the host and mod folder names use UTF-8.
function toHostBytes(name: string): string {
  return decodeLatin1(new TextEncoder().encode(name));
}

function fromHostBytes(value: string): string {
  return new TextDecoder().decode(encodeLatin1(value));
}
