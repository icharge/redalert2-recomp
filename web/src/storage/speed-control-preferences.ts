/** Whether the launch passes the guest's `-SPEEDCONTROL` switch, which puts the game speed
 * slider in campaign missions. Off by default. The web host forwards it as `--speedcontrol`
 * and rebuilds the guest command line as `-SPEEDCONTROL` (src/web/main.c). */
const PREFERENCE_PREFIX = "ra2.speed-control.";

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCampaignSpeedControlPreference(
  game: string,
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
): boolean {
  try {
    return storage?.getItem(`${PREFERENCE_PREFIX}${game}`) === "1";
  } catch {
    return false;
  }
}

export function writeCampaignSpeedControlPreference(
  game: string,
  on: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = safeLocalStorage(),
): void {
  try {
    if (on) storage?.setItem(`${PREFERENCE_PREFIX}${game}`, "1");
    else storage?.removeItem(`${PREFERENCE_PREFIX}${game}`);
  } catch {
    // Storage may be unavailable, such as in a private window.
  }
}

/** The launch arguments for campaign speed control. `?speedcontrol=0` or `=1` overrides the stored
 * choice for one launch; anything else keeps the preference. */
export function speedControlArguments(
  search: string,
  game: string,
  storage?: Pick<Storage, "getItem"> | null,
): string[] {
  const requested = new URLSearchParams(search).get("speedcontrol");
  const on =
    requested === null
      ? readCampaignSpeedControlPreference(game, storage)
      : /^(?:1|yes|on)$/i.test(requested);
  return on ? ["-SPEEDCONTROL"] : [];
}
