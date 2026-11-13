# Quick Match (retail Yuri's Revenge and Red Alert 2, native)

How the retail Yuri's Revenge "Quick Match" button finds a game on the RA2Web
server, what the server does about it, and what is verified. The line formats are
in [protocol.md](protocol.md); the ranked rules are in
[shared-ranked-server.md](shared-ranked-server.md).

Status: **works end to end for the YR client in this repo** (checked 13 Nov 2026
with two driven clients, then played out by a person: pending, then scored). Not
verified: a retail install that is not the recomp, `FINI=0`, a real map pool,
Red Alert 2's own Quick Match, and lobby 39.

## What the game does

The handler is gamemd `0x79FC40` (lifted as `sub_0079FC40`). In order:

1. **Request the type-0 channel list** (`list 0 0`).
2. **Look for a lobby named `Lob_40_*`.** It wants `Lob_39_*` instead when the
   lobby mode word at `0xA8B244` is 2. No entry means the dialog ends with
   "Matching Server Not Found". This was the failure before the server published
   the lobby.
3. **Join it** (`join #Lob_40_0 zotclot9`).
4. **Wait for the user list** and require at least two users, one of them with
   the operator flag. That user is the matching agent. `@matchbot` in the names
   list is what satisfies it.
5. **Send the request:**
   `privmsg matchbot :Match COU=-2, COL=-2, MBR=1, LOC=2, RAT=5, RES=640, ADR=-1, NAT=1, PRT=1257`
   and report pings as `Pings <user>,<ms>;`.
6. Wait for `Working`, then `Matched <seconds>`, then the game room's `JOIN`,
   `GAMEOPT` and `STARTG`, like a custom match.

The request carries **no `VRS` and no `RKD`**. That matters for ranking
(below).

## What the retail client understands back

The reply parser is `sub_007A16B0` (gamemd `0x7A16B0`, `recomp_0056.c`). It
compares the text of each private message from the matchbot with `strnicmp`, in
this order:

| Reply | What the client does |
|---|---|
| `Fail` | Error text `WOL:MatchFail`, ends the dialog (host-flag only) |
| `PingFail`, `RankFail`, `WDTSideFail` | `WOL:MatchFailPing` / `MatchFailRank` / `MatchFailWDTSide`, ends |
| `Exit` | `WOL:MatchFailExit`, ends |
| `Working` | Shows `GUI:MatchingProgress2` (the searching text) |
| `Info <text>` | Parser shows `<text>` in the dialog (but see below: the dialog also prints the raw message) |
| `Pool <n>` | Shows `WOL:MatchingPlayerPool` with `n` (players in the pool) |
| `Start <gameopt>` | The original "create the game now" command: copies the options and fires the start callback. The server does not use it |
| `ack`, `nack`, `need <nick>,...` | The ping exchange (`Pings <nick>,<ms>;` goes back) |
| anything else | Shows `WOL:MatchUnknownServerCommand` |

So the words in [protocol.md](protocol.md)'s reply table (`Matched`, `Requeue`,
`Badvers`, ...) are RA2Web's own. The web client reads them. What the retail
dialog does with any other text, seen on screen: it prints the message as
`matchbot : <text>`, and adds a dot to the last line each second (its own waiting
animation). So a retail player can be told anything with a plain sentence, as long
as it does not start with a word in the table above. Lobby 40 does exactly that
([matchbot.md](matchbot.md)).

**The `matchbot : ` prefix cannot be removed or changed** (tried 14 Nov 2026):

- `Info <text>` does not print bare. The dialog showed `matchbot : Info <text>`, so the
  generic line printer shows the whole message, `Info ` included, and runs apart from
  the reply parser above.
- Renaming the bot (`MATCH_BOT_NAME=QuickMatch`) broke Quick Match: the client joined
  the lobby but its request never reached the server, so it must send to the literal
  name `matchbot`. Keep the default.

The client also owns welcome strings (`STT:WOLWelcomeQuickMatch`,
`STT:QuickCoop`); those are its own text, not sent by the server.

## What the server does

| Piece | Where | Behaviour |
|---|---|---|
| Lobby | `WolServer.ts` (`handleList`) | `#Lob_40_0` is created on the first `list 0`, so it is listed even with nobody in it |
| Matching agent | `WolServer.ts` (`sendChannelNames`) | The names list of that channel starts with `@matchbot,0,0,0` |
| Request | `MatchmakingBot.ts` (`handleMatch`) | Channel type 40 is a native 1v1 queue on SKU 18688 |
| Family | same | The channel decides it, since the request has no `VRS`. Native and web entries never pair |
| Ranking | same | Ranked unless the request says `RKD=0` or `NATIVE_RANKED_ENABLED` is off |
| Web client in the lobby | same | `VRS` there gets `Badvers`; it belongs in lobby 60/61 |
| Options record | `MatchmakingBot.ts` (`buildDefaultGameOpts`) | The YR layout with map `XMP29U2` (see the record in [protocol.md](protocol.md)) |
| Settlement | `Settlement.admit`, `/native-results` | The match is admitted when created (source `wol-native`); both clients report, and it scores when the reports agree |

The constants are `NATIVE_QUICK_MATCH_LOBBY` and `NATIVE_QUICK_MATCH_TYPE` in
`ra2web/server/src/protocol/qmCodes.ts`. The tests are
`ra2web/server/test/nativeQuickMatch.test.ts` (nineteen, all passing, RA2 included).

Lobby 39 is deliberately not published: the game only asks for it when its mode
word is 2, which no run here has produced.

## The shim

`src/web/wolapi.c` filters the channel list the game sees. For YR it passes
`Lob_39_` and `Lob_40_` as well as the main lobby (`Lob_41_`), so the Quick
Match lookup finds its entry while Custom Match still joins the main lobby. If none
of the game's own lobby prefix is listed, it falls back to the configured lobby.
This was added after the first filter hid lobby 40 and then broke Custom Match.

## Why the options record is the YR one

The first run paired two clients, then both left with "scenarios do not match".
The matchbot had used RA2's `MP32S8` record (size 194911). The YR client computes
its scenario checksum from its own map, so the record has to be the one the YR
game wrote itself. It was captured from a real YR custom match (`wol.mjs --start`)
and the matchbot now sends it for type 40:

```
1897192559,3,1,10000,10,1,1,1,1,1,1,0,<XMP29U2 in utf16le base64>,2,1,83573,XMP29U2.MAP,QaYxylVjm5IIPkbgtVUK9IscPYE=
  :<name>,-2,<idx>,-2,-2,ffffffff,0,0,...
  :@:0,-1,-1,-2,-2 (x8)
```

`XMP29U2` is a placeholder. A map pool is not built, so every Quick Match plays
that one map; the match only starts if both installs have it.

## Red Alert 2

RA2's handler (Game.exe `0x759FFF`, `recomp_0051.c`) does the same walk with other lobby
numbers: it wants `Lob_38_*` by default, and `Lob_35_*` only when the mode word at `0xA3D2A4` is 2
(the branch is `0x75A014`; the first version of this server published 35 and the dialog
still said "Matching Server Not Found"). Without a listed lobby the dialog said "Matching Server Not Found". What the server does:

- Publishes `#Lob_38_0` with `@matchbot` in its names list, like lobby 40 (`RA2_QUICK_MATCH_LOBBY`).
- World Domination uses lobby 38 as well, so the queue is chosen by the player, not the
  channel: a `Match` with no `VRS`, from a player whose WDT screen is not up (no `wdtarmed`
  or pending `wdtstart`), is Quick Match. It queues as type 135 (`RA2_QUICK_MATCH_TYPE`), native
  ranked 1v1 on SKU 16640, with its own queue. A `Match` carrying `VRS` or from a WDT-armed player
  stays World Domination.
- Uses the RA2 options record (`MP32S8`), speed field 0 (fastest).
- The shim passes `Lob_35_`/`Lob_38_` through its list filter for the RA2 edition (`wolapi.c`).
  Needs an RA2 rebuild.
- Lobby 35 is not published (mode word 2, never seen).
- First play-through (14 Nov 2026, two recomp RA2 clients): both queued as type 135, matched, STARTG
  and the relay worked, and the game ran. Both result reports were refused because the client's
  GSKU is 8448, not the World Domination 8960; the server maps it to SKU 16640 now. That match stays
  `pending`. Scoring after the fix is not seen yet.

## Side and colour

The request's `COU=` and `COL=` are the player's own WOL settings (`-2` is random). The game resolves
"random" in its pre-match dialog, which a server start skips, so a record that says `-2` shows the random
icon on the loading screen instead of a flag. The server writes concrete values instead
(`ra2web/server/src/matchmaking/nativeSides.ts`):

- A requested country in range is kept (RA2 0-8, YR 0-9); random or out-of-range becomes a random real country.
- A requested colour (0-7) is kept unless the first player holds it; others get the lowest free colour.
- It writes the side into the record's second field per player (YR and RA2 Quick Match only; World Domination
  records are unchanged). The server log line `quick match sides ...` shows what each player asked for.

Not checked: that `COU` uses the same numbering as the record's side field. It is the same `-2` for random,
so it should; read the log of a game where a player picked a country. The random start position (the
fourth field, `-2`) is left as it was.

## Game speed

Quick Match plays at speed 6, Fastest (60 ticks a second). The third field of the
options record is the speed as the game stores it, 6 minus the slider (1 is speed 5,
45 ticks a second; 0 is speed 6). The server sets it to 0 in its own record and again
in the final record, even when the host's client published a slower one, so both
players run at the same rate. The field's place comes from a record captured at speed 5
and from the server's replay reader; it is not traced in the game's code, so check it by
the game's frame rate. Custom rooms use the host's own slider
(`[WonlinePref] GameSpeed`).

## Ranking

Ranking cannot be decided from the request, which has no `RKD`. So for the
native lobby the default is **ranked** and a client has to opt out with `RKD=0`;
the retail one never sends that. The ranked flow:

1. The pair is admitted with `Settlement.admit` as `wol-native`, SKU 18688, a 1v1.
2. When the game ends each client posts its `GameRes` to
   `/native-results/{gameId}` ([protocol.md](protocol.md), "After the match is made").
3. The ladder scores it once both reports agree. One report alone stays
   `pending` until the grace window ends.

The 13 Nov run went `pending` to `scored` and moved the ratings (a 1v1 winner to
1030). Matches nobody reports stay `pending`; the local database has three from
testing.

## Run it yourself

The harness is in `web/e2e/`; see [../web/testing.md](../web/testing.md) for the
full commands.

```bash
cd web
NATIVE_RANKED_ENABLED=true node e2e/wol-server.mjs   # the ra2web server on :9090
```

Then start the page (`pnpm dev`, port 5173) and the YR edition in two browser
tabs or two profiles, and press Quick Match in each.

## Not verified

- **`FINI=0`.** What the retail client does when a game finishes without a
  result is not traced; the server scores whatever `FINI` the reports agree on.
- **Retail clients.** Only the recomp's lifted YR has played it. A real install
  that uses the original `wol.dll` is not checked.
- **A map pool.** One placeholder map.
- **Red Alert 2 end to end.** The server side is tested; the play-through is not (see
  "Red Alert 2" above).
- **Lobby 39** (mode word 2).
