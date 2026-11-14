# Quick Co-op (Yuri's Revenge): research and design

Status of 15 Nov 2026: **server side built behind a switch, not run on a real client**. The retail
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
"Next Mission" after the score screen was not exercised.

**Results.** The clients POST their game result to `/native-results/<gameId>`. An unranked instance without a wire SKU was
answered 404 (not logged), so the two games of this run were not stored. Quick Co-op instances now carry
`nativeSku` 18688 so the report is kept as unscored history; co-op is still never rated.

## Built (15 Nov 2026)

Server side in `ra2web/server`, behind a switch, covered by `test/yrCoop.test.ts` (eight tests):

- **Switch:** `YR_COOP_ENABLED=true`, or the admin setting `queues.yrCoop.enabled` (live). Off by default.
- **Needs a co-op map:** the lobby is published (`#Lob_39_0` on `LIST 0`, `@matchbot` in its names) only while the
  switch is on **and** the pool (`quickMatch.pool`) has an enabled map with `mode: "coop"` for `yr`. There is no
  built-in co-op map: size and digest must come from a real mission file (add it in the admin console or via
  `config.quickMatchPool`).
- **Queue:** type `141` (`COOP_QUICK_TYPE`), native family, never ranked (no SKU, no ladder type, no
  `Settlement.admit`). A co-op player is never paired with a Quick Match player. A player in both `Lob_41` and
  `Lob_39` is a co-op player.
- **Record:** the YR Quick Match record with the co-op map, concrete country and colour, speed 6, and team `1` for
  both humans (allied). The cooperative campaign line is **not sent**: its format on the wire is not known. The
  server logs `quick co-op record: ...` for each match, to compare with a real client.
- **Shim:** `src/web/wolapi.c` already passes `Lob_39_` for the YR edition.

To do the capture (P9): start the server with `YR_COOP_ENABLED=true`, add a co-op mission to the pool, press Quick
Co-op in two YR clients, and read `server.log`. Expected failures to watch: "scenarios do not match" (map size or digest
wrong) or the clients loading a Quick Match game instead of co-op (the record needs the cooperative setup).
