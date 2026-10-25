# Web Wasm Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship precompressed WebAssembly for local web builds and serve Brotli first, gzip second, and the original Wasm when compression is unavailable.

**Architecture:** The Emscripten post-build step writes edition-specific JS, Wasm, data, and compressed sidecars into one flat served directory. RA2 keeps `ra2.*`; Yuri uses `ra2md.*`. The loader maps Emscripten's default Wasm/data names for Yuri. A Vite middleware negotiates encoding for both dev and preview. Add a static Nginx deployment example for local builds, while documenting that the current RA2Web Nginx reverse proxy is for API traffic.

**Tech Stack:** CMake, Node.js built-in `node:zlib`, Vite middleware, Workbox service worker, Nginx.

**Spec:** User request in this thread: adopt Brotli first, then gzip or uncompressed fallback; include server deployment guidance. Existing constraints: `docs/web/deploy.md` and `CONTRIBUTING.md` prohibit publishing generated game artifacts publicly.

## Global Constraints

- Keep both modules directly under `/game/`: `/game/ra2.wasm` and `/game/ra2md.wasm`.
- Use matching `.wasm.br` and `.wasm.gz` sidecar suffixes beside each original module, so static servers find them from the original URL.
- Negotiate Brotli first, gzip second, and identity last; never select an encoding the request explicitly marks `q=0`.
- Send `Content-Type: application/wasm`, correct `Content-Encoding`, and `Vary: Accept-Encoding` for negotiated responses.
- Keep generated `.wasm`, `.br`, and `.gz` artifacts in ignored build output; do not publish them as public game-derived artifacts.
- Preserve current `build.json` hashing of the uncompressed JS, Wasm, and data files.

## Files and Responsibilities

- Create `tools/compress-wasm.mjs`: deterministic sidecar generation for a Wasm input and explicit output basenames.
- Create `tools/test_compress_wasm.mjs`: tests compressor output names, integrity, and round trips.
- Modify `CMakeLists.txt`: copy edition-specific JS, Wasm, and data names into the flat served directory, then compress before publishing `build.json`.
- Modify `cmake/build_json.cmake` and `web/src/game/loader.ts`: publish/select `ra2md.*` for Yuri and `ra2.*` for RA2, mapping Emscripten's default Yuri asset names through `locateFile`.
- Update service-worker build-asset matching and the offline check for both flat edition bundles.
- Create `web/src/wasm-encoding.ts`: pure `Accept-Encoding` negotiation helper.
- Create `web/src/wasm-encoding.test.ts`: negotiation precedence and quality-value tests.
- Create `web/vite.precompressed-wasm.ts`: shared Vite dev/preview middleware serving selected sidecars at the original Wasm URL.
- Modify `web/vite.config.ts`: register the middleware plugin for dev and preview.
- Add an in-process HTTP middleware integration check under `web/`; exercise both Vite hooks and the service-worker cache path where browser tooling permits.
- Modify `docs/web/deploy.md`: document sidecars, required response headers, production static hosting, and the Nginx example.

## Review Focus

- Missing compressed sidecar: serve the original Wasm unchanged.
- `Accept-Encoding` quality values: honor `q=0`; use Brotli before gzip when both are acceptable.
- Edition paths: RA2 and Yuri modules share one directory and use distinct basenames; sidecars must stay paired with their own original Wasm.
- Service-worker caching: compressed network delivery must still work online and after the response is cached for offline use.
- Public deployment policy: Nginx instructions must not cause generated game modules to be copied into a public app deployment.

---

### Task 1: Generate precompressed sidecars from the successful web build

**Files:**

- Create: `tools/compress-wasm.mjs`
- Create: `tools/test_compress_wasm.mjs`
- Modify: `CMakeLists.txt` (Emscripten post-build commands only)

**Interfaces:**

- CLI: `node tools/compress-wasm.mjs <input.wasm> <brotli-output> <gzip-output>`; exit nonzero without leaving partial outputs.
- Brotli uses quality 9; gzip uses level 9. The original Wasm stays in place.
- RA2 writes `ra2.wasm.br/.gz`; Yuri writes `ra2md.wasm.br/.gz`, both directly under the served game directory.

- [x] Write tests proving both named sidecars decompress byte-for-byte to the input and a failed input produces no partial output.
- [x] Run `node --test tools/test_compress_wasm.mjs`; verified it passes after implementation.
- [x] Implement the CLI with Node's built-in `node:zlib`; encode both sidecars before writing and restore previous outputs if a write fails.
- [x] Add the post-build invocation after the target's files are copied to `${_module_out}` and before the `build.json` publisher runs.
- [x] Run the compressor tests and configure both project Emscripten output layouts; generated Ninja commands reference the right sidecar paths, and compression/round trips succeeded on both existing Wasm outputs. A minimal Emscripten link stalled even for a tiny C fixture, so a fresh linked fixture was not available.

### Task 2: Negotiate Brotli, gzip, and identity in Vite

**Files:**

- Create: `web/src/wasm-encoding.ts`
- Create: `web/src/wasm-encoding.test.ts`
- Create: `web/vite.precompressed-wasm.ts`
- Modify: `web/vite.config.ts`

**Interfaces:**

- `chooseWasmEncoding(acceptEncoding: string | null, available: { br: boolean; gzip: boolean; identity?: boolean }): "br" | "gzip" | "identity" | null` parses encoding tokens and q-values, chooses the highest-quality acceptable available representation, breaks equal-quality ties Brotli then gzip then identity, and returns null when the request excludes every representation.
- Middleware handles GET and HEAD only for `/game/ra2.wasm` and `/game/ra2md.wasm`, strips the configured Vite base safely, and does not intercept other assets.
- Each URL maps to its matching `.wasm.br` / `.wasm.gz` sidecars in the shared module directory.
- Compressed responses retain `Content-Type: application/wasm`, set `Content-Encoding` to `br` or `gzip`, set `Vary: Accept-Encoding`, and use the selected sidecar's `Content-Length`. Identity responses preserve ordinary static-file behavior.

- [x] Write negotiation tests for Brotli preference, gzip fallback, identity fallback, wildcard acceptance, q-value ranking, and explicit `q=0` rejection including 406 when all representations are excluded.
- [x] Implement the negotiation helper and the Vite middleware for both `configureServer` and `configurePreviewServer`.
- [x] Add the plugin to `vite.config.ts` without changing the loader's `.wasm` URL or `instantiateStreaming` behavior.
- [x] Run focused tests and TypeScript checks; after the flat filename update, rerun loader, middleware, and service-worker tests.

### Task 3: Verify HTTP and service-worker behavior

**Files:**

- Create: `web/src/vite-precompressed-wasm.test.ts`
- Modify only if evidence requires: `web/src/sw.ts`, `web/src/swlogic.ts`, and related tests.

- [x] Invoke the middleware in-process with a fixture Wasm and both sidecars; assert `Accept-Encoding: br, gzip` returns Brotli headers and a body that decodes to the fixture.
- [x] Assert gzip-only requests return gzip, requests without either encoding receive identity, HEAD carries selected headers with no body, unsupported encodings receive 406, and missing sidecars fall back to identity.
- [x] Verify both Vite hook registrations and exercise root and `/emu/` base paths.
- [ ] Run the browser offline test; the sandbox denies loopback sockets (`EACCES 127.0.0.1`), so browser/service-worker network behavior remains unverified here.
- [x] Confirm `build.json` continues to hash the original module; compressed files are generated after module copy and are not inputs to its publisher.

### Task 4: Document production static hosting and Nginx deployment

**Files:**

- Modify: `docs/web/deploy.md`
- Modify: `docs/web/toolchain.md`
- Do not modify: `../ra2web/server/nginx.conf` unless that separate project is intentionally changed to host this static app.

- [x] Document the response headers and encoding negotiation contract and unchanged game URLs.
- [x] Add an Nginx static-host example with Brotli sidecar delivery, dynamic gzip fallback, identity fallback, required modules, and `nginx -t`/curl instructions. Nginx is not installed in this environment, so its syntax could not be exercised locally.
- [x] State that the existing `ra2web/server/nginx.conf` proxies the WOL API and does not serve the static app.
- [x] Reiterate that public deployment must not include generated game-derived modules under the current repository policy.

## Completion Checks

- Compressor round trips and measured sizes verified for both existing local edition outputs; generated files remain in ignored build directories.
- Vite dev and preview register middleware that returns Brotli, gzip, or identity according to request support and the defined preference order.
- Production web build and type checks pass. Middleware unit coverage exercises `/` and `/emu/`; browser offline behavior could not be checked because loopback is blocked.
- Nginx config example is documented; runtime syntax/response verification requires a server with the documented modules.
