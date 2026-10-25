# Hosting and browsers

## What is hosted, and what isn't

The page (HTML, JS, CSS, icons) is ours and can be published anywhere.

`ra2.wasm` is compiled from the lifted C, which is generated from
`gamemd.exe`. The project's rule is that nothing generated from the game is
distributed ([CONTRIBUTING.md](../../CONTRIBUTING.md), ROADMAP "Out of
scope"). So publishing a built `ra2.wasm` on a public site is out, the same
as publishing the lifted C. That leaves two ways to use the browser build:

1. **Local.** The player builds as today (Setup, then the web step) and runs
   `pnpm preview` or `build-web.sh --serve`, which serves `web/` on
   `localhost` with the right headers. The browser is the platform, and the
   machine is still theirs. This is the supported way.
2. **A hosted page, local wasm.** The page is published, and the player's
   own build of `ra2.wasm` is picked like the game folder and stored in
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

A production server must serve the application HTML for clean routes and
preserve existing asset files. For nginx with the build mounted at `/emu/`:

```nginx
location /emu/ {
    try_files $uri $uri/ /emu/index.html;
    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Embedder-Policy require-corp always;
}
```

Direct requests and refreshes of `/emu/game/1` must return that HTML. An
initial deep link still requires this server rewrite before a service
worker has been installed. Once installed, the worker supplies a
base-relative navigation fallback offline, caching build metadata and
isolating its build-cache cleanup from other deployment bases.

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
before `pnpm build`. Both are public endpoint configuration, not secrets. The
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
  approach). The first load then reloads once.
- Everything the page loads is same-origin, so `require-corp` doesn't block
  anything. Don't add third-party scripts, fonts or analytics.

Also served:

- `.wasm` as `application/wasm`, so `instantiateStreaming` compiles it while
  it downloads.
- Brotli (`.wasm.br`, `.js.br`) where the server supports it.

## The service worker

Made by `vite-plugin-pwa` (Workbox), registered in `main.tsx`:

- Precaches the page's assets (hashed names, so a new build replaces them).
- Caches `ra2.wasm` and `ra2.js` cache-first, keyed by the build's hash in
  `build.json`. A new build is fetched in the background, and the page
  offers "update available, reload".
- Adds the COOP/COEP headers where the host doesn't.
- With `manifest.webmanifest` it makes the page installable, with its own
  window and icon, and it works offline once loaded.

It never caches anything from OPFS. The game files are already local.

## Browser support

| Needs | Chromium (Chrome, Edge) | Firefox | Safari |
|---|---|---|---|
| `SharedArrayBuffer` (cross-origin isolated) | yes | yes | yes (15.2+) |
| WebGL2 | yes | yes | yes |
| OPFS with sync access handles in workers | yes | yes | yes (17+) |
| `showDirectoryPicker` | yes | no: drag and drop | no: drag and drop |
| OffscreenCanvas with WebGL in workers | yes | yes | yes (17+) |
| Audio worklets | yes | yes | yes |
| `navigator.keyboard.lock()` | yes | no | no |
| Typical OPFS quota | a share of free disk, often tens of GB | similar | smaller and may prompt |

Chromium is the first target. Firefox and Safari are tested from stage 6,
and the Browser check screen ([frontend.md](frontend.md)) says what's missing.
Phones and tablets are out of scope: the game needs a mouse, and a 1 GB
import.
