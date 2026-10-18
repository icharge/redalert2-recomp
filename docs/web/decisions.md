# Decisions

Each decision so far, why it was made, and what would change it. A new
decision gets the next number. A changed decision keeps its number, and its
old text goes under "Was".

## D1. Emscripten, from the native Linux build

**Decided.** Compile the lifted C and pcrecomp's `win32hle` with Emscripten,
starting from the native Linux build, not the Windows one.

**Why.** The Linux build already runs the game with no Windows underneath,
on SDL2 and ffmpeg, which Emscripten has ports or builds of. The Windows host
is MSVC inline assembly and Direct3D 11. Emscripten is the only mature C to
wasm toolchain with pthreads, SDL2, a file system and audio worklets.

**Would change if.** Nothing likely. A WASI-only runtime would lose the
browser APIs.

## D2. Flat memory, with the image's range kept free

**Decided.** Keep `RECOMP_FLAT_MEMORY`. Link with `-sGLOBAL_BASE=16MB`
so the guest image (0x00400000 to 0x00B93000) has its range in linear memory.
Implement `VirtualAlloc` with aligned allocations ([memory.md](memory.md)).

**Why.** wasm32 pointers are 32 bits, so guest addresses are host addresses
as on 32-bit Linux. The generated C stays unchanged and fast, and the change
is a few dozen lines in pcrecomp.

**Would change if.** The game needs `VirtualAlloc` at fixed addresses
outside the image, or the image doesn't fit below `GLOBAL_BASE`. Then option
B, offset memory with `g_mem_base`.

## D3. The game on its own thread (`PROXY_TO_PTHREAD`)

**Decided.** `main()` runs on an Emscripten pthread and blocks as it does
natively. (It does not own the canvas: see D10.)

**Why.** The game's loop never returns. On a thread it doesn't have to, and
the page stays responsive.

**Would change if.** SDL2's GL or input doesn't work from a pthread and the
fallbacks (`OFFSCREEN_FRAMEBUFFER`, our own input path) don't fix it. Then
D4's fallback.

## D4. Asyncify only as the last resort

**Decided.** Don't use Asyncify unless D3 fails.

**Why.** Asyncify instruments every function that can reach a yield, and in
the lifted code that's nearly all 24,954 of them, through indirect calls.
Expect a much bigger and slower binary.

## D5. Sound through a Wasm Audio Worklet

**Decided.** The mixer in `dsound.c` fills a ring buffer in shared memory,
and a Wasm Audio Worklet plays it. SDL's audio isn't used in the browser.

**Why.** SDL2's Emscripten audio runs its callback on the main thread
(ScriptProcessorNode, deprecated), which would need the main thread to take
the game's locks.

**Would change if.** SDL gains a worklet backend that calls back on a
non-main thread.

## D6. React, TypeScript and Radix for the page

**Decided.** The page is React 18 and TypeScript, with Radix Themes and
Primitives, built with Vite ([frontend.md](frontend.md)).

**Why.** The project owner's choice. Radix gives accessible dialogs, menus,
progress and sliders without styling them from scratch, and React only runs
the screens around the game, so it costs nothing during play.

## D7. Game settings stay in the game

**Decided.** The game's F10 menu keeps resolution, scaling, HD vehicles,
controls and mods. The page's Settings has only browser-side settings.

**Why.** One copy of each setting, the same on every platform. The page
would otherwise have to mirror the host's settings and keep them in step.

**Would change if.** The F10 menu turns out hard to use in a browser (for
example with pointer lock). Even then, the page would call the host's
settings, not keep its own.

## D8. Player-supplied files only, through OPFS

**Decided.** The player imports their own install into OPFS. The site serves
no game files.

**Why.** The project's one rule. OPFS is the only browser storage that is
fast enough for random reads into 280 MB archives and large enough for
them.

## D9. Publishing `ra2.wasm`: open

**Not decided.** `ra2.wasm` is generated from `gamemd.exe`, so publishing
it falls under the rule against distributing the lifted C. Until this is
decided, the browser build is served locally by the player
([deploy.md](deploy.md)).

## D10. The game publishes frames; the page draws them

**Decided.** No SDL video in the browser. `screen.c` runs headless; the host
hooks the frame it builds, writes RGBA into shared memory, and the page draws
it on a 2D canvas each animation frame. The mouse and keys come back as calls
on exported functions, through a ring the game thread empties in its pump
([architecture.md](architecture.md), [protocol.md](protocol.md)).

**Why.** D3's loop never returns to the browser. A small SDL program built with
the game's flags showed what that does to the usual routes: with
`OFFSCREENCANVAS_SUPPORT` the EGL context is created on the main thread, which
no longer has the canvas it gave away, and with `OFFSCREEN_FRAMEBUFFER` the
context SDL makes on the game thread has no GL state, and the events the page
proxies to a thread that never yields abort. Publishing pixels needs neither,
and the page-side drawing and input are ordinary code with unit tests. It runs
at 60 frames a second in Chrome.

**Costs.** The page scales with the browser's filter, so the Linux presenter's
sharp, CRT and blurred-bars modes and the HD layer are not there yet (stage 9).
A frame is copied twice (to RGBA in wasm, into an `ImageData`), which is cheap
at these sizes.

**Would change if.** A frame budget at 4K or with HD vehicles is missed
(stage 5's measurement). Then WebGL on the page side, texture upload from the
same shared buffer.

**Was (before the first build).** The canvas transferred to the game thread as
an OffscreenCanvas, SDL's renderer on WebGL2, and SDL's DOM event handling.

## D11. The game reads OPFS through a copy into memory, not a WasmFS mount

**Decision.** At start the page copies the game's files from OPFS into Emscripten's in-memory
file system (`/game`), one file at a time, then puts back what the game saved last time and keeps
watching its writes (`web/src/storage/saves.ts`): a file the game adds or changes is written to
OPFS under `save/<game>/` within a few seconds, and when the tab is hidden. The WasmFS OPFS backend
that [storage.md](storage.md) first described is not used.

**Why.** The in-memory route is what the dev server's folder already used and it plays at full
speed; a WasmFS mount would replace the whole file layer the game and `win32hle` run on (open, read,
the memory maps the archives rely on) to save memory, and it can be done later without changing the
import or the manifest. The copy from OPFS takes a few seconds for 1 GB.

**Costs.** The game's files are in memory twice at most for one file at a time, and then once: about
1 GB for Yuri's Revenge. A phone or a small machine may not have it. A save made in the last couple of
seconds before the tab is killed can be lost (a hidden tab flushes first).

**Would change if.** Memory is the limit on real machines (then WasmFS reads the archives on demand), or
the game needs a file layer feature the in-memory one lacks.

**Also found.** The game stops at start ("Failed to initialize") if `MOVMD03.MIX` is missing, though it
takes an empty archive in its place: the import writes a 12-byte empty one for each movie archive the
player leaves out. And it needs `Blowfish.dll` in its folder (the host reads the archive key from it),
so the import copies it and refuses a folder without one.
