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
2. Jitter-aware `MaxAhead` in `net_tuning.c`.
3. Peer-path RTT from the server's per-client pings.
4. Datagram duplication at the HLE/relay.
5. WebRTC DataChannel behind the existing `UdpRelay` interface, with the
   WebSocket relay as fallback; a WS↔UDP gateway only for native interop.

Steps 1–4 improve any transport; step 5 removes the browser-leg hop and the
TCP loss penalty.
