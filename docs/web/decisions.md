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

**Decided.** The mixer in `dsound.c` runs on a thread of its own and fills a
ring buffer in shared memory, and an audio worklet plays it. SDL's audio isn't
used in the browser. The worklet is a short JavaScript file reading the ring
with `Atomics`, not a Wasm Audio Worklet (`-sAUDIO_WORKLET`): it needs no
code from the game, so the build keeps its flags and nothing in the worklet
can fault.

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

## D12. Preserve the in-game WOL menu with a browser-side compatibility layer

**Decided.** Keep the WOL service endpoint configurable. A self-hosted
[PvPGN-PRO](https://github.com/pvpgn/pvpgn-server) instance is a supported server-side option and the
first compatibility target for W13. It advertises Westwood Online support and lists RA2 1.006 and
Yuri's Revenge 1.001 among its supported clients. The same gateway may be configured for another
WOL-compatible service, such as XWIS, if it is reachable and passes compatibility testing. The
workspace's sibling `ra2web/server` is another candidate: it already exposes a WOL-style lobby over
WebSocket, but its wire/auth flow is tailored to RA2Web and needs an adapter/compatibility check before
this project can use it. Do not depend on the original Westwood servers or hard-code a public service
as a runtime dependency.

Preserve the original in-game Online menu. Implement the `IChat`/WOLAPI COM surface that the game
actually calls as a compatibility object in the web host/Win32 emulation, then bridge its asynchronous
requests and callbacks to browser WebSocket code. Do not require or load a recovered Windows
`WOLAPI.DLL` in the browser, and do not implement unused API methods without evidence the game calls
them. Connect directly by WSS to a browser-ready service such as `ra2web/server`, or use a
same-origin/configured **WSS gateway** for a legacy TCP service such as PvPGN-PRO. The gateway must
only connect to the configured service, not act as an arbitrary TCP proxy. Keep WOL lobby/session
signaling separate from gameplay packets. Carry this game's IPX datagrams between peers using WebRTC
data channels. W12's one-to-one LAN setup remains manual offer/answer as recorded in D13; W13 adds
lobby-correlated signaling and may use STUN/TURN for internet connectivity. Do not use the peer IP
addresses announced by WOL as browser UDP destinations.

**Do not conflate the DLLs.** The current host's registration-free COM support is for `Blowfish.dll`,
the game's WOL cipher, not `WOLAPI.dll` ([bring-up note](../bringup.md#2-the-string-manager-box-is-really-a-com-check),
[`host.c`](../../src/runtime/host.c)). Keep the player-supplied `Blowfish.dll` requirement; it is
separate from implementing the browser lobby client.

**Required WOL surface.** The reverse-engineered [`IChat` interface](https://github.com/hifi-unmaintained/wolapi/blob/master/inc/IChat.h)
exposes server discovery/connection, channel and user lists, channel create/join/leave, chat, game
options, and game start/end calls. The [implementation](https://github.com/hifi-unmaintained/wolapi/blob/master/src/IChat.c)
shows the corresponding IRC-like TCP commands. The minimum browser flow is: select a game/server and
authenticate/version-check; list and join a lobby; list, create, or join a game channel; exchange room
roster, topic, and game options; start the session and consume its start event; then leave/logout.
Retain enough room identity to correlate peers and exchange WebRTC offer/answer and ICE candidates.
The original WOL game-server protocol describes `STARTG` as the coordination step and says the match
is played between clients, not carried by the lobby server ([protocol notes](https://medium.com/sean3z/xwis-wol-game-server-protocol-b2a3457bd06));
the packet formats there are for Tiberian Sun, so treat them as guidance, not an RA2 wire specification.
The sibling `ra2web/server` authenticates with an HTTP-issued session token and has a `/gserv` endpoint,
but its RA2Web `GservConnection` (`ra2web/src/network/GservConnection.ts`) relays turn-action frames;
that endpoint is not a drop-in transport for this project's IPX datagrams.

**Why.** PvPGN-PRO is an open-source, self-hostable WOL server option that explicitly targets the
legacy clients this project needs ([supported clients](https://github.com/pvpgn/pvpgn-server#supported-clients));
using it for the initial compatibility target gives W13.2 a service whose configuration and
availability we control, while keeping the gateway independent of that specific server. The existing
reverse-engineered WOLAPI project describes itself as a partial implementation for Red Alert 3.03, so
use its interfaces and implementation as evidence for the API shape, not as a drop-in RA2/YR client.
Browsers cannot open arbitrary TCP or UDP sockets: [Emscripten's networking guide](https://emscripten.org/docs/porting/networking.html)
documents WebSockets and states that direct UDP is unavailable and it has no C/C++ WebRTC API. A
WebSocket gateway is therefore needed for the legacy TCP lobby; WebRTC data channels provide the
separate UDP-like peer path ([RFC 8831](https://www.rfc-editor.org/rfc/rfc8831)).

**Costs and verification still needed.** The gateway and WebRTC bridge are additional services/code;
WebRTC may need TURN when direct ICE connectivity fails, and multi-player IPX broadcast must be fanned
out to every peer. Public material confirms service/client compatibility but does not prove a browser
client can complete an RA2/YR match. Before W13.2 is considered complete, verify login/version checks,
lobby listing, room create/join, roster/options, and start events against the selected PvPGN-PRO build;
then verify packet delivery and a full match across separate networks, including a TURN-relayed case.
The exact RA2/YR command fields, authentication requirements, and peer mapping remain integration-test
questions.

## D13. Browser LAN play: one peer over WebRTC, manual SDP exchange

**Decided.** Stage 12 is one-to-one browser LAN play. IPX datagrams use an
unreliable, unordered WebRTC data channel. Players pair by copying an offer
and answer between the two browser clients; no signaling server, STUN/TURN
service, WOLAPI, or original Westwood Online service is required for this
stage. The game continues to use its IPX lobby and lockstep protocol.

**Why.** Browsers cannot open UDP sockets. WebRTC carries the datagrams
without changing the game's protocol, and manual SDP exchange avoids adding
an always-on service just to pair two LAN peers. Restricting the first cut to
two peers keeps IPX broadcast behavior well-defined: a broadcast reaches the
one connected peer.

**Costs.** Players must exchange potentially long SDP text, and connectivity
depends on the browser's ICE host-candidate support and LAN policy. This is
not a guarantee of connectivity across NAT or the public internet; there is
no relay fallback in W12. Offer/answer text should only be shared with the
intended peer.

**Would change if.** LAN testing shows manual exchange is too cumbersome or
host-candidate connectivity is insufficient. Then add a separately operated
signaling service or ICE configuration without changing the IPX data-channel
contract. Internet lobby/session support remains Stage 13.
