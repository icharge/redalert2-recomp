/** Game resolutions the browser launcher can apply before startup. The same
 * sizes the browser host offers in the game's own Options list (pcrecomp's
 * win32hle/ddraw.c g_modes), so the launcher's choice is in the game's list. */
export const LAUNCHER_VIDEO_SIZES = [
  { w: 640, h: 480 },
  { w: 800, h: 600 },
  { w: 1024, h: 768 },
  { w: 1152, h: 864 },
  { w: 1280, h: 720 },
  { w: 1280, h: 768 },
  { w: 1280, h: 800 },
  { w: 1280, h: 960 },
  { w: 1280, h: 1024 },
  { w: 1360, h: 768 },
  { w: 1366, h: 768 },
  { w: 1400, h: 1050 },
  { w: 1440, h: 900 },
  { w: 1600, h: 900 },
  { w: 1600, h: 1200 },
  { w: 1680, h: 1050 },
  { w: 1920, h: 1080 },
  { w: 1920, h: 1200 },
  { w: 2048, h: 1152 },
  { w: 2560, h: 1080 },
  { w: 2560, h: 1440 },
  { w: 2560, h: 1600 },
  { w: 3440, h: 1440 },
  { w: 3840, h: 1600 },
  { w: 3840, h: 2160 },
  { w: 5120, h: 1440 },
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
