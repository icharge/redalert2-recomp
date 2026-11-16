# Quick Co-op (Yuri's Revenge): research and design

Status of 15 Nov 2026: **server side built, on by default since ra2web `4435f8e`; played to the score screen on two real clients**. The retail
client has the button; the server now has the lobby and queue (see "Built" below). Evidence is from the lifted gamemd and from
the VERA20K notes (`../vera20k/src/app/shell_wol/quick_match.rs`, `docs/lobby-protocol.md`), which
port the same handlers. Marked **Seen** (read in code), **Assumed** (from VERA20K, not re-read in
the bytes) or **Open** (needs a client).

## What the button is

On the online welcome screen the buttons are controls `0x6E0` (Quick Match, text
`STT:WOLWelcomeQuickMatch`), `0x6E1` (Custom Match), `0x6E2` (buddies), `0x6E3` (World Domination),
`0x771` (**Quick Co-op**, text `STT:QuickCoop`). **Seen**, `sub_00605B*` (the welcome text) and the
handler at `0x007986xx` that stores the lobby mode word `[0xA8B244]`:

| Control | Mode word | Meaning |
|---|---|---|
| `0x686` | 0 | login / welcome back |
| `0x6E0` | 1 | Quick Match |
| `0x771` | **2** | **Quick Co-op** |
| `0x6E3` | 3 | World Domination |
| `0x6E1` | 4 | Custom Match |
| `0x6E2` | 5 | buddies |

The dispatcher at `0x0077B40C` indexes a jump table at `0x77B5FC` (read from `GameMD.exe`:
`77b41c 77b439 77b439 77b463 77b447 77b482 77b4ae`). Modes 1 and 2 both go to `0x77B439`, which calls
the **same Quick Match runner `0x0079FC40`**. So Quick Co-op is not a separate protocol: it is the
Quick Match handshake with another lobby and another game.

## What differs from Quick Match

From the runner (`0x0079FD9E` picks the prefix) and VERA20K's port of it (**Assumed** past the first row):

| | Quick Match | Quick Co-op |
|---|---|---|
| Lobby channel | `Lob_40_*` | `Lob_39_*` (prefix at `0x0084A22C`) |
| Request to `matchbot` | `Match COU=..,COL=..,MBR=..,LOC=..,RAT=..,RES=..,ADR=..,NAT=..,PRT=..` | the same line (VERA treats the runner "alike") |
| Game channel `tournament` field | 1 | **0** |
| Game mode | first mode (Standard/Battle) | the **Cooperative** mode (2 humans against computer players) |
| Map | a skirmish map the matchbot names | the host replaces it with the first Allied co-op mission (`C1A01MD.MAP` in VERA's capture) |
| Extra record | none | a **cooperative campaign line** published before the options: `C0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-1,<host name b64>,<guest name b64>` |
| Allies | Free for all in a 1v1 | the two humans are allied, no diplomacy menu |
| Start positions | the options' | the load uses the co-op start points |

The consequences for a server:

1. **Publish `#Lob_39_0`** with `@matchbot` in its names list, as lobby 40 does. The shim already lets
   `Lob_39_` through its channel filter (`src/web/wolapi.c`).
2. **A queue of its own** (type `141` for YR co-op; `41` is already the YR main lobby) so a co-op player is never paired with a
   Quick Match player. The queue is chosen by the lobby, like lobby 40 and 38.
3. **Unranked.** A co-op game is two humans against the computer; there is no loser to rate. If it is
   ever ranked, it would be a "co-op clear time" board, not Elo (decision below).
4. The options record must name a map the **cooperative mode** accepts. The host overrides the map
   with its own first Allied co-op mission, so the exact name matters less than that the record's
   size/digest pass the joining client's check. Use the same rule as the Quick Match pool
   (size = file length, digest = the map's `[Digest] 1=`).

## Checked in the lifted code (15 Nov 2026)

Re-read in `recomp_0056.c`, `recomp_0037.c`, `recomp_0039.c`, `recomp_0031.c`:

- **Seen: the lobby prefix is the only thing the runner changes.** `sub_0079FC40` starts with `Lob_39_`
  (`0x84A22C`) and swaps to `Lob_40_` (`0x84A21C`) when the mode word `[0xA8B244]` is not 2 (`0x79FD9E`). The
  request builder (`COU=`, `COL=`, `MBR=` ...) never reads the mode word, so the line is the same as Quick
  Match's.
- **Seen: only two game-side branches test mode word == 2**, both on the match start, so Quick Co-op is decided
  by the client's own state, not by anything the server sends:
  - `0x68755E` (load): mode 2 calls `sub_005EE9D0` ("Assigning Starting Points for house %d", the scenario's
    own start points) instead of the options-driven path (vtable `+0x84`).
  - `0x657EF2` (ready/start screen): mode 2 skips a per-player update the other modes do.
- **Seen: the mode word is set by the welcome buttons** (`0x79883F` writes 2; `0x798746` writes 1 for Quick
  Match).
- **Not in the code: the co-op map, the cooperative campaign line and the AI setup.** Nothing in the client
  decides them from the mode word, so they come from the matchbot's record. That is exactly the **Open** list
  below, and only a capture or a trial record can settle it.
- **Correction to the design below: queue type `41` is taken.** `41` is the YR main lobby's channel type
  (`WolServer.ts` maps `channelType === 41` to YR SKU 10496, `MatchmakingBot.ts:949` excludes 33/41 when it
  picks a queue, and `VeraLobby.ts` uses kind 41). Use a free number such as `141` (RA2 Quick Match uses
  `135`).

## Not known (Open)

- The exact record the retail matchbot sent for co-op (its `GAMEOPT` fields, the cooperative
  difficulty, the AI count and colours). VERA20K builds its own; no real capture exists.
- Whether the retail client accepts the cooperative campaign line from the matchbot's record or
  builds it itself at the host (VERA says `+0x94` publishes it).
- Which co-op missions the matchbot used (a rotating pool of the `C?A??MD`/`C?S??MD` maps?).

All three are answered by one capture: press Quick Co-op against a stock server that serves
`Lob_39`, and record the `GAMEOPT` lines (`web/e2e/wol.mjs --start` already logs them).

## Design

```
Lob_39 join -> Match (no VRS) -> queue "yr-coop" (type 141, unranked, 2 players)
            -> pair -> record with the co-op map, tournament 0, cooperative line
            -> Matched -> STARTG as in Quick Match
```

| Piece | Where | Notes |
|---|---|---|
| Lobby | `WolServer.handleList` | `COOP_QUICK_LOBBY = 39`, same code path as lobby 40 |
| Queue | `MatchmakingBot` | new type `141` (not `41`, the YR main lobby), `ranked=false`, no `Settlement.admit` |
| Pool | the map-pool store ([admin-and-config.md](admin-and-config.md)) | edition `yr`, mode `coop`, each map has `kind` and `slots` |
| Switch | setting `queues.yrCoop.enabled` | off by default until a client run confirms the record |

Why off by default: publishing lobby 39 changes what the retail client shows (the button becomes
live instead of "Matching Server Not Found"), and a wrong record makes both clients leave with
"scenarios do not match". The same reason M2 in the [roadmap](roadmap.md) keeps new maps behind a
real run.

## Decisions that are yours

1. Is Quick Co-op in scope as a real feature, or is a clear "co-op is not hosted" message enough? (the
   button does show; today it ends "Matching Server Not Found").
2. Ranked or not. Recommended: not ranked; a co-op clear-time board later if wanted.
3. Which missions: the first Allied one only, or a pool, and should the Soviet/Yuri missions be in it.

## First real client run (14 Nov 2026): it plays to the end

Two retail YR clients paired through lobby 39, loaded `C1A01MD`, played a full game and reached the co-op score
screen ("Campaign Results", then "Next Mission: Campaign 1 Map 2"). It took three record fixes, in this order:

1. **Game mode id.** The 12th field of the options record is the mode's `MPModesMD.ini` id (Battle 1, Cooperative 3).
   With 1 the mission loaded as Battle and crashed on null calls right after the load (exit 3).
2. **Countries.** The first Allied mission admits only Americans, so both humans are country 0 (a Random country is
   never resolved on this path).
3. **Starts and AI.** Humans on starts 0 and 1 (positions 1 and 2), the map's other starts as computer opponents:
   AI rows `1,<country>,<colour>,<start>,2` (Russians 8, Cubans 7, squad 2), the rest inactive.

Not confirmed: the cooperative campaign line (`C0,...`) is still not sent and nothing needed it for this mission;
"Next Mission" after the score screen: Continue works since the game name fix (C-2 below); a won mission starts `C1A02MD` (R1 row 8, "Won mission" at the end).

Debug flag (C-1, 16 Nov 2026): `COOP_CAMPAIGN_LINE=true` on the server sends the campaign line as its own `GAMEOPT`
before the options, to the room and to each player from the other (off by default, the options are unchanged). The names
use the game's `=HH` encoding (`0x0049D680`: letters and digits as they are, any other byte as `=` and two hex digits),
which VERA20K ports, not base64 as the table above says. The two-client trial with and without the flag was done on
16 Nov 2026, see "Two-client run" below (both reach the score screen; the game decodes the line).

**Results.** The clients POST their game result to `/native-results/<gameId>`. An unranked instance without a wire SKU was
answered 404 (not logged), so the two games of this run were not stored. Quick Co-op instances now carry
`nativeSku` 18688 so the report is kept as unscored history; co-op is still never rated.

## Chat on the Campaign Results screen (fixed, see "Two-client run" below)

A message typed on the co-op "Campaign Results" screen showed on the sender's screen and not on the partner's.

- **Dialog.** `gamemd.exe` dialog `0xBC6` (`GUI:CampaignResults`, `GUI:PreviousMission`, `GUI:NextMission`) has a
  chat list `0x53F` and an edit box `0x540`. **Seen** in `sub_0046DFD0` (0x0046E137): Enter in `0x540` formats the
  text and sends a `0x1C7`-byte message with `IPXManagerClass` (`0x00541820`, object `0xA8E9C0`) to every non-null
  entry of the session's connection array (`[0xA8DA78]`, count `[0xA8DA84]`).
- **So it is a UDP datagram, not IRC.** It goes through the native relay like game traffic. The server log shows no
  IRC chat for it (and `privmsg ... missing channel` is logged, so it was not sent to the closed room).
- **Unknown:** whether the game sends it at all after the match (an empty connection array sends nothing), or the
  relay drops or misroutes it, or the partner's game ignores it. Added to find out: the relay logs the first datagram
  of each new length per player after its first 24 (`new datagram length N`), each destination with no target, and
  each delivery to a closed socket; the server logs chat sent to a game room with its members; `wolapi.c` logs
  `chat sent` / `chat not sent` / `chat ... ignored` on the `[wol]` console channel.
- **To read:** play to the score screen, type a line on each side, then compare `server.log` (a `new datagram length`
  line from the sender means the game sent it) with the receiver's browser console.
- **Answered on 16 Nov 2026** ("Two-client run" below): the sender's game sends it, the relay delivers it, the
  partner's Winsock gets all 475 bytes, and the partner's game did not draw it: the game-name hash check (each client
  held the other's name). Fixed in `wolapi.c`, see "C-3" below.

## Built (15 Nov 2026)

Server side in `ra2web/server`, covered by `test/yrCoop.test.ts`:

- **Switch: on by default** since ra2web `4435f8e` (task C-0, decided 14 Nov 2026). `YR_COOP_ENABLED=false` turns it off,
  and the admin setting `queues.yrCoop.enabled` overrides it live.
- **Needs a co-op map:** the lobby is published (`#Lob_39_0` on `LIST 0`, `@matchbot` in its names) only while the
  switch is on **and** the pool (`quickMatch.pool`) has an enabled map with `mode: "coop"` for `yr`. The built-in pool
  has ten since ra2web `2a173d9` (task C-4): `C1A01MD` (163770 bytes, the first Allied co-op mission from a stock
  `MultiMD.mix`, ra2web `7f69afc`) and nine more, see "More missions (C-4)" below. Any further mission takes its size and
  digest from the real file (admin console or `config.quickMatchPool`).
- **Queue:** type `141` (`COOP_QUICK_TYPE`), native family, never ranked (no SKU, no ladder type, no
  `Settlement.admit`). A co-op player is never paired with a Quick Match player. A player in both `Lob_41` and
  `Lob_39` is a co-op player.
- **Record:** the YR Quick Match record with the co-op map, concrete country and colour, speed 6, and team `1` for
  both humans (allied). The cooperative campaign line is **not sent**: its format on the wire is not known. The
  server logs `quick co-op record: ...` for each match, to compare with a real client.
- **Shim:** `src/web/wolapi.c` already passes `Lob_39_` for the YR edition.

To try it: start the server (co-op is on by default), press Quick Co-op in two YR clients, and read `server.log`. Expected failures to watch: "scenarios do not match" (map size or digest
wrong) or the clients loading a Quick Match game instead of co-op (the record needs the cooperative setup).

## More missions (C-4, 16 Nov 2026)

The built-in pool holds all ten YR co-op missions the game's own list (`MISSIONSMD.PKT`) names, in campaign order, each
`mode: "coop"`, enabled, 4 start positions, size and digest as `scripts/map-pool-scan.ts` reads them from the stock files
(the same values `stockMaps.ts` lists; `quickMatchMaps.test.ts` checks the two agree). `C3Y02MD` is in `MultiMD.mix`, the
others in `ExpandMD01.mix`:

| Mission | Size | Digest |
|---|---|---|
| `C1A01MD` | 163770 | `qSt1w6I0r+9EWkfWl7XFZMt0Vo4=` |
| `C1A02MD` | 337896 | `lnBiQssDlKrsAArpu7ReGyis8Fs=` |
| `C1A03MD` | 237231 | `meqVVPoA3xnT/6Ke9JoI8kV/5mM=` |
| `C2S01MD` | 248872 | `/EUn3S1sU9B/ZFmg4XwNErmjQyY=` |
| `C2S02MD` | 236298 | `00AUAtOwp1NFQCggb0Xg4CktH1E=` |
| `C2S03MD` | 291033 | `sLd/Wc9zIogtq4auhs8rlWcW2U4=` |
| `C3Y01MD` | 233850 | `DVPzHfdBla4MIrFteMWr3p4jMuA=` |
| `C3Y02MD` | 223889 | `/fcII93re+hKiM36cwwnWDXq6Fc=` |
| `C3Y03MD` | 276487 | `4H9pBuZS9f/oMyp5SZXOPhZuGvI=` |
| `C4W01MD` | 238834 | `eePHMaqvnWG3iCEhrnWF2E9aqzk=` |

Quick Co-op picks one of the ten at random per match (the pool weights apply). **One two-client run per mission** with
`coop.mjs --map STEM --short`, against a scratch server started with `QUICK_MATCH_MAPS=STEM` (the allow list narrows the
co-op pool to that mission), `STORAGE=memory`, on the production YR bundle of 16 Nov 2026. Each: both clients paired
through `#Lob_39_0`, the options record named `STEM.MAP`, no "do not match" line, both ran 300+ frames, Esc, Abort Mission,
Observe, both reached `0xBC6` (about one minute each):

| Mission | Paired | Loaded (frames) | Score screen |
|---|---|---|---|
| `C1A02MD` | yes | yes (710, 710) | yes |
| `C1A03MD` | yes | yes (840, 840) | yes |
| `C2S01MD` | yes | yes (660, 656) | yes |
| `C2S02MD` | yes | yes (820, 820) | yes |
| `C2S03MD` | yes | yes (800, 800) | yes |
| `C3Y01MD` | yes | yes (830, 830) | yes |
| `C3Y02MD` | yes | yes (700, 700) | yes |
| `C3Y03MD` | yes | yes (700, 698) | yes |
| `C4W01MD` | yes | yes (650, 650) | yes |

`C1A01MD` is the mission of the full runs below. A won mission's "Next Mission" is "Won mission" at the end (forced win, R1 row 8).

## Two-client run (16 Nov 2026)

`web/e2e/coop.mjs` drives two YR pages (no rebuild, `web/public/game/` as it was) against a fresh local WOL server
(`STORAGE=memory`): guest tickets, Internet, Quick Co-op on both, the match, Esc, Abort Mission, Observe on both, then
the Campaign Results screen (`0xBC6`). `?udptrace` adds the Winsock `[net]` and `[udp-relay]` lines. One run takes
about five minutes: `node e2e/coop.mjs --url http://127.0.0.1:5175/ --game ../game --label line-off --server-log <file>`.
Run with `COOP_CAMPAIGN_LINE` unset and with `=true`.

**C-1, the campaign line.** Both settings: both clients are paired through `#Lob_39_0`, load `C1A01MD`, run (300 to 304
frames each) and reach `0xBC6`. Flag off: 8 `GAMEOPT` lines to A and 6 to B (a slots line, then options), no `C0` line,
and the game logs only `Init Campaigns`. Flag on: 10 and 8, the `C0` line twice on each side (the room copy and the
partner copy):

    C0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-1,za296bd,zb296bd
    [game] @@@@ Decoding cooperative campaign game options C0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-1,za296bd,zb296bd
    [game] Setting Campaign info for Mode 1: Battle

So the game accepts the line from the matchbot and decodes it without an error, and the match plays the same. What
the line does for "Next Mission" is not known (see C-2). The flag stays off by default.

**C-3, chat on the score screen: FOUND and FIXED (16 Nov 2026).** A types
`coop<tag>` in the edit `0x540`:

- A's own list shows it.
- A's relay socket sends one 483 byte frame (8 byte header, 475 byte payload: the `0x1C7` message plus framing);
  the server logs `native relay: za296bd new datagram length 483 (packet 476) dst=10.219.249.32` and delivers it to B
  (no `no target` or closed socket line).
- B's page receives it: `[udp-relay] recv from 10.212.36.163 ports 1234->1234 475 bytes 01785c15...`, and B's Winsock
  hands it to the game: `[net] recvfrom 10.212.36.163:1234 475 bytes`. The same with the flag off (`(packet 465)`).
- B's list stayed empty and the game logged nothing about it. So `NativeRelay.ts` and the page's relay do not drop it;
  the loss was after `recvfrom`, in the game.

Cause, confirmed in memory with `coop.mjs` (it reads the guest heap through `handle.memory().HEAPU8`; a guest address is
the heap offset): the message `0x0C` the chat sends carries, at `+0x114` of the packet (`0x00A8D74C` once received), the
hash of the game name, UTF-16 at `0x00A8D610` (hash `0x005DAC00`: upper-cases ASCII, folds each unit). The receiver
(`0x0048D8DD`) compares it with the hash of its own `0x00A8D610` when the byte `0x00A8D60D` is set, and ends on a
mismatch without drawing. Measured on the score screen of the unfixed build (gate `0x00A8D60D` = 1 on both clients):

    A (za72be6): [0xA8D610] = "zb72be6"        B (zb72be6): [0xA8D610] = "za72be6"

Each client held the other player's name. In a game a player created, the host's own Create copies its name there
(`0x0078A0A9`) and a guest's user-list sink stores the first other user (`0x007A7627`), the host, so every player holds
the host's name and the hashes agree. In a matchbot room nobody ran Create: the operator A is a guest to the game like
B, its first other user is B, and the two names differ. The hash in the dump (`+0x114`) was the sender's own.

Fix, in `src/web/wolapi.c` (`apply_game_name`, with `ra2_wolapi_set_game_name(0x00A8D610)` from `src/web/main.c`, Yuri's
Revenge only): at STARTG the shim takes the room operator's name (the `@` entry of the room's NAMES list) and keeps
`0x00A8D610` equal to it, at STARTG and on every `ra2_wolapi_poll` while the session lasts (the game empties it again
between rounds; the log shows `[wol] game name set to the room host <name>`). In a room a player hosted the operator is
the host, which already holds its own name there, so nothing changes for it. After the fix both clients read
`[0xA8D610] = "zab63fc"` (the operator), the chat line's hash is `0x260b` on both, and B draws A's line
(`coop.mjs`: `C-3 step 3: B's game drew the chat line`). It applies to every matchbot game of Yuri's Revenge, so it
also covers in-game chat of a Quick Match. `game.exe` is not touched (its address is not known and it has no co-op).

**C-2, Continue on the score screen: works after the same fix.** Before it: nothing asked of the server and the
clients stayed on `0xBC6` for 25 s and for 60 s (only 28 and 75 byte relay keepalives; the greyed Continue and a ready
star were the only change), because the host's own messages after Continue met the same name check. After it, with
Continue on B first and on A second (`--a-first` for the other order; with A first the game showed no ready mark for
A), the host sends a `483` byte datagram to the guest and both log:

    A: [game] Sending Campaign Options... / Processing Random Assignments... / Sending to <B> /
       Init random number, Seed is ..., Setup Rematch: Random Seed = 1897192559 / Max ping is 17 ms
    B: [game] Decoding Campaign Options... / Sending to <A> / Init random number / Setup Rematch /
       [dialog] closed 0xBC6 / Pregame setup for 2 players / ----- Starting scnenario: C1A01MD.MAP -----

Both then run the scenario again (frames A 590, B 590 within the 25 s plus the wait) with no WOL frame and no HTTP
request: Continue is a round of game datagrams (the host's `Sending Campaign Options`, the guest decodes them), as VERA20K
says. The server is not asked. Note it was a lost mission (Abort Mission, Observe), so Continue
replays `C1A01MD` ("Setup Rematch"); the next map after a won mission is "Won mission" below (R1 row 8).

Side finding: the clients' `POST /native-results/<gameId>` for a co-op instance is answered 400 `Match context mismatch`
(`nativeResults.ts`, around lines 70 and 72), so these results are still not stored. Not looked into here.

**Won mission, "Next Mission" (R1 row 8, 16 Nov 2026): works, the server is still not asked.** `coop.mjs --map C1A01MD
--win` (scratch server with `QUICK_MATCH_MAPS=C1A01MD`) wins the mission instead of aborting it. Nobody can play it to a
win in a test, so the harness writes what the map's win action leaves behind. That action calls
`HouseClass::Flag_To_Win` (`0x004FC9E0`) on every human House; the lifted code shows the bytes. Read from the guest heap
(a guest address is the heap offset): House array items `[0xA8022C]`, count `[0xA80238]`; in a House human `+0x1EC`,
Defeated `+0x1F5`, Flag_To_Die `+0x1F6`, Won `+0x1F7`, Lost `+0x1F8`, and the result timer (CdTimer) `+0x298` (start
frame), `+0x2A0` (duration); the frame counter is `[0xA8ED84]`. Flag_To_Win returns early when `+0x1F7`, `+0x1F6` or
`+0x1F8` is set, otherwise sets `+0x1F7 = 1` and starts the timer at the frame counter for SavourDelay (in a network game
rounded so the expiry falls on a multiple of ten frames; `+0x29C` is stack garbage in the original). The harness does the
same in both pages for both human Houses: it polls the frame counter (MessageChannel loop) to a target frame 90 frames
ahead, then writes `+0x298 = target`, `+0x2A0 = duration` and `+0x1F7 = 1` with the same values on both clients, so
the two lockstep games see the same state from the same frame (both pages saw frame 638 in the first run, 610 in the
second). What Flag_To_Win does besides (EVA line, input lock, on-screen text) is not reproduced; nothing needed it.

Result, twice: after the timer expired (about 120 frames) both games ended the mission themselves and opened
`0xBC6` (Campaign Results, kills/losses/built/score rows for both players, "Next Mission: Campaign 1 Map 2" and the
briefing of the next mission). Continue on B first and A second: the host logs `Sending Campaign Options...`, both log
`Setup Rematch` (the game's word for it), `[dialog] closed 0xBC6` and `----- Starting scnenario: C1A02MD.MAP -----`
(the game's spelling), and run (A 350, B 340 frames in the first run; 240 and 240 in the second). No WOL frame and no
HTTP request after Continue: the next mission is a round of game datagrams, as after a loss. `C1A02MD` came from the
stock files on both clients and from the pool (C-4), so nothing was added. Not looked into: the final `POST
/native-results` of this win (the same 400 `Match context mismatch` noted above is expected).
