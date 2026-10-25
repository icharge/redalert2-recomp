# WOL Match Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the delay between a player's order and its effect in browser WOL matches, first by giving the game real ping times, then by starting with a smaller command delay and sending datagrams without the 8 ms timer.

**Architecture:** RA2's lockstep netcode schedules each order `MaxAhead` frames ahead. Today the WOLAPI bridge reports no ping, so every match starts at the default MaxAhead (40 frames, about 0.7 s at Fastest). The RA2Web server already measures each player's round trip and puts it in NAMES/JOIN lines; the bridge will keep it, answer the game's ping calls with own + peer round trip (the relay path), and the host page will lower the starting MaxAhead from that ping. Separately, the HLE Winsock wakes the page as soon as a datagram is queued instead of waiting for the relay's poll timer.

**Tech Stack:** C (Emscripten, recompiled game + `src/web/wolapi.c` bridge), pcrecomp HLE Winsock (`runtime/win32hle/wsock32.c`), TypeScript/Vitest (`web/`), Bun (`ra2web/server`), Node e2e (`web/e2e/wol.mjs`).

**Spec:** the Findings section below (research of 2026-10-25 in this repository's WOL work; evidence in `build-web/speed-yr*/{host,guest}/game.log`).

## Findings (the spec)

1. Both clients log `Ping times not available - Using defaults`, then `PrecalcMaxAhead is 40`, `PrecalcDesiredFrameRate is 0`, `LatencyFudge is 1`, `FrameSendRate is 10`. Measured `Response time` is 0–4, yet MaxAhead stays 40 and only later steps down to 30, then 15.
2. The lobby ping string is `P2,woltst1,-1,woltst2,-1`: every ping is -1 because `m_net_get_avg_ping` (`src/web/wolapi.c:1005`) always returns `E_FAIL` with -1, and `RequestPing` (NetUtil vtable slot 6) is `m_stub_4` (`E_NOTIMPL`).
3. YR `Start_Game_Now` (0x795060–0x7951A1) takes the highest ping from the 8-entry array at 0xB7790C. A highest ping of 0 or exactly 1000 means "not available". Below 600 ms it sets latency level 1, above 1000 ms level 2. It also feeds `ping * 60 / 1000` frames into `IPXManagerClass` retry timing (call to 0x540C60). It then logs `PrecalcMaxAhead is %d` with Session+0x334 (0xA8B56C) through `hook_debuglog` (call at 0x7951A7).
4. YR Session globals: MaxAhead base 0xA8B550, PrecalcMaxAhead 0xA8B56C, DesiredFrameRate 0xA8B570, FrameSendRate 0xA8B554, latency level 0xA8DB9C, ping array 0xB7790C (8 × int32, ms). RA2's Session has a different layout (the no-router flag is Session+0x3038 in RA2, +0x3090 in YR), so RA2 addresses must be found, not derived.
5. RA2Web (`ra2web/server/src/server/WolServer.ts`) measures `user.ping` (ms) from `PING <now>`/`PONG` every `PING_INTERVAL_SECONDS` (30 s), starting 30 s after login, so it is 0 for the first 30 s. It sends the ping in NAMES (`nick,0,<ping>,<fresh>`), JOIN (`:0,<ping>,<op>,<fresh> #chan`) and JOINGAME (`0 0 0 0 0 <ping> 0 :#chan`).
6. Outgoing datagrams wait for `UdpRelay.pump()` on an 8 ms `setInterval` on the page's main thread (`web/src/game/udp-relay.ts:33`). Hidden tabs throttle that timer to 1 s, or 1 min after 5 min hidden (Chrome intensive throttling).
7. The relay is a WebSocket (TCP), so one lost segment delays every later datagram. Fixing that (WebRTC data channels or WebTransport datagrams) is out of scope here; Task 7 decides whether it is needed, based on numbers from separate networks.

## Global Constraints

- Test locally only (127.0.0.1 servers); no requests to public RA2Web hosts.
- Commit only when the user asks. Preserve other developers' uncommitted work in all three repositories (`redalert2-recomp`, `pcrecomp`, `ra2web/server`); stage only this plan's hunks.
- Native Windows/Linux builds keep their behavior: new web-only code stays in `src/web/` or behind `__EMSCRIPTEN__` in pcrecomp.
- `wol_user` keeps its x86 ABI layout (`sizeof(wol_user) == 108`); per-user data that is not in the WOLAPI struct goes in a parallel array.
- Both editions (RA2 `RA2_TARGET_GAME`, YR default) must build and pass the WOLAPI selftest.
- A ping value sent to the game is never below 17 ms or exactly 1000 (the game reads 0 and 1000 as "not available", and below 17 ms its `ping * 60 / 1000` IPX retry and timeout become 0, which logs "Service_Send_Queue bad connection").
- The original MaxAhead logic stays reachable with the game argument `--classic-latency`.

## Review Focus

- A player who joined before their first PONG has server ping 0: the bridge must treat that as unknown and return `E_FAIL`/-1 for any path that includes them, not 0 + peer. (Task 2 makes measured pings ≥ 1; Task 3 test `unknown_peer_ping_fails`.)
- Loopback round trips below 1 ms and sums of exactly 1000 ms: reported as ≥ 1 and as 1001. (Task 3 test `path_ping_avoids_sentinels`.)
- The real relay round trip is much longer than the WOL socket ping (a far relay, a slow link): the lowered start MaxAhead must still let the match run, and Protocol 2 must raise MaxAhead without a desync. (Task 5 e2e with `NATIVE_RELAY_TEST_DELAY_MS=150`.)
- A hidden tab keeps sending datagrams at full rate. (Task 6 manual check, recorded in the task's notes.)
- The RA2 edition writes its own Session addresses, not YR's. (Task 5 runs the RA2 build and checks its `PrecalcMaxAhead is` line.)

---

### Task 1: Latency report from match logs

**Files:**
- Create: `web/e2e/latency.mjs`
- Test: `web/e2e/latency.test.mjs`
- Modify: `docs/web/testing.md` (WOLAPI section: one paragraph on the report)

**Interfaces:**
- Produces: `summarizeGameLog(text: string): LatencySummary` where `LatencySummary = { pingTimesAvailable: boolean, maxPingMs: number | null, precalcMaxAhead: number | null, frameSendRate: number | null, maxAhead: number[], responseTimes: number[], worstFrameMs: number, slowFrames: number }`. CLI `node e2e/latency.mjs <shotsDir>` prints `{ "host": LatencySummary, "guest": LatencySummary }` from `<shotsDir>/{host,guest}/game.log`.

- [ ] **Step 1: Write the failing test** (`node:test` + `node:assert/strict`, no new dependencies)

```js
test("summarizes a match without ping times", () => {
  const log = [
    "[game] Ping times not available - Using defaults",
    "[game] PrecalcMaxAhead is 40",
    "[game] FrameSendRate is 10",
    "[game] Response time = 3",
    "[game] MaxAhead is 40",
    "[game] MaxAhead is 30",
    '@ra2 {"e":"fps","fps":43,"ms":23,"worst":311,"late":10,"pub":4,"pubms":0.16}',
    '@ra2 {"e":"fps","fps":54,"ms":18,"worst":28,"late":6,"pub":62,"pubms":0.17}',
  ].join("\n");
  assert.deepEqual(summarizeGameLog(log), {
    pingTimesAvailable: false, maxPingMs: null, precalcMaxAhead: 40, frameSendRate: 10,
    maxAhead: [40, 30], responseTimes: [3], worstFrameMs: 311, slowFrames: 1,
  });
});
test("reads the max ping when the game has ping times", () => {
  const s = summarizeGameLog("[game] Max ping is 84 ms\n[game] PrecalcMaxAhead is 20");
  assert.equal(s.pingTimesAvailable, true);
  assert.equal(s.maxPingMs, 84);
});
```

`slowFrames` counts fps samples whose `worst` is over 100 ms. Lines may contain non-UTF-8 bytes; read the file as `latin1`.

- [ ] **Step 2: Run it to see it fail**

Run: `cd web; node --test e2e/latency.test.mjs`
Expected: FAIL, `summarizeGameLog` is not exported.

- [ ] **Step 3: Implement `summarizeGameLog` and the CLI in `web/e2e/latency.mjs`**

Regexes over lines; the CLI runs only when the file is the entry script (`import.meta.url` vs `process.argv[1]`).

- [ ] **Step 4: Run the test**

Run: `cd web; node --test e2e/latency.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Record the baseline**

Run: `cd web; node e2e/latency.mjs ../build-web/speed-yr3`
Expected: both clients `pingTimesAvailable: false`, `precalcMaxAhead: 40`. Paste the JSON into the Results section at the end of this plan.

- [ ] **Step 6: Commit** (only when the user asks)

```bash
git add web/e2e/latency.mjs web/e2e/latency.test.mjs docs/web/testing.md docs/superpowers/plans/2026-10-25-wol-latency.md
git commit -m "Add a latency report for WOL match logs"
```

---

### Task 2: RA2Web measures ping at login, and a test relay delay

**Repo:** `ra2web/server` (branch `feat/wol-lobby-server`)

**Files:**
- Modify: `src/server/WolServer.ts` (`pingAll` loop body, `handlePong`, the line after `user.authenticated = true` at :274)
- Modify: `src/gserv/NativeRelay.ts` (constructor, `handleDatagram`)
- Modify: `src/config.ts`, `src/index.ts:36`
- Test: `test/wolServer.test.ts`, `test/nativeRelay.test.ts`

**Interfaces:**
- Produces: `ServerUser.ping` means 0 = not measured yet, otherwise ≥ 1 (ms). `WolServer.pingUser(user: ServerUser): void` sends `PING <Date.now()>` and sets `lastPingSent`. `new NativeRelay(manager, log, handshakeTimeoutMs = 10_000, delayMs = 0)`. Config `nativeRelayTestDelayMs` from env `NATIVE_RELAY_TEST_DELAY_MS` (default 0).

- [ ] **Step 1: Write the failing tests**

In `test/wolServer.test.ts`:
- `sends PING right after login`: after a successful login the client's sent lines include one matching `/^PING \d+\r\n$/`, with no timer advance.
- `a sub-millisecond PONG counts as 1 ms`: answer that PING immediately with `PONG <token>`; then join a channel; the NAMES entry for the user is `<nick>,0,1,0` or `<nick>,0,1,1` (ping field `1`, not `0`).

In `test/nativeRelay.test.ts`:
- `delays datagrams by delayMs`: with `delayMs = 50` and fake timers, a datagram from A to B is not on B's socket at 49 ms and is there at 50 ms.

- [ ] **Step 2: Run them to see them fail**

Run: `cd ../ra2web/server; bun test test/wolServer.test.ts test/nativeRelay.test.ts`
Expected: the three new tests FAIL.

- [ ] **Step 3: Implement**

`pingUser` is the body of the `pingAll` loop after the timeout check; call it once right after `user.authenticated = true`. In `handlePong` use `Math.max(1, Date.now() - sentAt)`. In `handleDatagram`, when `delayMs > 0`, deliver through `setTimeout(..., delayMs)` (copy the bytes before scheduling). Log one warning at startup when the delay is non-zero.

- [ ] **Step 4: Run the server suite**

Run: `bun test` and `bunx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit** (only when the user asks)

```bash
git add src/server/WolServer.ts src/gserv/NativeRelay.ts src/config.ts src/index.ts test/wolServer.test.ts test/nativeRelay.test.ts
git commit -m "Measure WOL ping at login and add a test delay for the native relay"
```

---

### Task 3: The bridge keeps member pings and answers GetAvgPing

**Files:**
- Modify: `src/web/wolapi.c` (`parse_roster` :386, `user_for_name` :434, the JOIN/JOINGAME handlers near :624, `m_net_get_avg_ping` :1005)
- Test: `src/web/wolapi_selftest.c`

**Interfaces:**
- Consumes: Task 2's ping semantics (0 = unknown).
- Produces: `static int32_t g_user_ping[32]` parallel to `g_users` (-1 = unknown). `static int32_t path_ping_ms(uint32_t ip)`: the own player's ping + the ping of the user whose `ipaddr == ip`; -1 if either is unknown or the ip is not in the roster; otherwise clamped to at least 1, and 1000 becomes 1001. NetUtil slot 8 `GetAvgPing(this, ip, int *avg)` returns `S_OK` with `path_ping_ms(ip)`, or `E_FAIL` with -1.

- [ ] **Step 1: Write the failing selftests** (in `main`, after the existing `#Lob_41_0` NAMES case)

```c
/* member_pings_from_names */
ra2_wolapi_receive_line(":wol 353 testuser = #testuser :@testuser,0,40,1 other,0,35,1 late,0,0,1");
int32_t avg = 0;
uint32_t other_ip = virtual_ip("other"), late_ip = virtual_ip("late"), stranger_ip = virtual_ip("stranger");
uint32_t ask_other[] = { other_ip, (uint32_t)(uintptr_t)&avg };
assert(invoke(g_channel.chat, 8, 2, ask_other) == S_OK && avg == 75);
/* unknown_peer_ping_fails */
uint32_t ask_late[] = { late_ip, (uint32_t)(uintptr_t)&avg };
assert(invoke(g_channel.chat, 8, 2, ask_late) == E_FAIL && avg == -1);
uint32_t ask_stranger[] = { stranger_ip, (uint32_t)(uintptr_t)&avg };
assert(invoke(g_channel.chat, 8, 2, ask_stranger) == E_FAIL && avg == -1);
/* path_ping_avoids_sentinels */
ra2_wolapi_receive_line(":wol 353 testuser = #testuser :@testuser,0,1,1 other,0,999,1");
assert(invoke(g_channel.chat, 8, 2, ask_other) == S_OK && avg == 1001);
/* ping_from_joingame */
ra2_wolapi_receive_line(":third!local JOINGAME 0 0 0 0 0 20 0 :#testuser");
uint32_t ask_third[] = { virtual_ip("third"), (uint32_t)(uintptr_t)&avg };
assert(invoke(g_channel.chat, 8, 2, ask_third) == S_OK && avg == 21);
```

Use the channel name the existing selftest has current at that point; if `parse_roster` ignores the line because a game session is active, place these cases before the session starts. Afterwards, feed the roster line the following existing assertions expect, so they still see the same users.

- [ ] **Step 2: Run the selftest to see it fail**

Run the PowerShell block in `docs/web/testing.md` ("WOLAPI bridge").
Expected: assertion failure at the first `GetAvgPing` check (returns `E_FAIL`).

- [ ] **Step 3: Implement**

Parse the second comma field of each NAMES entry, the second comma field of JOIN's `:a,b,c,d`, and the sixth number of JOINGAME. A parsed 0 is stored as -1. Whenever a `g_users` slot is (re)used, set its `g_user_ping` entry (-1 if the line had no ping).

- [ ] **Step 4: Run the selftest for both editions**

Expected: `yr` and `ra2` both exit 0.

- [ ] **Step 5: Commit** (only when the user asks)

```bash
git add src/web/wolapi.c src/web/wolapi_selftest.c
git commit -m "Report WOL member round trips to the game's ping queries"
```

---

### Task 4: RequestPing and OnPing; the game sees ping times

**Files:**
- Modify: `src/web/wolapi.c` (NetUtil method table :1147, `m_idle_pump`)
- Test: `src/web/wolapi_selftest.c`

**Interfaces:**
- Consumes: `path_ping_ms` (Task 3).
- Produces: NetUtil slot 6 `RequestPing(this, ip, timeout, int *handle)`: `S_OK`, writes a handle (starting at 1, increasing), and queues a result. The next `PumpMessages` (slot 7) calls `INetUtilEvent::OnPing(sink, hr, time, ip, handle)` on `g_channel.sink`, method slot 3. `hr` is `S_OK` with `time = path_ping_ms(ip)`, or `E_FAIL` with `time = -1`.

- [ ] **Step 1: Confirm which ping calls the game makes**

Under `RA2_NET_TRACE`/`ra2_net_trace(1)` (the page's `?udptrace`), add a trace line to `RequestPing` and `GetAvgPing` naming the ip. Run a two-client lobby (`node e2e/wol.mjs --url 'http://localhost:5173/?udptrace=1' --build ../build-web-wol-yr --shots ../build-web/wol-ping-trace --arg --intro --play --hold 20`). Expected: the guest log shows `RequestPing`, `GetAvgPing`, or both. Check the event slot: `OnGameresSent` is slot 5 in `complete_report`, and WOLAPI's INetUtilEvent order puts `OnPing` first (slot 3); confirm against the wolapi.dll type library the same way the IChatEvent ordinals were found. If the game only calls `GetAvgPing`, keep `RequestPing` as a plain `S_OK` + handle and skip the event.

- [ ] **Step 2: Write the failing selftest `request_ping_completes_on_pump`**

Feed `":wol 353 testuser = #testuser :@testuser,0,40,1 other,0,35,1"` first. Advise a test sink on `g_channel`, call slot 6 with `virtual_ip("other")`, timeout 1000, `&handle`; assert `S_OK`, `handle == 1`, no event yet; call slot 7; assert exactly one event at slot 3 with args `(sink, S_OK, 75, ip, 1)`. Then `RequestPing` for `virtual_ip("stranger")` and a pump: one event `(sink, E_FAIL, -1, ip, 2)`.

- [ ] **Step 3: Run the selftest to see it fail**

Expected: `RequestPing` returns `E_NOTIMPL`.

- [ ] **Step 4: Implement**, then run the selftest for both editions. Expected: both pass.

- [ ] **Step 5: End-to-end check**

Rebuild (`EMCC_DEBUG=0 ninja -C build-web-wol-yr ra2.js`), restart the local RA2Web with Task 2, run a full match (`node e2e/wol.mjs --url 'http://localhost:5173/' --build ../build-web-wol-yr --shots ../build-web/wol-ping --arg --intro --play --hold 60`), then `node e2e/latency.mjs ../build-web/wol-ping`.
Expected: both clients `pingTimesAvailable: true`, `maxPingMs` ≥ 2; the game log has a `Got Ping game options string. P2,...` line with no `-1`; the match ends in victory as before.

- [ ] **Step 6: Commit** (only when the user asks)

```bash
git add src/web/wolapi.c src/web/wolapi_selftest.c
git commit -m "Answer the game's WOL ping requests from the measured round trips"
```

---

### Task 5: Start the match with a MaxAhead that fits the ping

**Files:**
- Create: `src/web/net_tuning.c`, `src/web/net_tuning.h`, `src/web/net_tuning_selftest.c`
- Modify: `src/web/main.c` (`ra2_hook_debuglog` :101, the edition block at :659–:666, argument parsing), `CMakeLists.txt:70` (add `net_tuning.c` to `ra2`)
- Modify: `docs/web/testing.md` (selftest command)

**Interfaces:**
- Consumes: ping times from Task 4.
- Produces:
  - `int ra2_tuned_max_ahead(int original, int max_ping_ms, int fps, int frame_send_rate)`: `original` when `max_ping_ms <= 0` or `max_ping_ms == 1000`; otherwise `clamp(round_up_10(ceil(max_ping_ms * fps / 2000.0) + frame_send_rate + 5), 10, original)`. `fps <= 0` counts as 60.
  - `typedef struct { uint32_t fmt, precalc_max_ahead, desired_fps, frame_send_rate, ping_array; } ra2_session_addrs;` and `void ra2_net_tuning_init(const ra2_session_addrs *addrs, int enabled)`, `void ra2_net_tuning_on_debuglog(uint32_t fmt)`. When `fmt == addrs->fmt` and tuning is enabled, it reads the 8 pings, writes the tuned value to `precalc_max_ahead` and to the logged vararg slot (`MEM32(g_esp + 8)`) so the log shows the value in effect.
  - YR addresses: fmt 0x84C578, precalc 0xA8B56C, fps 0xA8B570, send rate 0xA8B554, pings 0xB7790C. RA2: find the string `PrecalcMaxAhead is %d` in `game/Ra2.exe`, then the `push` of it in `src/recomp/gen_game/`; read the neighboring `mov eax, [..]` and the ping loop's base the same way as YR's 0x7951A1 / 0x79509E.
  - Game argument `--classic-latency` passes `enabled = 0`.

- [ ] **Step 1: Write the failing selftest** (`net_tuning_selftest.c`, plain asserts)

```c
assert(ra2_tuned_max_ahead(40, 0, 60, 10) == 40);     /* no ping times */
assert(ra2_tuned_max_ahead(40, 1000, 60, 10) == 40);  /* the game's "unavailable" */
assert(ra2_tuned_max_ahead(40, 2, 60, 10) == 20);     /* loopback: 1 + 10 + 5 = 16 -> 20 */
assert(ra2_tuned_max_ahead(40, 100, 60, 10) == 20);   /* 3 + 10 + 5 = 18 -> 20 */
assert(ra2_tuned_max_ahead(40, 300, 60, 10) == 30);   /* 9 + 10 + 5 = 24 -> 30 */
assert(ra2_tuned_max_ahead(40, 900, 60, 10) == 40);   /* never above the game's own value */
assert(ra2_tuned_max_ahead(40, 100, 0, 10) == 20);    /* fps 0 counts as 60 */
assert(ra2_tuned_max_ahead(20, 2, 30, 5) == 20);      /* slower speed: 1 + 5 + 5 = 11 -> 20, capped at the original 20 */
```

Build like the WOLAPI selftest: `emcc src/web/net_tuning_selftest.c -sENVIRONMENT=node -o build-web/net-tuning-selftest.js; node build-web/net-tuning-selftest.js`.

- [ ] **Step 2: Run it to see it fail** (link error: `ra2_tuned_max_ahead` undefined).

- [ ] **Step 3: Implement** `net_tuning.c`, call `ra2_net_tuning_on_debuglog(MEM32(g_esp + 4))` at the top of `ra2_hook_debuglog` (before the logging condition, so it runs with logging off), and `ra2_net_tuning_init` in the edition block. Run the selftest: PASS.

- [ ] **Step 4: Measure, YR**

Rebuild, run a full match into `../build-web/wol-tuned`, then `node e2e/latency.mjs ../build-web/wol-tuned`.
Expected: `precalcMaxAhead: 20` on both clients, first `maxAhead` entry 20, victory as before. Paste into Results.

- [ ] **Step 5: Measure under a slow relay**

Restart the local RA2Web with `NATIVE_RELAY_TEST_DELAY_MS=150` and run the match again into `../build-web/wol-tuned-slow`.
Expected: the match finishes without `desync`/`reconnect` lines in either log; `maxAhead` rises above the start value. If it stalls or desyncs, add `+ relay_margin` (to be measured) to the formula and repeat Steps 1–5 before going on.

- [ ] **Step 6: RA2 edition**

Build the RA2 module (`RA2_TARGET=game`), run its match. Expected: its log shows `PrecalcMaxAhead is 20` and the match completes.

- [ ] **Step 7: Commit** (only when the user asks)

```bash
git add src/web/net_tuning.c src/web/net_tuning.h src/web/net_tuning_selftest.c src/web/main.c CMakeLists.txt docs/web/testing.md docs/superpowers/plans/2026-10-25-wol-latency.md
git commit -m "Start WOL matches with a command delay sized to the measured ping"
```

---

### Task 6: Send datagrams as soon as the game queues them

**Repos:** `pcrecomp` (wsock32.c), `redalert2-recomp` (main.c, udp-relay.ts, loader.ts)

**Files:**
- Modify: `../pcrecomp/runtime/win32hle/wsock32.c` (`wudp_send` :258), `../pcrecomp/runtime/win32hle/win32hle.h`
- Modify: `src/web/main.c` (register the hook)
- Modify: `web/src/game/udp-relay.ts`, `web/src/game/loader.ts:625`
- Test: `web/src/game/udp-relay.test.ts`

**Interfaces:**
- Produces:
  - pcrecomp: `extern void (*hle_ws_udp_on_queue)(void);` called by `wudp_send` after a datagram is queued, outside the mutex. Null by default.
  - main.c: `static void ra2_udp_wake(void)`: if an `_Atomic int g_udp_wake_pending` was 0, set it to 1 and `MAIN_THREAD_ASYNC_EM_ASM({ Module.ra2UdpWake && Module.ra2UdpWake(); })`. `EMSCRIPTEN_KEEPALIVE void ra2_udp_wake_done(void)` clears the flag; `loader.ts` cwraps it next to `ra2_udp_pop`.
  - `UdpRelay.wake(): void`: runs `pump()` now. `loader.ts` sets `module.ra2UdpWake = () => { udp.ra2_udp_wake_done(); udpRelay?.wake(); }`. The interval stays as a fallback, at 50 ms instead of 8.

- [ ] **Step 1: Write the failing test** in `udp-relay.test.ts`

`wake sends queued packets without waiting for the timer`: with fake timers, a connected relay and one queued packet, `relay.wake()` puts the packet on the socket with no timer advance; a second `wake()` with an empty queue sends nothing.

- [ ] **Step 2: Run it to see it fail**

Run: `cd web; pnpm test -- src/game/udp-relay.test.ts`
Expected: FAIL, `wake` is not a function.

- [ ] **Step 3: Implement** the TypeScript side, then the pcrecomp hook and main.c. Run: `pnpm test` (all pass) and `pnpm exec tsc --noEmit`.

- [ ] **Step 4: Full match**

Rebuild, run a full match into `../build-web/wol-wake`. Expected: victory as before; `node e2e/latency.mjs` shows `responseTimes` no higher than in Task 5's run.

- [ ] **Step 5: Hidden-tab check (manual)**

Two local browser windows in a match; hide one tab for 2 minutes with the game muted. Expected: the visible player's units keep responding without the multi-second stalls seen before. Record the result in Results.

- [ ] **Step 6: Commit** (only when the user asks; pcrecomp `wsock32.c` carries other uncommitted work, so stage only this hunk with `git add -p`)

```bash
git add web/src/game/udp-relay.ts web/src/game/udp-relay.test.ts web/src/game/loader.ts src/web/main.c
git commit -m "Send WOL datagrams as soon as the game queues them"
```

---

### Task 7: Separate-network measurement and the transport decision

**Files:**
- Modify: `docs/web/decisions.md` (new entry D-next: "WOL match transport")
- Modify: `docs/web/progress.md`, `docs/web/handoff-wolapi.md`, this plan's Results

- [ ] **Step 1: Measure on two networks** (still a local server: the second client reaches it over the LAN or a tunnel the user sets up; no public host)

Run three matches with Tasks 1–6 in place: same machine, two machines on one LAN, and one client on a phone hotspot. For each, record `node e2e/latency.mjs` output and how often `slowFrames` or `responseTimes` spike.

- [ ] **Step 2: Decide**

Write the decision entry. Choose WebRTC data channels (unordered, `maxRetransmits: 0`, signaled over the relay WebSocket, relay as fallback, reusing `LanPeer`) only if the hotspot run shows stalls that the LAN run does not. Otherwise record "WebSocket relay stays", with the numbers. Either way, list WebTransport and regional relays as later options.

- [ ] **Step 3: Commit** (only when the user asks)

```bash
git add docs/web/decisions.md docs/web/progress.md docs/web/handoff-wolapi.md docs/superpowers/plans/2026-10-25-wol-latency.md
git commit -m "Record WOL latency measurements and the match transport decision"
```

---

## Out of scope

- WebRTC or WebTransport for match traffic (Task 7 decides; it gets its own plan).
- The in-game **Connection** slider (`LATENCYFUDGE` events, "Ignoring latency change to avoid cheating"): separate investigation.
- Relay rate limiting and send-buffer caps (tracked in `handoff-wolapi.md`).

## Results

| Run | Client | ping available | max ping | PrecalcMaxAhead | MaxAhead series | worst frame | notes |
|---|---|---|---|---|---|---|---|
| baseline `speed-yr3` | host | | | | | | |
| baseline `speed-yr3` | guest | | | | | | |
