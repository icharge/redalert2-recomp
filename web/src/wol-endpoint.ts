/**
 * Where the operator's WOL HTTP server is: the member routes (src/account), ticket redemption and the
 * game's WOL login (src/game/loader.ts) all go there.
 *
 * The member session's only lasting credential is the server's `ra2refresh` cookie, which is
 * SameSite=Lax over plain http. A page on `http://localhost:5173` calling `http://127.0.0.1:9090`
 * is cross-site, so the browser drops that cookie and a reload signs the member out. On the dev
 * server the default is therefore the page's own origin, under {@link DEV_PROXY_PATH}, which Vite
 * forwards to the real server (vite.config.ts, {@link wolDevProxy}).
 */

/** The dev server's prefix for the WOL server (HTTP and WebSockets). */
export const DEV_PROXY_PATH = "/ra2web/";

/** Where the dev proxy sends {@link DEV_PROXY_PATH} unless `RA2_WOL_PROXY_TARGET` says otherwise. */
export const DEV_PROXY_TARGET = "http://127.0.0.1:9090";

const FALLBACK = "http://127.0.0.1:9090";

export interface EndpointEnv {
  /** `VITE_WOL_HTTP_URL`, when the operator set one. */
  configured?: string;
  /** `import.meta.env.DEV`: the Vite dev server, which has the proxy. */
  dev: boolean;
  /** The page's origin (`location.origin`). */
  origin: string;
}

export function resolveWolHttpUrl(env: EndpointEnv): string {
  if (env.configured) return env.configured;
  if (env.dev) return `${env.origin}${DEV_PROXY_PATH}`;
  return FALLBACK;
}

/** The server for this page, from the build's settings. */
export function wolHttpUrl(): string {
  return resolveWolHttpUrl({
    configured: import.meta.env.VITE_WOL_HTTP_URL || undefined,
    dev: import.meta.env.DEV,
    origin: typeof location === "undefined" ? "http://localhost" : location.origin,
  });
}

/** Vite `server.proxy` entries for {@link DEV_PROXY_PATH}. Plain data: vite.config.ts uses it. */
export function wolDevProxy(target: string) {
  const prefix = DEV_PROXY_PATH.slice(0, -1);
  return {
    [prefix]: {
      target,
      ws: true,
      // the server sees its own host; the Origin header stays the page's (LAUNCHER_ORIGINS)
      changeOrigin: true,
      rewrite: (path: string) => path.slice(prefix.length) || "/",
      // the server scopes the cookie to /v1/auth; the page reaches that path under the prefix
      cookiePathRewrite: { "/v1/auth": `${DEV_PROXY_PATH}v1/auth` },
      cookieDomainRewrite: { "*": "" },
    },
  } as Record<
    string,
    {
      target: string;
      ws: boolean;
      changeOrigin: boolean;
      rewrite: (path: string) => string;
      cookiePathRewrite: Record<string, string>;
      cookieDomainRewrite: Record<string, string>;
    }
  >;
}
