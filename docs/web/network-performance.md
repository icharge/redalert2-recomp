# Network performance: command delay and transports

What costs latency in a browser WOL match, what is irreducible, and which
changes are worth making. Measured on the loopback RA2Web server; the numbers
are the ones the game itself logs.

## Measured baseline

| Run | max ping | Precalc MaxAhead | MaxAhead | frames | late / moved / out-of-sync |
|---|---|---|---|---|---|
| `work/wol-latency-loop6` (loopback relay) | 17 ms | 4 | 4 (held) | 7008 / 7016 | 0 / 0 / 0 |
| `work/wol-latency-slow3` (40 ms each way through the relay) | 17 ms | 4 | 4 (held) | 680 / 688 | 0 / 0 / 0 |
| `work/wol-latency-yr-1104` (40 ms each way, YR) | 17 ms | 4 | 4 (held) | 1728 / 1734 | 0 / 0 / 0 |
| `work/wol-latency-ra2-1104` (40 ms each way, RA2) | 17 ms | 4 | 4 (held) | 1820 / 1836 | 0 / 0 / 0 |

At 60 fps, `MaxAhead` 4 is the command delay the player feels: **66.7 ms**.
The game's own `Response time` lines in the same runs were 9–10 ms.

## Eight-human WOL capacity check (2026-11-11)

The published Yuri's Revenge build does **not** currently admit eight human
WOL clients through the native Custom Match screen. Six clients joined Death
trap (2–8); the seventh saw `woltst1's_game 6/6` with Join disabled and sent no
`joingame` request. This is a capacity blocker before gameplay, not evidence
of an eight-peer transport or performance failure.

The map picker showed eight start positions and outgoing GAMEOPT specified
eight map slots (`XDeath.MAP`). Nevertheless, the host sent `MODE +l6` and
`WOLAPI2:0,1,6,0`. Rows seven and eight were Closed; their dropdown offered
Closed and AI difficulties, with no Open choice. The native setup routine
at YR `0x005EB060` uses six as the normal WOL/session-mode-4 human cutoff;
the Open entry is omitted beyond that bound near `0x005EB4AA`. Map capacity, advertised room capacity and current player count are
separate fields. This test did not establish that the server/bridge supplies
those fields correctly, so the observed six-slot UI branch does not prove
that eight humans are inherently unsupported. The create request supplied
7, the selected map supplied 8 slots, and the subsequent room metadata
supplied 6. The user identified incorrect server slot/player reporting as
the suspected cause; tracing these values into the native callbacks is the
next check. No limit patch or forged eight-player STARTG was used.

Environment: dirty working tree based on `292930fa`, existing published YR
build ID `585dcbc90af6034a`, Wasm SHA-256
`9e7ab7e8cdbc5923975380de5e9454779cf0db5850b18c99e589333fb7ee7837`;
RA2Web server revision `02b934d157f32984494336e22f26978f2ebff653`, in-memory
storage on loopback port 9090. No game compilation ran. Chrome 156 on a
Ryzen 5 7600X (12 logical processors), approximately 31.2 GiB physical RAM.
Other desktop workloads were running, so process measurements describe
this local concurrency test rather than a dedicated-machine benchmark.

The task fixture supplies 12-byte empty `movmd03.mix` and `movies01.mix`
through `serveGame` overrides, following the normal importer's movie-stub
convention. Without those missing archives, the development folder exits
during initialization with "Failed to initialize. Please reinstall." before
any WOL login. The source installation is unchanged. The fixture copies
content into each client's memory; its memory costs include that staging
and do not represent an OPFS installation's footprint.

Reproduction and the small retained evidence are described in
[`work/tasks/wol-eight/README.md`](../../work/tasks/wol-eight/README.md).
The regular `web/e2e/wol.mjs` still supports only two or three clients.
The task runner generalizes the real UI login/join/start flow and accepts
`WOL_PLAYERS=8` for the capacity attempt or `WOL_PLAYERS=6` for gameplay at
the observed limit. Base RA2, internet links, long matches and busy late-game
battles were not established by this capacity check.

### Six-client observations and test limitations

At the supported human limit, all six native clients received the same
authenticated STARTG handoff, negotiated the scenario, passed frame 300,
and ran for approximately five minutes. Every client logged five FRAMESYNC
receives and five distinct remote destinations, exercising all 15 peer
pairs. The logs contained no scenario-negotiation failure, late-packet
warning, moved-event warning, sync-file write, desync/reconnection dialog,
browser error or runtime crash. A same-instant collection of the six log
tails was within four frames; the final per-client dumps were sequential
and must not be interpreted as a simultaneous drift measurement.

These are instrumented observations, **not a passed performance or visual
playability benchmark**:

| Observation | Result |
|---|---|
| Positive match FPS reports | 291–293 per client; median 30 FPS each, mean about 28.4 FPS |
| Low FPS tail | Fifth percentile 16–18 FPS, depending on client |
| Largest reported frame gap | 828–977 ms across the six clients |
| Game timing | MaxAhead settled at 4, sending every 2 frames |
| Task process working set | About 15.05 GiB median during input/gameplay; 16.92 GiB peak including setup |
| Task private committed memory | 16.04 GiB peak including setup |
| CPU use during input/gameplay | Median 8.76 logical cores, approximately 73% of this 12-thread CPU |

The FPS/gap figures come from the game's own positive `@ra2 fps` events;
zero/menu reports are excluded. OS figures cover the test Node process and
its Chrome descendants, not the WOL/Vite servers or unrelated workloads.
Process memory is not a Wasm-heap growth measurement. The snapshots use the
800×600 game mode with a 1280×960 page viewport, HD vehicles off, initial
game speed 5 and ten starting units. This is a light setup, not a busy battle.

**Visual limitation:** the final host and guest screenshots show a black
battlefield/shroud with the sidebar and 10,000 credits still drawn. Advancing
simulation frames alone do not establish correct rendering or playable
unit interaction. A retained screenshot is in the evidence directory.
[The native testing guide](../testing.md) and [bring-up notes](../bringup.md)
describe a prior automation edge-scroll problem that moved the camera into
the black map margin. That is a hypothesis for this case, not its diagnosed
cause. The next discriminating check is to center the pointer/camera before
orders and capture non-black battlefield frames both before and after them.

**Automation limitation:** the temporary runner issued Q, D and left-click
inputs sequentially. The first two client input sequences took approximately
92 and 105 seconds to return. Those times are automation API completion
times, not measured in-game command latency. They exhausted the 120-second
sampling window before the first structured sample, and the runner exited
1 with a `TypeError` reading the missing last sample. The log/OS summaries
above remain observable evidence; there is no successful `metrics.json`
benchmark or memory-soak result. The retained runner now starts its sampling
window after the input phase and captures a pre-input screenshot, but that
adjustment received syntax validation only, not another game run. The
underlying input delay remains unexplained.

Useful follow-up: verify and correct server/bridge slot and player-count
reporting before deciding whether any native capacity change is needed,
resolve the black-view/input-fixture case, then repeat an eight-client test
with bounded input actions, visual assertions and reliable live sampling.
Raw captures were summarized, but automatic approval review rejected task-only
cleanup with "blocked by policy", including a narrower file-only deletion
attempt. Approximately 105 MiB of task captures and the compact evidence remain
under the linked task README, with ownership and cleanup instructions. The
task's WOL/Vite servers stopped; no game/runtime behavior was changed.

## Where the delay goes

| Component | Cost | Where |
|---|---|---|
| Send batching (`FrameSendRate`) | 0–33 ms (avg ~16.7) | the game waits up to 2 frames before its next packet |
| One-way path | ~8.5 ms at 17 ms ping | browser → relay server → peer |
| Jitter/loss margin | 1 frame + slack | the `+1` in `ra2_net_tuning_choose` |
| Inbound read | 0–16.7 ms | the game reads datagrams in its frame pump (`WSAAsyncSelect` → `hle_ws_poll`) |
| Worker → page hop | ~0.1–1 ms normally | `MAIN_THREAD_ASYNC_EM_ASM` → `UdpRelay.pump()` |

The HLE is not the bottleneck: a datagram is copied two or three times (game
buffer → `g_wudp_tx` → `ra2_udp_packet` → `heap.slice`), which is microseconds.
`hle_ws_udp_on_queue` → `ra2_udp_wake` → `pump()` already sends as soon as the
game queues a datagram, and the server's `NativeRelay` forwards without
buffering or timers.

## The lockstep floor

The game is lockstep: a command issued at frame N executes at N + `MaxAhead`
on every peer. The minimum is therefore **one-way latency + one frame of
quantization** — about 25 ms on a 17 ms path. Zero delay would require
prediction/rollback in the simulation, which the retail engine does not have.
Realistic targets:

| Path RTT | Achievable MaxAhead | Delay |
|---|---|---|
| 17 ms | 3 (send every frame) | 50 ms |
| 17 ms, clean | 2 | 33 ms |
| 40 ms | 3–4 | 50–66 ms |
| 100 ms | 6–7 | 100–117 ms |

## The lockstep rule for any tuning

`Session.MaxAhead` and `Session.FrameSendRate` are part of the lockstep
state. When a TIMING event executes (on the same frame for every player), its
handler (RA2 `0x004B7856`) compares the event's values with the live ones.
If they differ, it opens a window, and any order later queued for a frame
inside it is moved to the window's end ("DoList: Moving event from frame A to
frame B"). A player whose live values differ from another's for even one frame
moves orders the other does not, and the match ends out of sync (`SYNC0.TXT`,
dialog `0xCE`, the reconnection screen).

So a change to either value must travel **in the host's timing event**, never
be written into one player's memory. `net_tuning.c` follows this since
2026-11-09: `run_lift.py net_timing_event_patches` puts the profile into the
precalculated event and every `Generate_Real_Timing_Event`, and the module
writes no live value. An earlier version held the live values from each
player's frame pump; two browser tabs with `--play` orders reproduced the
desync within ten seconds, and `--classic-latency` (stock 30 frames) did not.
The same rule applies to every item below that changes the delay or the send
rate: the host decides, and its timing event carries the decision.

A second rule: MaxAhead must be a **multiple of FrameSendRate**.
`Generate_Real_Timing_Event` rounds its own value up to one (RA2
`0x00624296`). A tuned MaxAhead of 5 with a send every 2 frames desynchronised
a two-tab match at frame ~256 with no orders given; 4 and 6 do not.
`ra2_net_tuning_choose` rounds up (5 -> 6 frames, 100 ms), and the late-packet
ladder steps by the send rate.

## Improvements to the game's own transport

Ranked by impact per unit of risk. None changes the simulation.

1. **Send every frame.** `FrameSendRate` 2 → 1 removes up to 16.7 ms of
   batching; packets are 28–120 bytes, so ~60 pps is negligible traffic.
   `src/web/net_tuning.c` (`send_rate_for`, `SEND_RATE_FAST`).
2. **Size `MaxAhead` from measured jitter, not a fixed `+1`.** Track
   inter-arrival time and gaps at `ra2_udp_push` and use a p99:
   `send + ceil((one_way + jitter_p99) / frame) + 1`. The existing ladder
   (`bump`) stays as a safety net but should rarely fire.
3. **Measure the peer path, not the WOL server.** `max_ping()` reads the
   WOLAPI ping array, which is the client↔server round trip; the relay path is
   client↔server↔peer. The 40 ms-delay runs prove the gap: the real path was
   ~97 ms RTT while the tuning still saw 17 ms. The server knows each client's
   ping, so it can pass both peers' pings in the STARTG handoff (or the relay's
   `ok` line).
4. **Make loss cheap.** Duplicate each outbound datagram ~10 ms apart and let
   the peer drop the repeat (UDP already permits duplicates), or XOR parity
   over small groups. At these packet sizes the bandwidth is trivial, and it
   removes the retransmit-style stalls that make the ladder raise `MaxAhead`
   permanently. Verify first that the lifted receive path ignores repeated
   frames (packet sequence compare in `src/recomp/gen/`).
5. **Keep routing direct.** `ra2_wolapi_set_no_router_flag` already keeps the
   game from spawning `mph.exe`, so every player talks to every other directly.

Not possible without a netcode rewrite: zero delay, prediction, a higher tick
rate (the engine's logic is frame-based, so 60 fps is the speed).

## Browser transports

A page has no raw UDP socket. The options, for 28–1500-byte datagrams at
30–60 per second:

| Transport | Path | Loss behavior | Extra RTT | Needs |
|---|---|---|---|---|
| **WebRTC DataChannel** (`ordered:false, maxRetransmits:0`) | browser ↔ browser direct | no retransmit | **0** | signaling + STUN; TURN for hard NATs |
| WebTransport (QUIC datagrams) | browser ↔ server ↔ peer | no retransmit | 1 hop | an HTTP/3 server (Bun has none) |
| WebSocket (today) | browser ↔ server ↔ peer | TCP head-of-line blocking | 1 hop | none |
| WS↔UDP gateway (vera20k) | browser ↔ gateway ↔ UDP peer | none on the UDP leg | 1 hop | a gateway; mainly for native interop |

The two costs that matter are the relay hop and TCP head-of-line blocking on
loss. WebRTC removes both: the datagrams go straight to the peer and a lost
one is simply lost, like the game's UDP. `web/src/game/lan.ts` already opens a
channel with the right options; only the signaling is manual there. For WOL,
the server can carry offer/answer/ICE keyed by `gameId` + nick, inside the
loading screen, with a ~2–3 s timeout and silent fallback to the WebSocket
relay.

A WS↔UDP gateway (the approach in vera20k's `tools/wasm/gateway`) is the right
tool for browser↔native matches: one WebSocket, one connected UDP socket per
client, one message per unchanged datagram, drops instead of retries. It does
not help browser↔browser, where the far end is another WebSocket.

## Prior art: vera20k's relay

vera20k (a separate Rust reimplementation, `C:\Users\Norrapat\projects\vera20k`)
runs online matches through a relay that owns the match clock and one immutable
command stream: clients submit command batches, the relay seals frames, and a
per-link adaptation layer decides how much redundancy each hop gets. That
ordering model cannot be copied into a recompiled game, but its measurement and
adaptation layers sit outside the simulation and map onto what we control.

| Mechanism | vera20k | Numbers |
|---|---|---|
| Link estimate | `services/relay-protocol/src/link/measure.rs` | srtt, rttvar, reorder window, loss with hysteresis: lossy at ≥5‰, severe at ≥150‰, exit at 2‰ or 20 s quiet |
| Retransmit timers | same | RTO 48–1000 ms, PTO 50–1000 ms |
| Adaptive redundancy | `link/uplink.rs` | lossy link: 16 ms uplink copies, 8 ms downlink repeats; none when congested; probe only when silent |
| Adaptive playout | `src/app/match_runtime/frame_pacer.rs` | reserve at most 20 ms or one frame; an early receipt moves the origin earlier |
| One-human match | `docs/Networking.md` | no lead-time buffer at all |
| Reconnect | relay journal | identity kept, replay from sequence 1, 10-minute silence limit |
| Slow player | relay | seal at ≤90 % of the slowest player's rate, never below 30 fps, at least 5 s between changes |
| Quality report | `match-ended` event | `command_round_trip_ms`, `max_jitter_reserve_ms`, `underruns`, `gaps`, `reconnects` |

**Adoptable here** (outside the simulation):

1. The link estimate drives `MaxAhead`: srtt + rttvar, loss with hysteresis,
   inter-arrival jitter measured at `ra2_udp_push`. Size the buffer to a p99
   instead of the fixed `+1`, and keep the late-packet ladder as the backstop.
2. Adaptive redundancy: when the measured loss crosses the lossy band, send
   each game datagram twice 16 ms apart (the game already tolerates duplicate
   UDP datagrams); stop when the link is clean.
3. A bounded journal in our relay so a suspended tab or a dropped WebSocket
   reads from its last sequence and rejoins, instead of dying. Their relay
   keeps one; ours is stateless today.
4. The one-human rule: a WOL match with one human (co-op against AI) has no
   peer to wait for, so it can run at `MaxAhead` 1–2.
5. Their quality-report fields in our `?udptrace`/log.

**Not adoptable** without replacing the netcode:

- Relay-ordered command stream. The game expects peer frame packets and orders
  them itself; we would have to synthesize every peer's stream in the HLE.
- Deterministic catch-up/rollback. The game exposes no per-frame snapshot and
  restore, so a client cannot replay to catch up mid-match.
- Relay-driven speed control. Changing the seal rate changes the game speed
  players see; the retail game already slows to its slowest player.
- The 13-byte envelope and per-hop HMAC. Our game packets are already small
  and the relay is trusted.

## Instrumentation

Before changing the buffer, measure the split. `?udptrace` already logs the
relay's traffic. Add monotonic timestamps at:

1. HLE enqueue (`wudp_send`),
2. page pump send (`UdpRelay.pump`),
3. server receive (`NativeRelay.handleDatagram`),
4. peer receive,
5. HLE push (`hle_ws_udp_push`),
6. game read (`hle_ws_poll`).

Report percentiles, not just maxima, and include what vera20k reports for its
relay matches: `command_round_trip_ms` (mean/max/samples), `max_jitter_reserve_ms`,
`underruns`, `gaps`, and `reconnects`. That turns "the ladder bumped" into a
measured decision about the buffer size.

## Roadmap

1. `FrameSendRate` 1 and a 3-frame start (immediate, ~16 ms).
2. Jitter-aware `MaxAhead` in `net_tuning.c`, driven by the srtt/rttvar/loss
   estimate described above.
3. Peer-path RTT from the server's per-client pings.
4. Datagram duplication at the HLE/relay while the link is lossy.
5. A bounded relay journal and reconnect/catch-up for suspended tabs.
6. The one-human no-buffer rule.
7. WebRTC DataChannel behind the existing `UdpRelay` interface, with the
   WebSocket relay as fallback; a WS↔UDP gateway only for native interop.

Steps 1–6 improve any transport; step 7 removes the browser-leg hop and the
TCP loss penalty.
