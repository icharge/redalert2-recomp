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

export interface VideoPreference {
  w: number;
  h: number;
}

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

/** The launcher's size for a game: the saved choice, the desktop's own size when
 * nothing was saved (the default), or null when "Use game setting" was chosen.
 * `fallback` is the native size, overridable for tests and pages without a screen. */
export function readVideoPreference(
  game: string,
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
  fallback: VideoPreference | null = nativeVideoSize(),
): VideoPreference | null {
  const native = fallback && fallback.w > 0 && fallback.h > 0 ? fallback : null;
  try {
    const raw = storage?.getItem(`${PREFERENCE_PREFIX}${game}`);
    if (raw === null || raw === undefined) return native;
    const value: unknown = JSON.parse(raw);
    if (value === GAME_SETTING) return null;
    if (typeof value !== "object" || value === null) return native;
    const size = value as Partial<VideoPreference>;
    if (!Number.isInteger(size.w) || !Number.isInteger(size.h)) return native;
    const { w, h } = size as VideoPreference;
    // The launcher adds the desktop's own size, which need not be in the catalog.
    if (w < 320 || h < 200 || w > 16384 || h > 16384) return native;
    return { w, h };
  } catch {
    return native;
  }
}

export function writeVideoPreference(
  game: string,
  preference: VideoPreference | null,
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
