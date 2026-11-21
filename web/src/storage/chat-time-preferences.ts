/** Whether chat lines start with the local time ("14:05 [nick] : hello").
 *
 * On unless the player turned it off. The game reads the same key on the
 * page's main thread for every line its chat lists add, so a change applies
 * to the next line (src/web/wolapi.c, web_chat_time; docs/wol/handoff-wolapi.md,
 * "Chat times").
 */
const KEY = "ra2-chat-time";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readChatTimePreference(
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
): boolean {
  try {
    return storage?.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeChatTimePreference(
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
