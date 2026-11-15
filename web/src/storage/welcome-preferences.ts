/** Whether the player closed the welcome page for good in this browser (LW-1). */
const KEY = "ra2.welcome-dismissed";

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readWelcomeDismissed(
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
): boolean {
  try {
    return storage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWelcomeDismissed(
  storage: Pick<Storage, "setItem"> | null = safeLocalStorage(),
): void {
  try {
    storage?.setItem(KEY, "1");
  } catch {
    // Storage may be unavailable, such as in a private window: the page shows again next time.
  }
}

/**
 * The launcher opens on the welcome page on a first run and for as long as nothing is installed,
 * until the player dismisses it. An install in the browser always opens on PLAY.
 */
export function showWelcome(
  installed: boolean,
  storage?: Pick<Storage, "getItem"> | null,
): boolean {
  return !installed && !readWelcomeDismissed(storage);
}
