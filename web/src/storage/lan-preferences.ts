import { buildAllowsLanPlay } from "../config";

/** Whether the player wants LAN play: the game tray's LAN button, and the WebRTC dialog that the
 * game's Network button opens. On unless the player turned it off in the launcher's settings.
 * A build with VITE_SHOW_NETWORK_LAN=false has no LAN play whatever this says (config.ts). */
const KEY = "ra2-lan-play";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLanPlayPreference(
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
): boolean {
  try {
    return storage?.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeLanPlayPreference(
  on: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = browserStorage(),
): void {
  try {
    if (on) storage?.removeItem(KEY);
    else storage?.setItem(KEY, "0");
  } catch {
    // Storage may be unavailable, such as in a private window.
  }
}

/** Whether this launch offers LAN play: "build" when the build turned it off, "player" when the
 * player did, or "on". */
export function lanPlay(
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
  build: boolean = buildAllowsLanPlay(),
): "on" | "build" | "player" {
  if (!build) return "build";
  return readLanPlayPreference(storage) ? "on" : "player";
}
