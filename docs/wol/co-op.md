# Quick Co-op (Yuri's Revenge): research and design

Status of 14 Nov 2026: **researched, designed, not implemented on a real client**. The retail
client has the button; the server has no queue for it. Evidence is from the lifted gamemd and from
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
2. **A queue of its own** (type, say, `41` for YR co-op) so a co-op player is never paired with a
   Quick Match player. The queue is chosen by the lobby, like lobby 40 and 38.
3. **Unranked.** A co-op game is two humans against the computer; there is no loser to rate. If it is
   ever ranked, it would be a "co-op clear time" board, not Elo (decision below).
4. The options record must name a map the **cooperative mode** accepts. The host overrides the map
   with its own first Allied co-op mission, so the exact name matters less than that the record's
   size/digest pass the joining client's check. Use the same rule as the Quick Match pool
   (size = file length, digest = the map's `[Digest] 1=`).

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
Lob_39 join -> Match (no VRS) -> queue "yr-coop" (type 41, unranked, 2 players)
            -> pair -> record with the co-op map, tournament 0, cooperative line
            -> Matched -> STARTG as in Quick Match
```

| Piece | Where | Notes |
|---|---|---|
| Lobby | `WolServer.handleList` | `COOP_QUICK_LOBBY = 39`, same code path as lobby 40 |
| Queue | `MatchmakingBot` | new type `41`, `ranked=false`, no `Settlement.admit` |
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
