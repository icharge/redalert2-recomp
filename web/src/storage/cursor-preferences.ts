/** Who draws the game's cursor.
 *
 * The page layer draws it above the picture at the display's rate (a match's
 * MOUSE.SHA frame, the menus' Win32 arrow: docs/web/cursor-layer.md), which is
 * the default. The game's own software cursor — drawn into its picture at the
 * game's frame rate, the traditional way — is the other choice, kept for
 * players who want the picture to be the only thing on screen.
 *
 * The choice is a launcher-side preference per installation, so the launcher can
 * pass it to the game before it starts (a `?cursor=game` on the game's address);
 * the game itself has no opinion. The native presenter's `RA2_PAGE_CURSOR` is a
 * separate switch and is not affected.
 */
const PREFERENCE_PREFIX = "ra2.software-cursor.";

export type CursorChoice = "page" | "game";

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The page layer unless this installation chose the game's own cursor. */
export function readCursorPreference(
  game: string,
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
): CursorChoice {
  try {
    return storage?.getItem(`${PREFERENCE_PREFIX}${game}`) === "1" ? "game" : "page";
  } catch {
    return "page";
  }
}

export function writeCursorPreference(
  game: string,
  choice: CursorChoice,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = safeLocalStorage(),
): void {
  try {
    if (choice === "game") storage?.setItem(`${PREFERENCE_PREFIX}${game}`, "1");
    else storage?.removeItem(`${PREFERENCE_PREFIX}${game}`);
  } catch {
    // Storage may be unavailable, such as in a private window.
  }
}

/**
 * What the launcher should tell the game: `?cursor=page` or `?cursor=game`.
 * An explicit `?cursor=` on the launcher's own address wins for one launch
 * (`page`, `game`, or `software`/`off` for the traditional one).
 */
export function cursorChoice(
  search: string,
  _game: string,
  _storage?: Pick<Storage, "getItem"> | null,
): CursorChoice {
  void _game;
  void _storage;
  const requested = new URLSearchParams(search).get("cursor");
  if (requested === "page") return "page";
  if (requested === "game" || requested === "software" || requested === "off") return "game";
  // The launcher no longer exposes the classic cursor preference. Keep an
  // explicit query override for diagnostics, but default every installation
  // to the smooth page cursor even if it has an older saved preference.
  return "page";
}
