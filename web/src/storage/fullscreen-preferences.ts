/** What the launcher does with the browser's fullscreen when a game starts. */
export interface FullscreenPreference {
  /** Enter fullscreen when the game page starts. */
  enabled: boolean;
  /** Keep the launcher windowed: fullscreen from the loading screen through the score screen. */
  onlyInGame: boolean;
}

export const WINDOWED: FullscreenPreference = { enabled: false, onlyInGame: false };

const PREFERENCE_PREFIX = "ra2.fullscreen.";

export function readFullscreenPreference(
  game: string,
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
): FullscreenPreference {
  try {
    const value: unknown = JSON.parse(storage?.getItem(`${PREFERENCE_PREFIX}${game}`) ?? "null");
    if (typeof value !== "object" || value === null) return WINDOWED;
    const preference = value as Partial<FullscreenPreference>;
    return { enabled: preference.enabled === true, onlyInGame: preference.onlyInGame === true };
  } catch {
    return WINDOWED;
  }
}

export function writeFullscreenPreference(
  game: string,
  preference: FullscreenPreference,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = safeLocalStorage(),
): void {
  try {
    if (!preference.enabled) storage?.removeItem(`${PREFERENCE_PREFIX}${game}`);
    else storage?.setItem(`${PREFERENCE_PREFIX}${game}`, JSON.stringify(preference));
  } catch {
    /* private browsing may deny local storage */
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
