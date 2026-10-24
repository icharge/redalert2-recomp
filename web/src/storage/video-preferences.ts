/** Game resolutions the browser launcher can apply before startup. */
export const LAUNCHER_VIDEO_SIZES = [
  { w: 800, h: 600 },
  { w: 1024, h: 768 },
  { w: 1280, h: 720 },
  { w: 1366, h: 768 },
  { w: 1600, h: 900 },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1440 },
] as const;

const PREFERENCE_PREFIX = "ra2.video.";

export interface VideoPreference {
  w: number;
  h: number;
}

export function readVideoPreference(
  game: string,
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
): VideoPreference | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(`${PREFERENCE_PREFIX}${game}`) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const size = value as Partial<VideoPreference>;
    return LAUNCHER_VIDEO_SIZES.find(({ w, h }) => w === size.w && h === size.h) ?? null;
  } catch {
    return null;
  }
}

export function writeVideoPreference(
  game: string,
  preference: VideoPreference | null,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = safeLocalStorage(),
): void {
  try {
    if (!preference) storage?.removeItem(`${PREFERENCE_PREFIX}${game}`);
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
