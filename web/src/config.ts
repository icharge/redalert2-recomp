/**
 * Whether this build offers LAN play at all. Only the exact string "false" turns it off: the
 * game tray has no LAN button, the launcher has no LAN setting, and the game's main menu has no
 * Network button (--no-lan). Unset, empty and unrecognized values keep it. Read at build time,
 * so a change needs a restart (dev) or a rebuild (production).
 */
export function buildAllowsLanPlay(
  value: string | undefined = import.meta.env.VITE_SHOW_NETWORK_LAN,
): boolean {
  return value !== "false";
}
