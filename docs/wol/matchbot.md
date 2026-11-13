# The matchbot

How the server's matchmaking agent behaves: what it accepts, how it queues and
pairs, and every message it sends to players. Line formats and the tag list are
in [protocol.md](protocol.md); the retail Yuri's Revenge side is in
[quick-match.md](quick-match.md).

Source: `ra2web/server/src/matchmaking/MatchmakingBot.ts` (queue and match
start), `matchmaking/pairWindow.ts` (rating window),
`protocol/qmCodes.ts` (request and reply names), `WolServer.ts` (routing).

## What it is

A virtual user, not a connection. `privmsg matchbot :<request>` is routed by
`WolServer` to `MatchmakingBot.handleMessage`. Replies are `PRIVMSG` lines
from `matchbot`:

```
:matchbot!matchbot@local PRIVMSG <nick> :<reply>
```

Only the Quick Match lobbies (`#Lob_40_0` for YR, `#Lob_35_0` for RA2) list it in the names list, as
`@matchbot,0,0,0`, because the retail client looks for an operator there.
Other lobbies work without it appearing.

## Requests it handles

| Request | Effect |
|---|---|
| `Match <tags>` | Queue for a 1v1 in the queue of the lobby you are in |
| `MatchWDT <tags>` / `WDT <tags>` | The same, with a World Domination side and territory |
| `Stats` | Replies `Stats <waiting>,-1` |
| `ListQueues` | Replies `QueueList` |
| anything else (`Pings ...`) | Ignored |

## Which queue

The queue is chosen by the lobby channel the player is in (`#Lob_<type>_0`),
not by a tag. No lobby gives `Unavailable`.

| Lobby type | Queue |
|---|---|
| 40 | Retail YR native 1v1, SKU 18688, ranked unless `RKD=0` |
| 50 / 51 | Web 1v1 / 2v2 (SKU 16640) |
| 60 / 61 | Web Yuri 1v1 / 2v2 (SKU 18688) |
| 35 | RA2 retail Quick Match (queue 135, native 1v1, SKU 16640, ranked unless `RKD=0`) when the request has no `VRS` and the WDT screen is not up (no `wdtarmed`); otherwise World Domination |
| 38 | World Domination (native, never ranked) |

## Admission checks, in order

1. Already queued: `AlreadyQueued`.
2. No lobby: `Unavailable`.
3. A web `VRS` in the retail lobby: `Badvers`.
4. A `VRS` that fails the version check: `Badvers`.
5. A configured mod hash that does not match: `Badhash`.
6. The queue already holds 8: `RateLimited`.
7. Otherwise the entry is queued and the player gets `Working`.

The client family comes from `VRS` (native `1.00x`, web `0.83`, none is
"unknown"), except in the lobby-40 and World Domination queues where the channel
decides it. Ranked needs a known family; native ranked also needs
`NATIVE_RANKED_ENABLED`, a solo player and a 1v1 queue.

## Pairing

`tryMatch` runs when someone joins a queue and again every 2 seconds while a
ranked queue has waiters.

- Entries of different families never pair. Two "unknown" ranked entries never
  pair.
- **Ranked** entries pair by closest rating, within a window that grows with the
  wait: 120 points to start, plus 40 per second up to 30 seconds (1320), and any
  two compatible entries after 60 seconds. They must share SKU and ladder type.
- **Unranked** entries pair first-in-first-out.
- World Domination and other legacy queues are first-in-first-out within a family.

## What happens after a pair

1. Both players are told at once: `Matched 10` (web and World Domination), or in
   the retail lobby 40 `Match found! Your opponent is <name>.` followed by
   `Game begins in 10...`, `9...` down to `1...`, one a second.
2. The room `#matchbot's game <n>` is created. The first matched player is the
   room host (channel operator), because the retail client only accepts the
   start signal from an operator.
3. A gserv instance is created with a ticket per player. A ranked pair is
   admitted to settlement; if admission fails the match is played unranked. If
   no gserv is available both players get `Requeue` instead.
4. After the 10 second countdown:
   - the host's `JOIN` goes to both players, the guest's only to the guest,
   - then a names list and a `GAMEOPT` slot table `L<name>,...,@Closed@...`,
   - then it waits up to 4 seconds (polling every 200 ms) for the host client to
     publish its own options and otherwise uses the server's record,
   - then it sends the options to everyone, again to each player from the other's
     identity, and finally one `STARTG` per player with that player's ticket.
5. The clients connect to the gserv with their tickets (see
   [protocol.md](protocol.md), "After the match is made").

## Every message a player can receive

| Message | When |
|---|---|
| `Working` | A valid `Match` was queued (also each party member, and a party's first ready member) |
| `Matched 10` | A pair was found |
| `Requeue` | No gserv, or a matched player left before the start (web and WDT; lobby 40 gets a sentence) |
| `Badvers` | Bad version, a web build in lobby 40, a mixed-family party, a bad WDT side or territory |
| `Badhash` | The mod hash does not match |
| `Unavailable` | No queue lobby, or World Domination is not configured |
| `RateLimited` | The queue is full |
| `AlreadyQueued` | The nick is already queued |
| `Stats <n>,-1` / `QueueList` | Answers to `Stats` / `ListQueues` |
| game-room lines | `JOIN`, names, `GAMEOPT`, `STARTG` after the countdown |

### Retail Quick Match lobby (40): plain sentences

The retail dialog prints each message as `matchbot : <text>`, with a dot added each
second to the last line (its own waiting animation). So in lobby 40 the bot
speaks in sentences (`matchmaking/nativeMessages.ts`) instead of the words above:

| When | Text |
|---|---|
| After the request | `Working`, then `Welcome to Quick Match (Yuri's Revenge, 1v1).` |
| Searching, nobody else | `No other players are searching right now. Waiting for an opponent...` |
| Searching, others in the queue | `Searching for an opponent. <n> other players in the queue...` |
| Every 15 s while waiting | `Still searching. ...` with the current count |
| Pair found | `Match found! Your opponent is <name>.` then `Game begins in 10...` to `1...` |
| Opponent left during the countdown | `Working` again (restarts the client's 180 s timer), then `Your opponent left. Searching for a new opponent...` |
| Already queued / queue full | `You are already searching for a match.` / `The queue is full. Try again in a moment.` |

No sentence may start with a word the game's own parser acts on (`Exit`, `Fail`,
`Working`, `Info `, `Pool `, `Start `, `need `, `ack`, `nack`, ...); a test
(`nativeQuickMatch.test.ts`) checks that. Web and World Domination queues are
unchanged.

Not sent:

- A reply when a player leaves a waiting queue (parts the lobby or disconnects).
  The entry is dropped silently; `Removed` exists in `qmCodes.ts` but is never used.

## Leaving

`removeFromQueue` runs on disconnect and on leaving the lobby.

- A waiting entry is removed.
- Leaving **during the countdown** cancels the match: the countdown and ticker stop
  (no `STARTG` follows), the game room, the gserv instance and the ranked
  admission are dropped (no history row), and the remaining solo native player
  goes back to the queue with their original wait time. A web player gets
  `Requeue` and is released.
- Once `STARTG` is sent the match belongs to the gserv and the ladder; a
  disconnect only releases the queue entries.

## Constants

| Constant | Value |
|---|---|
| Countdown | 10 s (`MATCH_COUNTDOWN_SECONDS`) |
| Recheck while waiting | 2 s (`RANKED_RECHECK_MILLIS`) |
| Host options wait | up to 4 s, polled every 200 ms |
| Queue limit | 8 entries per queue |
| Rating window | 120 base, +40 per second, capped at 30 s, unlimited after 60 s |

## Known gaps

- **The retail dialog gives up 180 s after a `Working`** ("Error : Timed out waiting for
  game start"; the game sets a 180 second counter in its `Working` handler, gamemd
  `0x7A1838`). A player alone in the queue is timed out by their own client; the server
  does not know. A requeue after an opponent leaves sends `Working` again to restart it.
  Sending `Working` periodically while someone waits would keep the search open longer;
  that is not done.

- Lobbies other than 40 still get no progress messages while waiting.
- The 10 second countdown is fixed and applies even when both players are ready.
- If no gserv is available at match time, the entries are left as they were and
  the players get `Requeue`; they are not put back in the queue.
- The host's options win over the server's only if the host publishes within
  4 seconds; otherwise the server's record (YR `XMP29U2`, RA2 `MP32S8`) is used.
- Parties (`party_*`) are only for the web 2v2 queue; the retail client never
  forms one.
