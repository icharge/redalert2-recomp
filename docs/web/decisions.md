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

**Decided.** Keep `RECOMP_FLAT_MEMORY`. Link with `-sGLOBAL_BASE=0x01000000`
so the guest image (0x00400000 to 0x00B93000) has its range in linear memory.
Implement `VirtualAlloc` with aligned allocations ([memory.md](memory.md)).

**Why.** wasm32 pointers are 32 bits, so guest addresses are host addresses
as on 32-bit Linux. The generated C stays unchanged and fast, and the change
is a few dozen lines in pcrecomp.

**Would change if.** The game needs `VirtualAlloc` at fixed addresses
outside the image, or the image doesn't fit below `GLOBAL_BASE`. Then option
B, offset memory with `g_mem_base`.

## D3. The game on its own thread (`PROXY_TO_PTHREAD`)

**Decided.** `main()` runs on an Emscripten pthread. It owns the canvas
through OffscreenCanvas and blocks as it does natively.

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
