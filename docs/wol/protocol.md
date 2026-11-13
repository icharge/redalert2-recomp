# WOL wire protocol

What the game, the recomp's WOLAPI shim and the RA2Web server say to each other
for Internet play. This is the reference for the lines; how a feature uses them
is in [quick-match.md](quick-match.md) (Quick Match) and
[handoff-wolapi.md](handoff-wolapi.md) (the shim and Custom Match).

Source of truth, in order: the server code (`ra2web/server/src/server/WolServer.ts`,
`protocol/wolCodes.ts`, `protocol/qmCodes.ts`, `matchmaking/MatchmakingBot.ts`),
the shim (`src/web/wolapi.c`), then the lifted game. Anything marked *not traced*
is observed on the wire but its meaning is not confirmed in the game.

## Layers

| Layer | Where | What |
|---|---|---|
| HTTP | `POST /register`, `POST /login` | Account and session token |
| WOL lines | `ws://host:9090` (browser) or `tcp://host:6667` (classic native gateway) | IRC-style text lines: login, lobbies, game rooms, matchbot |
| Gserv | `ws://host:9090/gserv` | After `STARTG`: ticket, then game datagrams relayed between the players |
| Results | `POST /native-results/{gameId}` | The finished match's `GameRes` packet |

The recomp page uses the WebSocket; `WolTcpGateway.ts` only adapts the same
`WolServer` to a TCP stream for a classic install. Accounts, channels and games
are shared by both.

Lines end in `\r\n`. Limits (server): 32 lines per frame, 16 KiB per line, a
per-connection rate bucket (exceeding it closes with 4008), and a ping timeout
(three ping intervals without a `PONG` closes with 4009).

## Login

```
POST /register  {"user":"alice","pass":"..."}   -> {"user":"alice","sessionToken":"..."}
POST /login     {"user":"alice","pass":"..."}   -> {"user":"alice","sessionToken":"..."}
                                                   or {"error":"...","errorCode":"..."}
```

Then on the line connection:

| Client sends | Server replies |
|---|---|
| `cvers <version> <sku>` | `700 * :ok` (version and SKU are recorded, not enforced here) |
| `setlocale <n>` | `310 * :ok` |
| `session <token>` | MOTD (`375`, `372`..., `376`), then a `PING <ms>`. A bad token, a banned account or an invalid nick gives `378 * :Invalid session token` |
| `getlocale <nick>` | `309 <nick> <nick> :0`<code>` (locale `0`, then the code, e.g. `0`en-US`) |

A second login for the same nick drops the first connection. Every command after
this needs a logged-in connection (otherwise `451 * :You must be logged in`).

### Ping

The server sends `PING <epoch-ms>`; the client must answer `PONG <epoch-ms>`
with the same value. The round trip becomes the user's ping (shown in lobbies, `0`
means not measured). A client that does not answer gets disconnected.

## Channels (lobbies)

A lobby is a channel named `#Lob <type> 0` (the game sends it escaped, below)
with the shared password `zotclot9`. Lobby channels are created on first join
and are never removed.

Channel names travel escaped: space is `_`, a literal `_` is `%_`, `%` is `%%`,
`:` is `%=`, `,` is `%-`, and `\b`/`\n`/`\r` are `%b`/`%n`/`%r`
(`lineCodec.ts: escapeChannelName/unescapeChannelName`). So `#Lob 40 0` is the key
`#Lob_40_0`.

| Client sends | Server replies / effect |
|---|---|
| `join <key> <password>` | Everyone in the channel gets `:<nick>!<host> JOIN :0,<ping>,<op>,<fresh> <key>` then a `353`/`366` names list. A wrong key gives `475`, a full channel `471`. Joining a channel you are already in answers only the JOIN line to you |
| `part <key>` | `PART <key>` broadcast, then a fresh names list |
| `names <key>` | `353` and `366` to the requester (`442` if not in the channel, `403` if it does not exist) |
| `list <type> <type>` | `321`, one `322` per entry, `323` |
| `privmsg <target>[,<target>] :<text>` | To a channel: relayed as `PRIVMSG` to the others. To a nick: relayed, or `401`. To `matchbot`: handled by the matchbot |
| `kick <key> <nick>[,<nick>]` | Operator only (`482` otherwise); `KICK` broadcast |
| `mode <key> +l<n>` | Operator only; sets the user limit (max 128), `MODE` broadcast |

### Names reply (`353`)

```
:wol-ra2web 353 alice = #Lob_40_0 :@matchbot,0,0,0 alice,0,1,1 bob,0,1,1
:wol-ra2web 366 alice #Lob_40_0 :End of /NAMES list.
```

Each entry is `[@]name,0,<ping>,<fresh>`. `@` marks a channel operator (in a game
room, the host). The game maps it to bit 0 of the user's flags, and **the
quick-match handler uses that bit to find its matching agent**. `fresh` is 1 for
a new account. Only `#Lob_40_0` (YR) and `#Lob_38_0` (RA2) list the virtual user
`@matchbot` (see [quick-match.md](quick-match.md)).

### Channel list (`322`)

```
:wol-ra2web 321 alice 0 :Channel Users Name
:wol-ra2web 322 alice <key> <users> 0 <type> <tournament> 0 <hostPing> <mode>::<topic> :0
:wol-ra2web 323 alice 0 :End of /LIST
```

Field positions (counting the nick as 0): `1` key, `2` users, `3` always `0`,
`4` channel type, `5` tournament flag, `6` resolution-locked flag, `7` host
ping, `8` `<mode>::<topic>` (mode `384` = password-protected, else `0`; the
topic is a comma-joined base64 blob and never contains a space), `9` the
trailing field (host muted).

`list 0 0` returns **every lobby channel** with type `0` and the user count in
field 2. `list <type> <type>` (for example `33`) returns the game rooms of that
channel type. The recomp's shim (`wolapi.c`) turns a `list 0` result into the
game's channel list and keeps only the lobbies it recognises
(`Lob_<WOL_LOBBY_TYPE>_` plus, for YR, `Lob_39_`/`Lob_40_`, and for RA2 `Lob_35_`/`Lob_38_`).

| Lobby type | Meaning |
|---|---|
| 33 | RA2 main lobby (`WOL_LOBBY_TYPE` for RA2; also the game-room type of an RA2 custom match) |
| 41 | YR main lobby (`WOL_LOBBY_TYPE` for YR; also the game-room type of a YR custom match) |
| 35, 38 | World Domination matching lobbies; lobby 38 is also the **RA2 retail Quick Match** lobby (queue type 135 inside the server) |
| 40 | **YR retail Quick Match** (native 1v1, ranked, SKU 18688) |
| 39 | YR Quick Match when the lobby mode word is 2; the server does not publish it |
| 50 / 51 | RA2Web (browser) Quick Match 1v1 / 2v2 |
| 60 / 61 | RA2Web (browser) Yuri Quick Match 1v1 / 2v2 |

## Game rooms

A custom match is a game room, created by the host and listed by type.

```
joingame <key> <mode> <slots> <type> <observe> <?> <tournament> <?> [password]
```

Eight or more arguments create the room; fewer join it (`joingame <key> 0
[password]`). `type` is the lobby type of the edition (33 or 41). The host
becomes the room operator. Everyone gets
`:<nick>!<host> JOINGAME 0 0 0 0 0 <ping> 0 :<key>` and a names list, and the joiner
also gets `GSERV <key> :<gserv-id> <gserv-url>`.

Errors: `478` game closed, `475` bad key, `471` full, `711` too many games
(one room per host).

| Line | Direction | Meaning |
|---|---|---|
| `gameopt <key> :<options>` | both | The room's options, see below. An empty `gameopt` asks the host's options; the server answers with the stored set |
| `gameopt <nick> :<text>` | both | A private option to one player (`R-2,-2,-2,-2,ffffffff,1,4e9` is the client's own player record) |
| `topic <key> :<text>` | both | Room topic, `WOLAPI2:<flags>;<type>,<seed>,0,0,0,<map>::` |
| `gping <key> <nick> <ms>` | client | Ping of one player to the host |
| `startg <key> <nick>[,<nick>]` | host | Start the game (host only, `482` otherwise) |
| `STARTG <key> :<gserv-url> :<gameId> <timestamp> <ticket>` | server | One per player, with that player's ticket |
| `STARTG_ABORT <key> :<reason>` | server | `1` no gserv available, `2` a named player is not in the room |

Short options are control messages: `K0` (kick/ready), `A0`/`A1`, `Z1;<nick>`,
`L<slots>` (the slot table), `R...` (private player record), `Q`-style status.
Only a long record starting with a digit or `-` is stored as the room's options.

### Game options record (`gameopt <key> :<record>`)

`<fields>:<players>:@:<ai>`. These are the records the retail game writes
itself; the matchbot reuses them so both peers compute the same scenario
checksum. A different layout gives "Not same scenario" and a leave
("scenarios don't match").

RA2 (captured from the retail custom match, `MP32S8`):

```
<seed>,1,0,10000,10,1,1,1,1,1,1,<title>,8,1,<size>,<map>,<digest>
  :<name>,<country>,<start>,<color>,0,0[,<name>,...]
  :@:0,-1,-1 (x8)
```

YR (captured from the retail custom match, `XMP29U2`):

```
<seed>,3,1,10000,10,1,1,1,1,1,1,0,<title>,2,1,83573,XMP29U2.MAP,QaYxylVjm5IIPkbgtVUK9IscPYE=
  :<name>,<country>,<start>,-2,-2,<color>,0,0[,<name>,...]
  :@:0,-1,-1,-2,-2 (x8)
```

The YR record has one extra option field before the title, eight-field player
records and five-field AI records. Field meaning is *not traced* beyond the
names above (`size` is the map file size, the last field its digest). The
scenario-identifying fields are 12-17 (`title,slots,official,size,map,digest`);
the server ignores a non-host client's options that differ there.

## Matchbot

`privmsg matchbot :<request>` is handled by the server, not a person. It is not
a channel member except in the Quick Match lobby's names list. Replies come as
`:matchbot!matchbot@local PRIVMSG <nick> :<reply>`.

| Request | Meaning |
|---|---|
| `Match <tags>` | Queue for a 1v1; see the tags below |
| `MatchWDT <tags>` | The same from the World Domination screen (`WDS=`, `WDT=`) |
| `Stats` | `Stats <waiting>,-1` |
| `ListQueues` | `QueueList` |
| `Pings <nick>,<ms>;...` | The retail client's ping report; ignored |

These replies are RA2Web's own words, read by the web client. The retail client
only knows `Working`, `Info <text>`, `Pool <n>`, `Start`, `Fail`, `Exit` and a few
more, and treats the rest as unknown; see
[quick-match.md](quick-match.md#what-the-retail-client-understands-back).

| Reply | Meaning |
|---|---|
| `Working` | Queued, looking for an opponent |
| `Matched 10` | An opponent was found; the game room opens after this many seconds |
| `Requeue` | The match fell apart (an opponent left, no gserv): back to the queue |
| `Badvers` | The version tag is not accepted (a web build in the retail lobby, a wrong ranked patch) |
| `Badhash` | The mod hash tag does not match `expectedModHash` |
| `Unavailable` | The queue mode is not available (no matching lobby, no WDT service) |
| `RateLimited` | The queue is full (8 entries) |
| `AlreadyQueued` | The nick is already queued |

Leaving the queue (parting the lobby or disconnecting) sends nothing; the entry
is dropped silently. A `Removed` constant exists in `qmCodes.ts` but is never
sent. Leaving after `Matched` cancels the match and sends `Requeue` to everyone
in it, including the player who left if still connected.

### Match tags

Tags are separated by `, ` (the retail client leaves a trailing comma on each
but the last).

| Tag | Source | Meaning |
|---|---|---|
| `COU`, `COL` | both | Country and colour (`-2` is random) |
| `VRS` | RA2Web only | Client version (`0.83.x`; retail `1.006` is accepted too) |
| `MOD` | RA2Web only | Mod hash, checked when the server sets one |
| `RKD` | RA2Web only | `1` asks for a ranked game. The retail client never sends it (see [quick-match.md](quick-match.md)) |
| `WDS`, `WDT` | World Domination | Side and territory |
| `MBR`, `LOC`, `RAT`, `RES`, `ADR`, `NAT`, `PRT` | retail only | Sent as `MBR=1, LOC=2, RAT=5, RES=640, ADR=-1, NAT=1, PRT=1257` (`RES` was `1280` at a 1280 wide client). *Not traced*; the server ignores them |

## After the match is made

1. `Matched 10`, then after the countdown the server publishes the game room
   `#matchbot's game <n>` to the two players only: the host's `JOIN` goes to both,
   the guest's only to the guest (a second copy would pair the guest with itself),
   then `353`, a `GAMEOPT L<slots>` slot table, the options, and `STARTG`.
2. The matchbot waits up to four seconds for the host client to publish its own
   options; otherwise it sends its fallback record. The host is the first
   matched player.
3. Each client connects to the gserv URL and presents the ticket: `ticket <t>`
   answers `ok <virtual-ip>` or `error <reason>`. Datagrams then relay as binary
   frames: client to relay `dstIp[4] srcPort[2] dstPort[2] payload`, relay to
   client `srcIp[4] srcPort[2] dstPort[2] payload` (network order, 1500 bytes
   max). The virtual IP is derived from the nick (FNV-1a, `10.x.y.z`) the same way
   in `wolapi.c` and `NativeRelay.ts`.
4. When the game ends each client posts its `GameRes` packet to
   `POST /native-results/{gameId}` with `Authorization: Bearer <sessionToken>`.
   The packet carries `IDNO GSKU TRNY OOSY FINI DURA ... SCEN PLRS ...` tags; the
   wire `GSKU` is 8960 (RA2) or 10496 (YR), mapped to the ladder SKUs 16640 and
   18688. A ranked match is scored once both players' reports agree.

See [shared-ranked-server.md](shared-ranked-server.md) for the ranked side.

## Error numerics

| Code | Name | Code | Name |
|---|---|---|---|
| 309 / 310 | get / set locale | 421 | unknown command |
| 321 / 322 / 323 | list start / entry / end | 442 | not on channel |
| 326 / 327 | game channel / channel | 451 | not logged in |
| 332 | topic | 461 | need more parameters |
| 353 / 366 | names / end of names | 471 / 475 | channel full / bad key |
| 372 / 375 / 376 | MOTD | 478 | game has closed |
| 378 | bad session | 482 | not channel operator |
| 401 / 403 | no such nick / channel | 700 / 701 / 702 | cvers ok / outdated / unknown |
| 711 | rate limit exceeded | 720 / 721 | login queue / server full |
| 730 | game report | 731 | party update |

Party commands (`party_invite`, `party_accept`, `party_decline`,
`party_leave`, `party_prevent`, `party_status`, `party_noinvites`) belong to the
RA2Web 2v2 queue and are not used by the retail client.

## From a game call to a line (the shim)

`wolapi.c` implements the game's WOLAPI COM objects; each call becomes one line.

| Game call | Line |
|---|---|
| request channel list, type `n` | `list n n` |
| create game | `joingame <name> 1 <slots> <type> 0 0 0 0[ <password>]` |
| join channel (`Lob_...`) | `join <name> zotclot9` |
| join game | `joingame <name> 0[ <password>]` |
| leave channel | `part <current>` |
| refresh users | `names <current>` |
| chat | `privmsg <targets> :<text>` |
| set game options | `gameopt <current> :<options>`; to one user `gameopt <user> :<text>` |
| set game topic | `topic <current> :WOLAPI2:...` |
| set user limit | `mode <current> +l<n>` |
| start game | `startg <current> <nick>,...` |
| locale of a user | `getlocale <nick>` |
