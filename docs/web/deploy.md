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
