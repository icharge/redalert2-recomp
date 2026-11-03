/** Whether the launcher skips the game's intro. The logo still plays; the host's
 * `--no-intro` asks the game to skip only the intro. The intro is on by default. */
const PREFERENCE_PREFIX = "ra2.skip-intro.";

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readSkipIntroPreference(
  game: string,
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
): boolean {
  try {
    return storage?.getItem(`${PREFERENCE_PREFIX}${game}`) === "1";
  } catch {
    return false;
  }
}

export function writeSkipIntroPreference(
  game: string,
  skip: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = safeLocalStorage(),
): void {
  try {
    if (skip) storage?.setItem(`${PREFERENCE_PREFIX}${game}`, "1");
    else storage?.removeItem(`${PREFERENCE_PREFIX}${game}`);
  } catch {
    // Storage may be unavailable, such as in a private window.
  }
}

/** The start-up arguments for the intro. On by default; `--no-intro` skips only
 * the intro and keeps the logo. `?intro=0` (or `?intro=off`) skips it for one launch. */
export function introArguments(
  search: string,
  game: string,
  storage?: Pick<Storage, "getItem"> | null,
): string[] {
  const requested = new URLSearchParams(search).get("intro");
  const skip =
    requested === null
      ? readSkipIntroPreference(game, storage)
      : /^(?:0|no|off|skip)$/i.test(requested);
  return skip ? ["--no-intro"] : ["--intro"];
}
