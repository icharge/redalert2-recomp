/**
 * Whether the game tray shows its LAN button. Only the exact string "false" hides it:
 * unset, empty and unrecognized values keep it. Read at build time, so a change needs a restart.
 */
export function networkLanVisible(
  value: string | undefined = import.meta.env.VITE_SHOW_NETWORK_LAN,
): boolean {
  return value !== "false";
}
