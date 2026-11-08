export const LAUNCHER_THEMES = [
  { id: "retro", name: "Retro modern" },
  { id: "skeuomorphic", name: "Industrial depth" },
  { id: "framed-tech", name: "Command frames" },
  { id: "game-ui", name: "Mission console" },
  { id: "game-feel", name: "Command feedback" },
  { id: "atmosphere", name: "Atmospheric light" },
  { id: "animation", name: "Cinematic sequence" },
] as const;

export type LauncherTheme = (typeof LAUNCHER_THEMES)[number]["id"];
const KEY = "ra2.launcher.theme";

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLauncherTheme(
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): LauncherTheme {
  try {
    const value = storage?.getItem(KEY);
    return LAUNCHER_THEMES.find(({ id }) => id === value)?.id ?? "retro";
  } catch {
    return "retro";
  }
}

export function writeLauncherTheme(
  theme: LauncherTheme,
  storage: Pick<Storage, "setItem"> | null = safeStorage(),
): void {
  try {
    storage?.setItem(KEY, theme);
  } catch {
    /* Keep the current session usable in private browsing. */
  }
}
