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

/** What "Use game setting" stores: no launcher override, the game's own size. */
const GAME_SETTING = "game";

/** What "Match browser size" stores: the match renders at the page's own pixel
 * size (the window in CSS pixels times the device pixel ratio), so the picture
 * is 1:1 with the browser. */
export const BROWSER_VIDEO_SIZE = "browser";

export interface VideoPreference {
  w: number;
  h: number;
}

/** A saved choice: a fixed size, null for "Use game setting", or the
 * "Match browser size" marker (resolved to a size when it is used). */
export type VideoChoice = VideoPreference | typeof BROWSER_VIDEO_SIZE | null;

/** The desktop's own pixel size: the screen in CSS pixels times the device pixel
 * ratio, so a 1920×1080 display at 150% scaling reports 1920×1080 rather than
 * 1280×720. A screen the browser cannot read gives 0×0. */
export function nativeVideoSize(
  screenSize: Pick<Screen, "width" | "height"> | null = typeof window === "undefined"
    ? null
    : window.screen,
  ratio: number = typeof window === "undefined" ? 1 : window.devicePixelRatio,
): VideoPreference {
  const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  return {
    w: Math.max(0, Math.round((screenSize?.width ?? 0) * scale)),
    h: Math.max(0, Math.round((screenSize?.height ?? 0) * scale)),
  };
}

/** The browser page's own pixel size: its CSS viewport times the device pixel
 * ratio, the same size the canvas is drawn at, so a match set to "Match browser
 * size" is 1:1 with the page. Rounded up to even numbers (display modes are) and
 * kept inside the size the game can allocate. A page without a window gives 0×0. */
export function browserVideoSize(
  view: { width: number; height: number } | null = typeof window === "undefined"
    ? null
    : { width: window.innerWidth, height: window.innerHeight },
  ratio: number = typeof window === "undefined" ? 1 : window.devicePixelRatio,
): VideoPreference {
  if (!view) return { w: 0, h: 0 };
  const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const even = (value: number, low: number) =>
    Math.min(8192, Math.max(low, Math.round((value * scale) / 2) * 2));
  return { w: even(view.width, 320), h: even(view.height, 200) };
}

/** The launcher's resolution list, with the desktop's own size marked as the
 * native one (and added after the known sizes when the catalog lacks it). */
export function launcherVideoOptions(
  native: VideoPreference = nativeVideoSize(),
): (VideoPreference & { native: boolean })[] {
  const options: (VideoPreference & { native: boolean })[] = LAUNCHER_VIDEO_SIZES.map(
    ({ w, h }) => ({
      w,
      h,
      native: w === native.w && h === native.h,
    }),
  );
  if (native.w > 0 && native.h > 0 && !options.some((option) => option.native)) {
    options.push({ ...native, native: true });
    options.sort((a, b) => a.w - b.w || a.h - b.h);
  }
  return options;
}

/** The launcher's size when the player has not chosen one. */
export const DEFAULT_VIDEO_SIZE: VideoPreference = { w: 1920, h: 1080 };

/** The launcher's saved choice for a game, without resolving it: a fixed size,
 * "browser" for "Match browser size", or null for "Use game setting" (and an
 * unreadable value falls back to the default size). */
export function readVideoChoice(
  game: string,
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
): VideoChoice {
  try {
    const raw = storage?.getItem(`${PREFERENCE_PREFIX}${game}`);
    if (raw === null || raw === undefined) return { ...DEFAULT_VIDEO_SIZE };
    const value: unknown = JSON.parse(raw);
    if (value === GAME_SETTING) return null;
    if (value === BROWSER_VIDEO_SIZE) return BROWSER_VIDEO_SIZE;
    if (typeof value !== "object" || value === null) return { ...DEFAULT_VIDEO_SIZE };
    const size = value as Partial<VideoPreference>;
    if (!Number.isInteger(size.w) || !Number.isInteger(size.h)) return { ...DEFAULT_VIDEO_SIZE };
    const { w, h } = size as VideoPreference;
    // The launcher adds the desktop's own size, which need not be in the catalog.
    if (w < 320 || h < 200 || w > 16384 || h > 16384) return { ...DEFAULT_VIDEO_SIZE };
    return { w, h };
  } catch {
    return { ...DEFAULT_VIDEO_SIZE };
  }
}

/** The launcher's size for a game: the fixed choice, the browser's size for
 * "Match browser size", the default 1920×1080 when nothing was saved, or null
 * when "Use game setting" was chosen. The desktop's own size stays in the list
 * as "(Native)" for the player to choose. */
export function readVideoPreference(
  game: string,
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
  browser: VideoPreference = browserVideoSize(),
): VideoPreference | null {
  const choice = readVideoChoice(game, storage);
  return choice === BROWSER_VIDEO_SIZE ? { ...browser } : choice;
}

export function writeVideoPreference(
  game: string,
  preference: VideoChoice,
  storage: Pick<Storage, "setItem"> | null = safeLocalStorage(),
): void {
  try {
    storage?.setItem(`${PREFERENCE_PREFIX}${game}`, JSON.stringify(preference ?? GAME_SETTING));
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
