/** The online name a guest gives at PLAY, remembered in this browser (LW-4). */
const KEY = "ra2.guest-name";

/** A guest name is at most 9 characters: the game's own login field takes no more. */
export const GUEST_NAME_MAX = 9;

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readGuestName(
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
): string {
  try {
    return (storage?.getItem(KEY) ?? "").slice(0, GUEST_NAME_MAX);
  } catch {
    return "";
  }
}

export function writeGuestName(
  name: string,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = safeLocalStorage(),
): void {
  try {
    if (name) storage?.setItem(KEY, name);
    else storage?.removeItem(KEY);
  } catch {
    // Storage may be unavailable, such as in a private window: the name is not remembered.
  }
}
