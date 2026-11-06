import { useCallback, useEffect, useRef, useState } from "react";
import { baseIni, editForAll, type SettingsFile } from "../../../storage/all-games";
import {
  getIniValue,
  loadGameSettings,
  parseHotkeys,
  serializeIni,
  type GameSettingsDeps,
  type Ini,
  type LoadedGameSettings,
} from "../../../storage/game-settings";
import { defaultMainValue } from "../../../storage/game-settings-defaults";
import type { GameRecord } from "../../../storage/manifest";

export type Edit = (ini: Ini, game: GameRecord, loaded: LoadedGameSettings) => Ini | null;

export interface AllGamesSettings {
  /** the shown edition's files; null while they are read */
  loaded: LoadedGameSettings | null;
  error: string | null;
  setError(error: string | null): void;
  mainValue(section: string, key: string, fallback?: string): string;
  mainNumber(section: string, key: string, fallback: number): number;
  mainToggle(section: string, key: string, fallback?: boolean): boolean;
  hostValue(section: string, key: string, fallback: string): string;
  /** applies `edit` to the shown edition at once, then writes it to every edition, one write at a time */
  update(file: SettingsFile, edit: Edit, errorText?: string): Promise<void>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const ERROR_TEXT: Record<SettingsFile, string> = {
  main: "Could not save the game settings",
  host: "Could not save the setting",
  keyboard: "Could not save the keyboard settings",
};

function withFile(loaded: LoadedGameSettings, file: SettingsFile, ini: Ini): LoadedGameSettings {
  const data = serializeIni(ini);
  if (file === "main")
    return { ...loaded, main: { ...loaded.main, ini, data }, mainFromDefaults: false };
  if (file === "host") return { ...loaded, host: { ...loaded.host, ini, data } };
  return {
    ...loaded,
    keyboard: { ...loaded.keyboard, ini, data },
    hotkeys: parseHotkeys(ini),
    keyboardFromDefaults: false,
  };
}

/** The settings screen's view of the game files: it reads one edition and writes to all of them. */
export function useAllGamesSettings(
  editions: GameRecord[],
  edition: GameRecord,
  deps?: Partial<GameSettingsDeps>,
): AllGamesSettings {
  const [loaded, setLoaded] = useState<LoadedGameSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef<LoadedGameSettings | null>(null);
  const depsRef = useRef(deps);
  const latest = useRef({ editions, edition });
  latest.current = { editions, edition };
  // Writes run one after another, so two quick changes never read the same old file.
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = null;
    setLoaded(null);
    loadGameSettings(edition, depsRef.current)
      .then((next) => {
        if (cancelled) return;
        loadedRef.current = next;
        setLoaded(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(`Could not read the game settings: ${message(cause)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [edition]);

  const update = useCallback((file: SettingsFile, edit: Edit, errorText?: string) => {
    const run = async () => {
      const current = loadedRef.current;
      if (!current) return;
      const { editions: all, edition: shown } = latest.current;
      const next = edit(baseIni(file, shown, current), shown, current);
      const optimistic = next ? withFile(current, file, next) : current;
      loadedRef.current = optimistic;
      setLoaded(optimistic);
      try {
        await editForAll(all, file, edit, depsRef.current);
        setError(null);
      } catch (cause) {
        if (loadedRef.current === optimistic) {
          loadedRef.current = current;
          setLoaded(current);
        }
        setError(`${errorText ?? ERROR_TEXT[file]}: ${message(cause)}`);
      }
    };
    queue.current = queue.current.then(run, run);
    return queue.current;
  }, []);

  const mainValue = (section: string, key: string, fallback = ""): string => {
    const value = loaded?.main.ini ? getIniValue(loaded.main.ini, section, key) : null;
    return value ?? defaultMainValue(edition.id, section, key) ?? fallback;
  };
  const mainNumber = (section: string, key: string, fallback: number): number => {
    const value = Number(mainValue(section, key, String(fallback)));
    return Number.isFinite(value) ? value : fallback;
  };
  const mainToggle = (section: string, key: string, fallback = true): boolean =>
    mainValue(section, key, fallback ? "yes" : "no").toLowerCase() === "yes";
  const hostValue = (section: string, key: string, fallback: string): string =>
    (loaded?.host.ini ? getIniValue(loaded.host.ini, section, key) : null) ?? fallback;

  return { loaded, error, setError, mainValue, mainNumber, mainToggle, hostValue, update };
}
