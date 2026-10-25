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

## D11. The game reads big files in place from OPFS through a WasmFS mount

**Decision.** The page builds the game's folder (`/game`) in WasmFS's in-memory file system, as
links: a file of 1 MiB or more is a symbolic link to its copy in OPFS, which the game's thread
mounts at `/opfs` (`wasmfs_create_opfs_backend` in `src/web/main.c`), and the game reads it in
place. Smaller files (settings, string tables, the game's own ini) are copied into memory, because
the page edits some of them and the game reads them over and over. Then the page puts back what the
game saved last time and keeps watching its writes (`web/src/storage/saves.ts`): a file the game adds
or changes is written to OPFS under `save/<game>/` within a few seconds, and when the tab is hidden.

**Why.** The browser has to stay under about 1 GiB for the whole game. The first design copied the
whole install into memory (about 1.09 GB of JS heap for Yuri's Revenge), which could not. A spike
(docs/web/handoff-zerocopy.md) linked 987 MB of it and kept the JS heap near 19 MB. The page cannot
mount OPFS itself, so `main()` does it on the game thread, and the files are linked from the page
before `main()` runs: the module starts with `noInitialRun`, the runtime comes up, the page links and
copies the files, then calls `callMain`.

**How reads work.** `src/web/opfs_read.js` replaces the read half of WasmFS's OPFS backend. A file
opened for reading takes a read-only sync access handle (Chrome's `mode: 'read-only'` takes a
shared lock, so the same archive opens any number of times), so a `read()` is a plain call. Where the
browser has no such mode, or another handle holds the file for writing, the file is read as a Blob
through an 8 MB block cache (256 KB blocks). The stock backend does one promise and one copy per read.
Two more pieces keep start-up short. `src/web/read_cache.c` shims `ReadFile` and serves the many small
repeated reads from 1 MiB blocks held in wasm memory, so they are not a proxied round trip each (about
0.2 ms). And a read-only handle is kept open after the last close and reused by the next open of the
file (up to 24 idle ones): the game opens and closes the same archive several hundred times while it
starts, at about 4 ms for each `createSyncAccessHandle`.

**Measured** (Chrome 152, a real 1,073 MB Yuri's Revenge install, 256 MB initial and 768 MB maximum
linear memory, warm reloads, page time to the menu): files ready in about 0.3 s, JS heap 17 MB, wasm
memory 256 MB at the menu and 307 MB in a skirmish. The copy it replaces took 1.5 to 1.9 s for the
files, reached the menu at about 20 s and held 1.09 GB of JS heap. Menu time, in steps:

| | menu |
|---|---|
| mounted, stock reads, `-O1` | 24 to 26 s |
| + start-up movie and splash wait skipped, read cache, `-O1` | 7.1 to 7.7 s |
| + handle pool, `-O1` | 3.5 to 6.4 s (median about 4.7 s) |
| + handle pool, release `-O3` | 3.4 s (five reloads: 3.39 to 3.46 s; 4.0 s right after a fresh import) |
| same, Red Alert 2, release `-O3` | 2.35 to 2.63 s (five reloads); 11 s on the first load of the new wasm |

Where the 3.4 s goes: the wasm arrives and is up in about 1 s, the start-up movie is skipped at 1.2 s,
the file scan runs to about 2.5 s, the menu opens shortly after. The first load of a newly built
`-O3` wasm is slower (11 s for Red Alert 2 with the pane in front; the 124 MB module is compiled that
once, and the next loads use the cached code). A headless Node run with `--memfs` copies 8 MB and links 1,085 MB and reaches the menu in 2.6 s.

**Costs.** The game's thread now reads through the browser's file API: a first read of a file not yet
in the browser's cache is slower than memory. WasmFS has no NODEFS and a different `FS` surface (no
`isDir`, times in seconds, `readdir` fails on OPFS directories, so files are linked by name from the
manifest). Anything that writes a path in `/game` must first remove a link, or it would change the
imported file (`replaceFile` in `saves.ts`). A dev-server folder (`dev-folder`, `test-folder`) is still
copied into memory whole: use a folder that fits (the build caps linear memory at 768 MB). A save made
in the last couple of seconds before the tab is killed can be lost (a hidden tab flushes first).

**Also costs.** An idle read-only handle holds a shared lock, so a write to that file from another tab
fails while the game page is open (the game page is the only one that opens them; saves and the files
the page writes are copied, not linked).

**Would change if.** A browser without read-only sync handles is the common case (then the Blob path
and its cache need a measure), or the game needs a file layer feature WasmFS lacks.

**Also found.** The game stops at start ("Failed to initialize") if `MOVMD03.MIX` is missing, though it
takes an empty archive in its place: the import writes a 12-byte empty one for each movie archive the
player leaves out. The host also needs `Blowfish.dll` to initialize archive decryption. Stage 14
supersedes the earlier choice below: the local web build now bundles its matching executable and
`Blowfish.dll`, and the player imports game content only. These derived files remain local and are
not committed or published.

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
[`host.c`](../../src/runtime/host.c)). Stage 14 bundles `Blowfish.dll` with the local runtime; it
remains separate from implementing the browser lobby client.

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
