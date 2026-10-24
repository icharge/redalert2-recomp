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

**Decided.** Prefer the workspace's sibling `ra2web/server` as the first W13 service to integrate.
It already exposes a WOL-style lobby over WebSocket, has smoke clients for login, channels, game
options, and `STARTG`, and provides browser-oriented session and ladder HTTP APIs. Reuse its lobby,
authentication, and ranking capabilities through an adapter for this project's WOLAPI compatibility
object. Its existing `gserv` carries RA2Web turn-action frames; compatibility with the original
RA2/YR WOL gameplay traffic has not been established, so do not assume it can carry those packets.

Keep the service endpoint configurable and self-hostable. PvPGN-PRO remains a useful legacy protocol
and ladder reference: its supported-client list names RA2 1.006 and Yuri's Revenge 1.001, and its WOL
handler implements the relevant commands. Treat it as a possible alternate backend only after
compatibility testing. PvPGN-PRO's own config calls WOL support experimental, and its comments conflict
about WOLv1/WOLv2 port defaults, so confirm listener behavior against the selected build. Another
WOL-compatible service, such as XWIS, may be used if it passes the same checks. Do not depend on the
original Westwood servers or hard-code a public service as a runtime dependency.

Preserve the original in-game Online menu. Implement the `IChat`/WOLAPI COM surface that the game
actually calls as a compatibility object in the web host/Win32 emulation, then bridge its asynchronous
requests and callbacks to browser WebSocket code. Do not require or load a recovered Windows
`WOLAPI.DLL` in the browser, and do not implement unused API methods without evidence the game calls
them. Connect by WSS to `ra2web/server`; use a same-origin/configured **WSS gateway** only if a legacy
TCP backend such as PvPGN-PRO is added. Any gateway must connect only to the configured service, not
act as an arbitrary TCP proxy. Keep WOL lobby/session signaling separate from gameplay packets. The
RA2 manual describes WOL as an Internet matching service, and historical troubleshooting material
describes peers communicating directly after the start handoff and lists UDP ports 1234-1237
([manual](https://gamepedia.cursecdn.com/cnc_gamepedia_en/b/b5/Red_Alert_2_-_English.pdf),
[network notes](https://planetcnc.gamespy.com/Viewef03.html?id=16&view=Guides.Detail)). This is the
Internet path, not the LAN IPX path. W12's IPX-over-WebRTC setup applies to LAN play only. Before
choosing W13's browser transport, trace the title-specific Internet socket/packet path in RA2 1.006
and YR 1.001; then determine whether to carry those game packets over WebRTC or use a protocol-aware
relay. Browsers cannot send raw UDP, and WOL-advertised peer IPs are not browser UDP destinations.

**Do not conflate the DLLs.** The current host's registration-free COM support is for `Blowfish.dll`,
the game's WOL cipher, not `WOLAPI.dll` ([bring-up note](../bringup.md#2-the-string-manager-box-is-really-a-com-check),
[`host.c`](../../src/runtime/host.c)). Keep the player-supplied `Blowfish.dll` requirement; it is
separate from implementing the browser lobby client.

**Required WOL surface.** The reverse-engineered [`IChat` interface](https://github.com/hifi-unmaintained/wolapi/blob/master/inc/IChat.h)
describes server discovery/connection, channel and user lists, channel create/join/leave, chat, game
options, and game start/end calls. Its accompanying implementation is for Red Alert 3.03, so use it
for API shape only; first trace the actual COM calls made by RA2 1.006 and YR 1.001 before fixing the
browser compatibility object's method set. PvPGN-PRO's own
[`handle_wol.cpp`](https://github.com/pvpgn/pvpgn-server/blob/master/src/bnetd/handle_wol.cpp)
confirms the relevant IRC-like commands and their server handling: `CVERS`, `VERCHK`, `APGAR`,
`SERIAL`, `LIST`, `NAMES`, `JOIN`, `JOINGAME`, `TOPIC`, `GAMEOPT`, `STARTG`, and `QUIT`. The minimum
browser flow is to select a game/server, authenticate and version-check, list and join a lobby, list,
create or join a game channel, exchange roster/topic/options, start the session and consume its start
event, then leave/logout. Retain room identity for matching the players after `STARTG`. PvPGN's handler
and the sibling `ra2web/server` both show `STARTG` as a lobby handoff; the latter's smoke clients
exercise create/join/options/start over WebSocket. The `gserv` handoff is specific to RA2Web's
turn-action frames; it is not evidence that the service accepts the original game's WOL Internet
packets.

**Ladder research.** PvPGN's RA2/YR WOL path uses a separate `ladder_update_wol` calculation for two
players: the expected-score formula uses a 400-point scale; winner gain is up to 64 points based on
the rating gap, while loser loss is capped at one tenth of the loser's current points and at the
complement of the winner's gain. Two mutual disconnect reports do not score. PvPGN first evaluates
the results submitted by all clients and chooses the most common reported outcome, then checks result
consistency before updating. This is useful evidence for legacy WOL scoring and report handling, not a
requirement to copy that formula. RA2Web already has its own season-based Elo ladder; its result
endpoint authenticates the session, matches the reported roster to the server-held game roster,
requires a ranked tournament game that finished without an out-of-sync result, applies a minimum
duration, and records each game idempotently. It still consumes a client-produced GameRes packet, so
W13 must assess what result evidence the browser server can trust before enabling ranked matches.

**Why.** RA2Web is already the project's browser-oriented online server, with WOL-style lobby and
ladder endpoints, making it a more direct integration target than introducing a legacy TCP service
and gateway. PvPGN-PRO remains useful research because it documents support for the legacy clients and
includes an established WOL ladder calculation ([ladder code](https://github.com/pvpgn/pvpgn-server/blob/master/src/bnetd/ladder.cpp),
[result handling](https://github.com/pvpgn/pvpgn-server/blob/master/src/bnetd/game.cpp)). The existing
reverse-engineered WOLAPI project describes itself as a partial implementation for Red Alert 3.03, so
use its interfaces and implementation as evidence for the API shape, not as a drop-in RA2/YR client.
Browsers cannot open arbitrary TCP or UDP sockets: [Emscripten's networking guide](https://emscripten.org/docs/porting/networking.html)
documents WebSockets and states that direct UDP is unavailable and it has no C/C++ WebRTC API. The
RA2Web lobby can serve the browser directly through WSS. If a legacy TCP backend such as PvPGN is
added, use a configured WSS gateway with bounded message sizes and protocol-aware handling; do not
expose an arbitrary TCP proxy. WebRTC data channels provide a UDP-like path
([RFC 8831](https://www.rfc-editor.org/rfc/rfc8831)), but the payload and native Internet socket
behavior must be established from RA2/YR before selecting this design. Do not infer the online payload
from W12's LAN IPX datagrams or send WOL-advertised peer IPs to browser UDP sockets.

**Costs and verification still needed.** W13 requires an adapter between the game's actual COM calls
and RA2Web's WebSocket/HTTP services. WebRTC may need TURN when direct ICE connectivity fails, and
multi-player delivery must be fanned out to every peer. Before W13.2 is considered complete, trace the
title-specific COM calls and verify login/version checks, lobby listing, room create/join,
roster/options, and start events against RA2Web. W13.3 must trace the native Internet packet path, then
verify its browser-compatible delivery and a full match across separate networks, including a relayed
case if WebRTC is selected. For ranked play, validate the GameRes report trust
boundary and compare RA2Web's current scoring rules with the lessons from PvPGN's two-player WOL
ladder. Exact RA2/YR command fields, auth requirements, and peer-to-data-channel mapping remain
integration-test questions.

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
