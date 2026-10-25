import { Manifest } from "../storage/manifest";

/** What the player chose about when the game may make sound. */
export interface SoundPreferences {
  /** all sound goes quiet while the page is hidden or the window has lost focus */
  muteOnBlur: boolean;
  /** the game's music plays outside a match (menus, lobbies, briefings); off, it is heard in matches only */
  menuMusic: boolean;
}

export const DEFAULT_SOUND_PREFERENCES: SoundPreferences = { muteOnBlur: false, menuMusic: true };

/** The player's sound preferences, or the defaults for what is missing or not a yes/no. Never throws. */
export async function loadSoundPreferences(
  open: () => Promise<Manifest> = () => Manifest.open(),
): Promise<SoundPreferences> {
  const result = { ...DEFAULT_SOUND_PREFERENCES };
  try {
    const manifest = await open();
    for (const key of Object.keys(result) as (keyof SoundPreferences)[]) {
      const value = await manifest.getSetting<boolean>(key);
      if (typeof value === "boolean") result[key] = value;
    }
  } catch {
    // no storage: the defaults
  }
  return result;
}

export async function saveSoundPreference(
  key: keyof SoundPreferences,
  value: boolean,
  open: () => Promise<Manifest> = () => Manifest.open(),
): Promise<void> {
  try {
    await (await open()).setSetting(key, value);
  } catch {
    // the choice is just not remembered
  }
}
