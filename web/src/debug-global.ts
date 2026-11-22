/**
 * The local end-to-end checks (e2e/) read the game's state through `window.ra2Store`. A production
 * build never has it: only the dev server, or a build made with `VITE_E2E_HOOKS=1` and opened with
 * `?e2e` or `?test=1`. The flag is read at build time, so a normal build has no way to turn it on.
 */
export interface DebugFlags {
  /** `import.meta.env.DEV`: the Vite dev server. */
  dev: boolean;
  /** `VITE_E2E_HOOKS=1` when the page was built. */
  e2eBuild: boolean;
}

export function exposeDebugStore(
  win: Pick<Window, "location">,
  store: unknown,
  flags: DebugFlags,
): void {
  const query = new URLSearchParams(win.location.search);
  const asked = query.has("e2e") || query.get("test") === "1";
  if (flags.dev || (flags.e2eBuild && asked)) (win as { ra2Store?: unknown }).ra2Store = store;
}
