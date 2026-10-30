# Hosting and browsers

## What is hosted, and what isn't

The page (HTML, JS, CSS, icons) is ours and can be published anywhere.

`ra2.wasm` and `ra2md.wasm` are compiled from the lifted C, which is generated from
`gamemd.exe`. The project's rule is that nothing generated from the game is
distributed ([CONTRIBUTING.md](../../CONTRIBUTING.md), ROADMAP "Out of
scope"). So publishing a built `ra2.wasm` on a public site is out, the same
as publishing the lifted C. That leaves two ways to use the browser build:

1. **Local.** The player builds as today (Setup, then the web step) and runs
   `pnpm preview` or `build-web.sh --serve`, which serves `web/` on
   `localhost` with the right headers. The browser is the platform, and the
   machine is still theirs. This is the supported way.
2. **A hosted page, local wasm.** The page is published, and the player's
   own build of the edition's Wasm module is picked like the game folder and stored in
   OPFS beside it. Then nothing generated from the game ever leaves the
   player's machine. This is possible later. It's a decision for the
   project, not something these docs settle.

Until that decision is made, everything below applies to the local server,
and to any hosted page.

## Application context path and clean routes

The launcher is `/`, installation slots launch at `/game/:slot`, and import
is `/import`. An optional `?edition=ra2` or `?edition=ra2md` selects the
edition; a slot containing both defaults to Yuri's Revenge. Slot numbers
identify imported folders, not fixed game editions.

Build for a context path with Vite's base setting. For example, in PowerShell:

```powershell
cd web
$env:RA2_BASE = '/emu/'
pnpm build
pnpm preview --host 127.0.0.1
```

For development, `pnpm dev --base=/emu/` uses the same prefix. The resulting
launcher is `/emu/`, and `/emu/game/1` is slot 1. Router basename, game
script/WASM/data, file-browser assets, fonts, audio worklet, and service
worker scope all use this base. OPFS and IndexedDB remain origin-wide;
moving the app to a context path on the same origin retains its imports.

### Build-time settings from `.env` files

Vite reads `web/.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local`
(later files win), so these settings can live in a file instead of the shell;
a variable already set in the environment still wins over all of them. The mode
picks the file:

| Command                        | Mode         | Reads             |
| ------------------------------ | ------------ | ----------------- |
| `pnpm build`                   | `production` | `.env.production` |
| `pnpm build:prod`              | `production` | `.env.production` |
| `pnpm build:mode staging`      | `staging`    | `.env.staging`    |
| `pnpm build -- --mode staging` | `staging`    | `.env.staging`    |

`pnpm build:prod` is the deployment build: the same typecheck and build as
`pnpm build`, pinned to mode `production`, so it reads `.env.production` and not
a `.env.prod` file. `pnpm build:mode <name>` (or `pnpm build -- --mode <name>`)
is the same build with another mode, reading `.env.<name>`.

```sh
# web/.env.production
RA2_BASE=/emu/
VITE_WOL_HTTP_URL=https://service.example/
VITE_WOL_SOCKET_URL=wss://service.example/wol
```

`RA2_BASE` is read by `vite.config.ts` and drives `base` (and everything above);
the `VITE_*` values are inlined at build time. All of these are public endpoint
configuration, not secrets: don't put secrets in these files. `.env*.local` is
for machine-specific overrides and stays out of git.

A production server must serve the application HTML for clean routes and
preserve existing asset files. For nginx with the build mounted at `/emu/`:

```nginx
location /emu/ {
    try_files $uri $uri/ /emu/index.html;
    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Embedder-Policy require-corp always;
}
```

A complete server block — clean routes, the wasm type, cache lifetimes for the
shell and the hashed assets, the service worker, and the precompressed sidecars
— is [nginx.conf](nginx.conf); copy `web/dist/*` into its `root`'s `/emu/`
directory and adjust `server_name`/`root`.

Direct requests and refreshes of `/emu/game/1` must return that HTML. An
initial deep link still requires this server rewrite before a service
worker has been installed. Once installed, the worker supplies a
base-relative navigation fallback offline, caching build metadata and
isolating its build-cache cleanup from other deployment bases.

## Precompressed WebAssembly

Each local Emscripten web build writes `.br` (Brotli quality 9) and `.gz`
(gzip level 9) sidecars beside each module. Both edition bundles live directly
under `/game/`: Red Alert 2 uses `ra2.js`, `ra2.wasm`, and `ra2.data`; Yuri's
Revenge uses `ra2md.js`, `ra2md.wasm`, and `ra2md.data`. The page requests
`/game/ra2.wasm` or `/game/ra2md.wasm` as appropriate. Vite dev and preview select the best
acceptable available representation in the order given by `Accept-Encoding`,
preferring Brotli for equal quality, then gzip, then the original Wasm. A
missing sidecar falls back to the next available representation.

For a compressed response, send:

```http
Content-Type: application/wasm
Content-Encoding: br
Vary: Accept-Encoding
```

Use `Content-Encoding: gzip` for gzip. The identity response keeps
`Content-Type: application/wasm` and also varies by `Accept-Encoding`. This
preserves streaming compilation at the original URL. The `Vary` header lets
shared caches keep each representation separate. The service worker caches
the normal module URL under the existing build ID; `build.json` continues to
identify the original JavaScript, Wasm, and data files.

### Nginx static hosting

The sample Nginx block below applies only when Nginx serves a self-hosted local
web build. It serves Brotli sidecars for Brotli clients, uses Nginx's gzip
filter for gzip-only clients, and leaves the original file for clients that
accept neither encoding:

```nginx
location ~ \.wasm$ {
    types { application/wasm wasm; }
    default_type application/wasm;

    brotli_static on;
    brotli on;
    brotli_types application/wasm;

    gzip on;
    gzip_types application/wasm;
    gzip_vary on;
}
```

This requires the Nginx Brotli static and filter modules. Nginx's built-in
`gzip_static` module is not built by default. Avoid turning on both
`gzip_static` and `brotli_static` without testing their precedence: the
upstream Brotli module documents cases where gzip static wins even when a
client accepts both. The block above uses Brotli static delivery and dynamic
gzip fallback; the `.gz` sidecar is used by Vite and other hosts with an
encoding selector. [Nginx gzip static module](https://nginx.org/en/docs/http/ngx_http_gzip_static_module.html),
[Nginx Brotli module](https://github.com/google/ngx_brotli).

Check the selected response and payload with:

```sh
nginx -t
curl -sS -D - -o /dev/null -H 'Accept-Encoding: br, gzip' https://example.test/game/ra2md.wasm
curl -sS -D - -o /dev/null -H 'Accept-Encoding: gzip' https://example.test/game/ra2.wasm
curl -sS -D - -o /dev/null -H 'Accept-Encoding: identity' https://example.test/game/ra2.wasm
```

The current `../ra2web/server/nginx.conf` is the WOL API reverse proxy; it
does not serve this app's static files. It does not need a change for this
feature. If the app is placed behind a different Nginx static host, apply the
block there and keep generated game modules out of any public deployment, as
the project policy requires.

## WOL server endpoints

The native Internet / Custom Match bridge defaults to the local RA2Web server
at `http://127.0.0.1:19090`. An operator can select a trusted server using Vite
environment variables before starting development or building the frontend:

```powershell
cd web
$env:VITE_WOL_HTTP_URL = 'https://service.thaira2.com/'
$env:VITE_WOL_SOCKET_URL = 'wss://service.thaira2.com/wol'
pnpm dev
```

Restart Vite after changing these settings. For a production frontend, set them
before `pnpm build` — in the environment or in `web/.env.production` (see
[Build-time settings from `.env` files](#build-time-settings-from-env-files)).
Both are public endpoint configuration, not secrets. The
HTTP base serves `register` and `login`; the WebSocket URL is independent so
authentication does not accidentally go to `/wol/register`. Both support a
server context path, independently of the frontend's `RA2_BASE`. Without an
explicit socket URL, its URL is derived from the HTTP base using WS(S).
Game URLs and query parameters cannot change the login destination. Clear both
variables to return to the local default.

The RA2Web deployment must include `server/src/gserv/NativeRelay.ts` and its
`server/src/index.ts` route. Forward WebSocket upgrades at `/wol` and
`/gserv/native`; STARTG must advertise the public WSS gserv base. Allow the
player's local frontend origin for HTTP authentication and WebSocket access.
Keep generated game modules on each player's own machine as described above.

On 25 October, browser probes of `service.thaira2.com` returned HTTP 200 for
`health` and `servers.ini` from `http://localhost:5173`, and `/wol` accepted
`cvers`. However, `/gserv/native` replied to an invalid ticket with the older
gserv numeric protocol (`103`) rather than the native relay's
`error invalid ticket` and close code 4001. Its WebSocket upgrade alone does
not prove that the native relay is deployed. Public gameplay remains unverified;
the user is handling further manual testing.

## Headers

Threads need `SharedArrayBuffer`, which needs the page to be cross-origin
isolated:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

- The local server (`vite preview`, `build-web.sh --serve`) sends them.
- On a static host that can't set headers (GitHub Pages), the service
  worker adds them to every response it serves (the `coi-serviceworker`
  approach). The first load then reloads once. The attempt is recorded per
  deployment base and only for a short time (and cleared once the page is
  isolated), so a reload that came back without the headers — or another app
  on the same origin — cannot leave the tab stuck on the browser check; it
  offers a Reload button too.
- Everything the page loads is same-origin, so `require-corp` doesn't block
  anything. Don't add third-party scripts, fonts or analytics.

Also served:

- `.wasm` as `application/wasm`, so `instantiateStreaming` compiles it while
  it downloads.
- Brotli and gzip negotiated from precompressed `.wasm.br` / `.wasm.gz` files
  in local builds; identity remains available as fallback.

## The service worker

Made by `vite-plugin-pwa` (Workbox), registered in `main.tsx`:

- Precaches the page's assets (hashed names, so a new build replaces them).
- Caches the selected edition's `.wasm` and `.js` assets cache-first, keyed by the build's hash in
  `build.json`. A new build is fetched in the background, and the page
  offers "update available, reload".
- Adds the COOP/COEP headers where the host doesn't.
- With `manifest.webmanifest` it makes the page installable, with its own
  window and icon, and it works offline once loaded.

It never caches anything from OPFS. The game files are already local.

## Browser support

| Needs                                       | Chromium (Chrome, Edge)                | Firefox           | Safari                 |
| ------------------------------------------- | -------------------------------------- | ----------------- | ---------------------- |
| `SharedArrayBuffer` (cross-origin isolated) | yes                                    | yes               | yes (15.2+)            |
| WebGL2                                      | yes                                    | yes               | yes                    |
| OPFS with sync access handles in workers    | yes                                    | yes               | yes (17+)              |
| `showDirectoryPicker`                       | yes                                    | no: drag and drop | no: drag and drop      |
| OffscreenCanvas with WebGL in workers       | yes                                    | yes               | yes (17+)              |
| Audio worklets                              | yes                                    | yes               | yes                    |
| `navigator.keyboard.lock()`                 | yes                                    | no                | no                     |
| Typical OPFS quota                          | a share of free disk, often tens of GB | similar           | smaller and may prompt |

Chromium is the first target. Firefox and Safari are tested from stage 6,
and the Browser check screen ([frontend.md](frontend.md)) says what's missing.
Phones and tablets are out of scope: the game needs a mouse, and a 1 GB
import.
