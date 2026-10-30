// What the service worker decides, apart from the worker itself (src/sw.ts), so it can be tested
// (docs/web/deploy.md, "The service worker").

/** The files of one build of the game: they must all come from the same build, or the page and the game disagree. */
export function isGameBuildFile(pathname: string, base = "/"): boolean {
  return (
    pathname.startsWith(base) &&
    /^game\/(ra2|ra2md)\.(js|wasm|data)$/.test(pathname.slice(base.length))
  );
}

export const BUILD_JSON = "/game/build.json";

/** The id build.json gives this build of the game (cmake/build_json.cmake), or null if it has none. */
export function buildIdOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { build?: unknown }).build;
  return typeof id === "string" && /^[0-9a-f]{8,64}$/.test(id) ? id : null;
}

const gameCachePrefix = (base: string) =>
  base === "/" ? "ra2-game-" : `ra2-scope-${encodeURIComponent(base)}-game-`;

export const gameCacheName = (id: string, base = "/") => `${gameCachePrefix(base)}${id}`;

/** The caches of other builds of the game, to delete once this one is in use. */
export function staleGameCaches(names: string[], id: string, base = "/"): string[] {
  return names.filter(
    (name) => name.startsWith(gameCachePrefix(base)) && name !== gameCacheName(id, base),
  );
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

/** The most times one page may reload itself for isolation before the screen asks the player to. */
export const MAX_ISOLATION_RELOADS = 2;
/** How long the page waits after an attempt before trying another isolation reload. */
export const RELOAD_WINDOW_MS = 2_000;

interface Readable {
  getItem(key: string): string | null;
}
interface Writable {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface AttemptStore extends Readable, Writable {}
interface Attempt {
  n: number;
  at: number;
}

function readAttempt(storage: Readable, key: string): Attempt | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as { n?: unknown; at?: unknown };
    const n = Number(value.n);
    const at = Number(value.at);
    return Number.isFinite(n) && Number.isFinite(at) ? { n, at } : null;
  } catch {
    return null;
  }
}

/**
 * Whether the page may reload itself for isolation now: not too many attempts,
 * and not immediately after the last one (so a host that never isolates cannot
 * trap the page in a reload loop). The record is kept per deployment base, so
 * another app on the same origin cannot suppress this one's reload.
 */
export function isolationReloadAllowed(storage: Readable, key: string, now = Date.now()): boolean {
  const attempt = readAttempt(storage, key);
  if (!attempt) return true;
  if (attempt.n >= MAX_ISOLATION_RELOADS) return false;
  return now < attempt.at || now - attempt.at >= RELOAD_WINDOW_MS;
}

/** Record an isolation reload attempt for `key`. */
export function markIsolationReload(storage: AttemptStore, key: string, now = Date.now()): void {
  const n = (readAttempt(storage, key)?.n ?? 0) + 1;
  try {
    storage.setItem(key, JSON.stringify({ n, at: now }));
  } catch {
    // no storage: at worst the page reloads again once
  }
}

/** Forget the attempts once the page is isolated, so a later load may reload again. */
export function clearIsolationReload(storage: Writable, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // no storage: nothing was recorded
  }
}
