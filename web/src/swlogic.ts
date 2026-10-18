// What the service worker decides, apart from the worker itself (src/sw.ts), so it can be tested
// (docs/web/deploy.md, "The service worker").

/** The files of one build of the game: they must all come from the same build, or the page and the game disagree. */
export function isGameBuildFile(pathname: string): boolean {
  return /^\/game\/ra2\.(js|wasm|data)$/.test(pathname);
}

export const BUILD_JSON = "/game/build.json";

/** The id build.json gives this build of the game (cmake/build_json.cmake), or null if it has none. */
export function buildIdOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { build?: unknown }).build;
  return typeof id === "string" && /^[0-9a-f]{8,64}$/.test(id) ? id : null;
}

const GAME_CACHE = "ra2-game-";

export const gameCacheName = (id: string) => `${GAME_CACHE}${id}`;

/** The caches of other builds of the game, to delete once this one is in use. */
export function staleGameCaches(names: string[], id: string): string[] {
  return names.filter((name) => name.startsWith(GAME_CACHE) && name !== gameCacheName(id));
}

/**
 * The response with the headers that make the page cross-origin isolated (threads need it), for a host that
 * does not send them. An opaque response (no body to wrap) goes through as it is.
 */
export function withIsolation(response: Response): Response {
  if (response.type === "opaque" || response.type === "opaqueredirect" || response.status === 0)
    return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Whether the page should reload itself once: a worker is in charge now, and the page was loaded without its headers. */
export function shouldReloadForIsolation(
  isolated: boolean,
  alreadyReloaded: boolean,
  hasController: boolean,
): boolean {
  return !isolated && hasController && !alreadyReloaded;
}
