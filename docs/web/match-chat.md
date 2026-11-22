# In-match chat: addresses for a browser chat panel

What a page-side chat panel needs from the game to show player chat during a
multiplayer match (LAN, GameMode 3, or online, GameMode 4) and to send chat
from the panel. Both editions. Built as described in "What is built" at the end.

Method: VERA20K's notes (`src/ui/messages.rs`, `src/app/input/chat.rs`,
`src/net/lan_messages/ingame.rs`) gave the Yuri's Revenge leads. Every
address below was then read in the lifted C (`src/recomp/gen`,
`src/recomp/gen_game`) or disassembled from `game/gamemd.exe` /
`game/game.exe`. The Red Alert 2 addresses come from matching byte patterns
(`push 0x4046`, `sub esp, 0x890`, `ecx = MessageList`) and were then
disassembled. **Verified** means the instructions were read in both editions.

## Shared state

| What | YR (`gamemd.exe`) | RA2 (`game.exe`) | Verified |
|---|---|---|---|
| `MessageListClass` instance (`ecx` for all its methods) | `0x00A8BC60` | `0x00A3DC70` | yes, every call site uses it |
| list +0x19: edit line open (byte) | `0x00A8BC79` | `0x00A3DC89` | yes (pre-hook tests it) |
| list +0x28: edit buffer, wide (162 units to +0x16C) | `0x00A8BC88` | `0x00A3DC98` | yes (`GetEditBuffer`) |
| list +0x16C: overflow chunk, wide (to +0x2B0, 162 units) | `0x00A8BDCC` | `0x00A3DDDC` | yes (Input writes it, the send reads it) |
| list +0x2B0 index / +0x2B4 start (prefix length) | `0x00A8BF10` / `0x00A8BF14` | `0x00A3DF20` / `0x00A3DF24` | yes |
| chat target (0 none, 1 listeners, 2 allies, 3 all) | `0x00ABCE18` | `0x00A6EBE0` | yes |
| chat "listen" mask, byte per House index (8) | `0x00A8D108` | `0x00A3F118` | yes (read by the send) |
| `SessionClass` / GameMode dword | `0x00A8B238` | `0x00A3D298` | yes |
| Session local colour (priority index) | `0x00A8B394` | `0x00A3D3B4` | yes |
| Session observer/defeated dword (Session+0x300) | `0x00A8B538` | `0x00A3D548` | yes |
| Session colour index to ColorScheme index (thiscall, 1 arg) | `0x0069A310` | `0x006715D0` | yes |
| Rules pointer; `MessageDelay` (double, minutes) at | `[0x008871E0]+0x14C0` | `[0x00839848]+0x1128` | yes; times 900.0 (`0x007E27F8` / `0x0079B608`) gives frames |
| HouseClass array items / count | `0x00A8022C` / `0x00A80238` | `0x00A3229C` / `0x00A322A8` | yes |
| House UI name, wide, at House+ | `0x1602A` | `0x15F16` | yes |
| Packet buffer, 455 bytes (sent and received) | `0x00A8D638` | `0x00A3F640` | yes |
| copy of the last chat line, wide (reason unread) | `0x00A8D112` | `0x00A3F122` | yes (written after echo and receive) |
| IME queue, wide, drained into the edit every frame | `0x00B730EC` | `0x00B25F7C` | yes |
| IPXManagerClass | `0x00A8E9C0` | `0x00A40978` | yes |

GameMode: 0 campaign and 5 skirmish have no chat; 1/2 modem/serial use packet
`0x68` (not ours); 3 LAN and 4 online use packet `0x0C` below.

## 1. The message list add

`MessageListClass::Add_Message`, YR `0x005D3BA0`, RA2 `0x005B4DA0`. Same
bytes at the head in both: `sub esp, 0x14c`, the same argument reads, `ret 0x1c`.

```
TextLabelClass *__thiscall Add_Message(MessageListClass *this /* ecx */,
    const wchar_t *name,    /* NULL: no prefix; else the row is name + L":" + text */
    int id,                 /* chat passes the sender's colour index here */
    const wchar_t *text,    /* NULL returns 0 */
    int scheme,             /* ColorScheme index */
    int style,              /* TextPrintType: 0x4046 chat lines, 0x16 grey system rows */
    int timeout,            /* frames; MessageDelay * 900; -1 never */
    bool silent);           /* 0 plays the insert sound */
```

- Verified: arguments at `[esp+0x160..0x178]` after the 0x14C frame and four
  pushes; `[esp+0x168]` (text) null-checked first; arg 5 is passed to the font
  lookup (`0x004A60D0` / `0x00497A50`); the name is `wcscpy`'d and `L":"`
  (`0x008306A4`) appended. All strings are `wchar_t` (UTF-16): the callers use
  `wcscpy` `0x007CA489` (YR) / `0x00783689` (RA2).
- A row holds at most 161 units; the fitter cuts at 0x6F (111) units or the
  pixel width and adds the rest as more rows, silently.
- 63 callers in YR, 42 in RA2: chat, system messages, subtitles, the WOL
  page in a match. Hook a caller, not the function, to tell chat apart.

### Thai text

In-match text is CP874 bytes widened to UTF-16 units U+00A1..U+00FB, the
same convention the Thai font hook uses (`src/runtime/thai_font.c`: marks
`0xD1`, `0xD4..0xDA`, `0xE7..0xEE`). Verified in both editions:

- typing: Input (`0x005D4510` / `0x005B56F0`) takes the key's byte from
  KeyToASCII and widens it with `and ebx/eax, 0xff`. The browser's
  `ra2_input_text` makes the bytes from Unicode (`cp874_character` in
  `src/web/presenter.c`: U+0E01..U+0E3A to 0xA1..0xDA, U+0E3F to 0xDF,
  U+0E40..U+0E5B to 0xE0..0xFB);
- on the wire and on receive the units are copied unchanged (`wcscpy`).

A panel converts unit `u` in 0xA1..0xFB to U+0E00 + (u - 0xA0) when the
player's codepage is Windows-874, and back when it sends. With Windows-1252
the same units are Latin-1. The sender name is ANSI in the packet and is
widened byte by byte (`0x00735120` / `0x006FA180`; narrowing `0x007350C0` /
`0x006FA120` keeps the low byte of each unit).

## 2. Receiving player chat

`Network__ProcessGlobalPackets`, YR `0x0048D1E0`, RA2 `0x00482110`, reads one
global message into the packet buffer (`0x00541370` / `0x00525AB0`;
product id `0xAA04` YR, `0xAA03` RA2) and switches on `kind - 0x0A`
(table YR `0x0048DB44`/`0x0048DB10`, RA2 `0x00482A70`/`0x00482A3C`). Kind
`0x0C` goes to:

| Step | YR | RA2 |
|---|---|---|
| chat case start | `0x0048D8DD` | `0x00482807` |
| game-name hash filter: flag byte, name, hash fn | `0x00A8D60D`, `0x00A8D610`, `0x005DAC00` | `0x00A3F615`, `0x00A3F618`, `0x005BBA50` |
| online relay filter (`[relay flag]`, mask at packet+0x2F) | `0x0048D8FC` (`0x00A8DBA0`) | `0x00482826` (`0x00A3FBA8`) |
| passed both filters | `0x0048D92B` | `0x00482855` |
| `call Add_Message` | `0x0048D979` | `0x004828A3` |
| IncomingMessage sound, last-line copy, then `jmp` out | `0x0048D97E..0x0048D9B8` | `0x004828A8..0x004828E2` |

The call is `Add_Message(widen(packet.name), packet.colour, packet.text,
Session_ColourToScheme(packet.colour), 0x4046, MessageDelay*900, 0)`.
Only player chat passes here: system rows ("X has left", observer refusal,
WOL pages) come from other callers. A hook after the call (C after the
`call` line, as `bare_page_patches` does) has, in flat memory:

- name: ANSI, `0x00A8D63C` / `0x00A3F644` (packet+4, 20 bytes);
- text: UTF-16, `0x00A8D668` / `0x00A3F670` (packet+0x30, up to 111 units + NUL);
- colour: dword `0x00A8D748` / `0x00A3F750` (packet+0x110, the sender's Session colour index).

The packet has no House index. The send matches a connection's name with the
House UI name (House+`0x1602A` / `0x15F16`); a panel can match the same way, or
show the name and colour only.

## 3. Sending

There is no send function. The send is inline in the in-game key pre-hook,
YR `0x0055E420`, RA2 `0x00540C20` (`sub esp, 0x890`; thiscall, `ecx` = the
key's int*). `Process_Command` (YR `0x0055DEE0`, call at `0x0055DEE8`; RA2
call at `0x005406E8`) calls it once per main-loop frame while the game has
focus, key 0 included.

| Step | YR | RA2 |
|---|---|---|
| drain the IME queue into Input | `0x0055E42C..0x0055E465` | `0x00540C2C..0x00540C65` |
| `mov edx, [ebp]` (the key; 0 leaves) | `0x0055E46C` | `0x00540C6C` |
| open: GameMode not 0/5, edit closed, key is Enter/`\`/Backspace (KeyToASCII `0x0054F450` / `0x00532720`) | `0x0055E477..0x0055E4C3` | `0x00540C77..0x00540CC3` |
| prefix `TXT_FROM` + own House UI name, target set (Enter 1, `\` 3, Backspace 2) | `0x0055E519..0x0055E57E` | `0x00540D19..0x00540D7E` |
| AddEdit(scheme, 0x4046, prefix, cursor 0, -1) | `0x0055E5B4` (`0x005D4210`) | `0x00540DB4` (`0x005B5410`) |
| beacon branch instead (own beacon selected: `TXT_BEACON_MESSAGE`, hidden edit) | `0x0055E4F0` | `0x00540CF0` |
| Input(&key, unit) for this frame's key, result in `edi` and `[esp+0x10]` | `0x0055E61F` (`0x005D4510`) | `0x00540E1F` (`0x005B56F0`) |
| results 3 (Enter) and 4 (overflow chunk) go on; mode dispatch | `0x0055E739..0x0055E775` | `0x00540F39..0x00540F75` |
| own beacon selected: text becomes the beacon label | `0x0055E77B..0x0055E7AE` | `0x00540F7B..0x00540FAE` |
| `cmp GameMode, 4` (online: `/page`, `/r`, ... first) | `0x0055E7B3` | `0x00540FB3` |
| send block (packet build, routing, send, echo) | `0x0055EDBF..0x0055F110` | `0x005415BF..0x00541910` |
| result 3 clears the target | `0x0055F1BD` | `0x005419BD` |

The send block:

1. kind `0x0C` at packet+0; the local node's name narrowed to packet+4
   (`[[0x00A8DA78]]` / `[[0x00A3FA80]]`); Session colour to packet+0x110;
   game-name hash to packet+0x114; relay byte packet+0x2F = 0.
2. text to packet+0x30: result 3 from `GetEditBuffer` (`0x005D4400` /
   `0x005B55E0`: `this+0x28 + start*2`), result 4 from the overflow chunk
   (+0x16C), which is then cleared.
3. observer gate: when Session+0x300 is set and the target is 1 or 2 with a
   House outside it, a silent `TXT_OBSERVER_CANT_SEND` row and target 0.
4. for each Multiplay House inside the target (1: mask byte set; 2: allied;
   3: all) and each IPX connection whose name equals the House's UI name:
   `Send_Private_Message(packet, 0x1C7, ack 1, id)` (`0x005410F0` /
   `0x00525830`), then service (`0x00541820` / `0x00525F60`). Online with the
   relay flag, connections OR a relay mask in and one global message goes out.
5. local echo: `Add_Message(widen(packet.name), packet.colour, packet.text,
   scheme, 0x4046, MessageDelay*900, 0)` at YR `0x0055F0F5`, RA2 `0x005418F5`,
   whether or not anything was sent. The target dword is still set here.

### Sending from the panel

Three ways, in the order recommended:

1. **A lift patch in the pre-hook (recommended).** After `0x0055E46C` (YR) /
   `0x00540C6C` (RA2), which only `sub_0055E420` / `sub_00540C20` contain:
   when the host has a line queued and GameMode is 3 or 4, copy the text
   (UTF-16, at most 111 units, CP874-widened for Thai) to the overflow chunk
   (`0x00A8BDCC` / `0x00A3DDDC`), set the target dword to 1/2/3, set
   `edi = 4; ebp = 4; ebx = 0; MEM32(esp + 0x10) = 4;` and
   `goto L_0055E7B3` / `goto L_00540FB3`. That is the game's own path for
   result 4: online commands in mode 4, then the send block and the echo;
   result 4 leaves the target as set (an opened edit sets it again).
   Jumping to `0x0055E739` / `0x00540F39` instead keeps the beacon branch.
   It works while the edit line is open too (the chunk is separate from the
   edit buffer). Run `run_lift.py --target gamemd --check` after: an edit
   to `run_lift.py` needs both editions lifted again.
2. **Call the fragment.** The lift has entries at the send block
   (`sub_0055EDBF`, `sub_005415BF`) because jumps land there, but they expect
   the pre-hook's 0x8A0-byte frame (locals, four saved registers, the
   return) and end with `add esp, 0x890; ret`. Doable with a fabricated frame;
   more fragile than 1.
3. **Drive the game's edit.** Inject the opening key (Enter, Backspace or
   `\`; Home and End too, mapped before modifiers), put the units in the IME
   queue (`0x00B730EC` / `0x00B25F7C`, NUL-terminated, drained at the next
   frame into the open edit), then inject Enter. The edit caps the line at 97
   typed units (Init MaxChars `0x62`: YR `0x00684ABB`, RA2 `0x0065CC73`) and by
   pixel width, and Enter adds a space when under 97. The queue's capacity
   was not checked.

### Local echo hook

C after the call at `0x0055F0F5` / `0x005418F5`: same packet fields as a
receive, and the target dword (`0x00ABCE18` / `0x00A6EBE0`) says all, allies
or listeners. `sub_0055EDBF` and the other fragments (YR: 12 more functions,
RA2: 11 more) contain this call too; `apply_patches` patches every function
body that reaches the address, so the patch lands in each.

## 4. The packet on the wire

455 bytes (`0x1C7`), one global message per recipient connection, sent with
ack. Fields (VERA `lan_messages/ingame.rs`; offsets checked in the send block):

| Offset | Size | Field |
|---|---|---|
| +0x00 | 4 | kind `0x0C` |
| +0x04 | 20 | sender name, ANSI, NUL-terminated (19 bytes) |
| +0x2F | 1 | relay mask (online relay only) |
| +0x30 | 0xE0 | text, UTF-16LE, NUL-terminated: 111 units at most |
| +0x110 | 4 | sender's Session colour index |
| +0x114 | 4 | hash of the game name (`0x005DAC00` / `0x005BBA50`) |
| +0x1C0 | 4 | the page's build only: tag `0x4C54414E` ("NATL") when +0x1C4 holds the target |
| +0x1C4 | 1 | the page's build only: the line's target, 1 listeners, 2 allies, 3 all |

The packet itself says nothing of who a line went to: each game sends only to
the players in the target (with the relay, the mask at +0x2F does it). So the
page's build tags its own lines (`set_tag` in `match_chat.c`, when
`web_match_chat_take` hands a line to the game): the send block writes its
fields one by one and clears nothing (checked in the lifted YR send block), so
the tag goes out with the line. A receiver reads it in `web_match_chat` and
clears it, so a later packet in the same buffer can't carry it over. A line
without the tag (a native player, another build) tells `to: 0`, not known.

Limits: the field holds 111 units + NUL, but the send copies with `wcscpy`
after writing the colour and hash, so a longer text overwrites them; keep a
panel line at 111 units or less (the game's own edit stops at 97). Thai
travels as U+00A1..U+00FB units, not U+0E01... A receiver drops the line when
the hash flag is set and the hashes differ (`docs/wol/co-op.md`, C-3).

## Not verified

- The meaning of `id` in Add_Message beyond "chat passes the colour"
  (VERA: ConcatMessage matches rows by it, for modem chat only).
- What reads the last-line copy (`0x00A8D112` / `0x00A3F122`).
- The IME queue's size and its writer (WM_IME_CHAR in the window procedure).
- The recommended patch is a design from the disassembly; it has not been
  built or run.

## What is built

The chat panel and the lobby chat box (22 November).

- **Shown:** `run_lift.py match_chat_patches` puts C after the receive call
  (YR `0x0048D979`, RA2 `0x004828A3`) and after the echo call (YR `0x0055F0F5`,
  RA2 `0x005418F5`, every fragment). It calls `web_match_chat(packet, target)` in
  `src/web/match_chat.c`, where target is 0 for another player's line and the chat
  target dword for the player's own echo. That emits a `matchChat` event with the
  name, the text as the game's units, the colour index, `own` and `to`. The page
  (`web/src/components/MatchChat.tsx`) reads U+00A1..U+00FB as Thai when the
  player's Thai font is on.
- **Sent:** the page calls `ra2_match_chat_send(text, target)`. The text goes
  through the input ring as Windows-874 units (`push_text` in `presenter.c`) and
  is queued in `match_chat.c` (4 lines, dropped after 3 s). C after the pre-hook's
  `mov edx, [ebp]` (YR `0x0055E46C`, RA2 `0x00540C6C`) calls
  `web_match_chat_take(GameMode, chunk, target)`. In mode 3 or 4 with a line
  queued, it copies the line into the overflow chunk and sets the target dword.
  The patch then sets `edi = ebp = 4`, `ebx = 0` and `[esp+0x10] = 4`, and jumps
  to YR `0x0055E7B3` / RA2 `0x00540FB3`. This is recommendation 1 above.
- **Ready:** the same pre-hook call tells the page `matchChatReady` on while
  GameMode is 3 or 4, and the presenter's pump sends off 1.5 s after the
  pre-hook last ran in one.
- **The game's chat keys open the panel:** the keys are fixed in code; the
  Keyboard options have no chat commands. After KeyToASCII the pre-hook
  compares the character:

  | Key | Character | Target |
  |---|---|---|
  | Enter | `0x0D` | 1, the players ticked under Chat in Diplomacy (all at a match's start, `0x01010101` at YR `0x004FC239`) |
  | Backspace | `0x08` | 2, allies |
  | `\` | `0x5C` | 3, everyone |

  It sets the target dword, then consumes the key (`mov [ebp], edi`, YR
  `0x0055E57E`, RA2 `0x00540D7E`, byte-checked). The patch after that
  instruction calls `web_match_chat_open(GameMode, target)` when `bl` is 0
  (`bl` set means the line is a selected beacon's label, which stays the
  game's). In a LAN or online match it sends `matchChatOpen {to}`, clears the
  target and leaves by the pre-hook's exit (YR `0x0055F1C8`, RA2 `0x005419C8`,
  the path a frame without a key takes). The page grabs no key itself, so
  keyboard layouts and the beacon label behave as the game decides.
- **Which target the line opens to** (`resolveTarget` in `MatchChat.tsx`):
  - Backspace opens to Allies and `\` to All.
  - Enter, the game's target 1, opens to the target last used in this match,
    starting at All. The Diplomacy "Chat" ticks are not used by the panel.
  - Tab switches between All and Allies.
  - The remembered target changes on Tab, on a line sent, and on Backspace or
    `\`. `Play.tsx` keeps it, and it goes back to All when `matchChatReady`
    turns on for a new match.
- **The lobby chat box** (`src/web/chat_box.c`, `web/src/screens/ChatBox.tsx`)
  covers the chat line, Edit `0x540`, of the lobby `0x113`, the game rooms and
  LAN setup screens (`0xBB`, `0xBC`, `0xBD`, `0xC2`, `0xC9`), the Page dialogs
  (`0x11B`, `0x11E`) and the co-op score screen (`0xBC6`).
  - The `chatField` event gives the line's place. Enter sends the text to the
    game's control over the Edit as `WM_CHAR` units followed by a Return key
    (`ra2_chat_send`), so the game's commands still work.
  - It replaces the page's TYPE button.
  - Typing goes to it, not to the game's line under it: while the box shows
    and the game's keyboard focus is on that screen (`keys` in `chatField`:
    the focus window is the screen or inside it, so not a password prompt or
    message box over it), a key with text, Backspace, Delete or Enter focuses
    the box and is left to the browser (`chatBox` in `input.ts`). Under
    Pointer Lock a click on it focuses it too (it is `[data-page-overlay]`).
  - The game's other text fields keep their typing: `keys` is false while the
    focus is an Edit other than the chat line, or the control the game lays
    over one (its class is the game's own, so `over_other_edit` in
    `chat_box.c` tests whether the focus's middle is inside another Edit).
    Of the chat screens only the LAN screen `0xBB` has one, the player name
    (Edit `0x541`); `e2e/lan.mjs` types into it and checks the box stays empty.
  - It is see-through and has no frame, so the game's own line and frame show under it. The text is
    the game's chat yellow (`#FFFF00`), bold.
  - **Page and Buddy List open the page's FRIENDS** (the MESSAGES panel on its FRIENDS tab), in place
    of the game's old Page dialog (`0x11B`) and Buddy List screen (`0x116`).
    - `chatField` carries two rectangles: `px`..`ph` for Yuri's Revenge's Page button (`0x5C2`,
      `GUI:PageButton`) in the game rooms `0xC2` and `0xC9` (the Page dialogs reuse `0x5C2`, so only
      those screens count), and `bx`..`bh` for the lobby's Buddy List (`0x689`, both games). All are
      0 where there is none.
    - Yuri's Revenge's lobby Page button is hidden, because the lobby's Buddy List does its job: YR's
      template hook (`web_chat_box_template`, `main.c`) clears its WS_VISIBLE before `0x113` is made.
    - `PageButton.tsx` lays a see-through button over each, so the game never gets the click.
      Mouse moves go on to the canvas, so the game's cursor and the button's tip still follow.
    - Red Alert 2 has no Page button, and no Buddy List screen behind its Buddy List.
- **Red Alert 2's game name:** in a matchbot game the receiver dropped every
  line, because the game-name hash differed (`docs/wol/co-op.md`, C-3). That
  fix covered only Yuri's Revenge. `main.c` now passes RA2's name too:
  `0x00A3F618`, read at `0x00482810`.
- **Log:** `[match chat] sending a line (N units) to target T, mode M` and
  `[match chat] own|a player's line (colour C, target T)`. The text itself is
  not logged.
- **The game's own rows:** C at Add_Message's first instruction (YR `0x005D3BA0`,
  RA2 `0x005B4DA0`, byte-checked `sub esp, 0x14c`) reads name, text, scheme and
  style at `[esp+0x150]`, `+0x158`, `+0x15C` and `+0x160`. It calls
  `web_match_message`, which sends a `matchMessage` event for every row without
  a name: mission text, defeats and pages. Rows with a name are player chat,
  which `web_match_chat` already reports. The panel shows these rows in gold.
  In single player (GameMode not 3 or 4) the panel is only this log, with a
  "Messages" tab and no typing line.
- **History and pointer lock:** the panel keeps 100 lines across matches, and
  each line starts with its local time when Chat times is on. The tab sits in
  the bottom row, so it stays put while the history opens above it. In a match
  the pointer is locked, so the real pointer reaches nothing on the page.
  Instead, `input.ts` finds the `[data-page-overlay]` element under the game's
  cursor (`elementFromPoint` at the virtual cursor):
  - the panel gets a `pageoverlay` event, which opens it while hovered;
  - a press goes to its button and not to the game;
  - the wheel scrolls its `[data-page-scroll]` list.
- **A page reopened the game's line:** after a page sent as an overflowed
  line (result 4, how the panel's lines arrive), the game opens its own chat
  line again, prefilled `From <nick>:/page<to>`, for the next page (YR
  `0x0055E9EC`..`0x0055EA9E`, RA2 `0x005411EC`..; it calls the list's remove
  and add-edit, `0x005D4390` and `0x005D4210`). That line sat under the panel
  and took the game's keys. C after the `cmp dword ptr [esp+0x10], ebp` there
  (`MATCH_CHAT_PAGE_SITES` in `run_lift.py`) jumps to the game's own branch
  past it (YR `0x0055EDAB`, RA2 `0x005415AB`) when `web_match_chat_from_panel()`
  says this frame's line came from the panel. Log: `[match chat] a page from
  the panel: the game's line stays closed`.
- **Tabs** (22 November): the open panel has All, Allies, PM and System tabs
  over its history (`inTab` in `MatchChat.tsx`). Closed, it fades only the
  selected tab's lines.
  - Allies: player lines with `to` 2. That covers the player's own lines and
    lines from players on this build (the tag in section 4); lines from others
    count as to everyone.
  - PM: whispers. `wolapi.c` posts a whisper as a page row and sets
    `ra2_wolapi_whisper_posting()` around it (a PRIVMSG only: a PAGE or NOTICE is the server's), so
    `web_match_message` sends `matchMessage` with `pm: true`. The player's own
    `/page` (and `/msg`, `/m`, `/pm`, `/p`, `/r`) from the panel adds a
    `(to nick) text` line on the page (`Play.tsx`).
  - System: the game's other rows.
  - A tab not on show is marked when it has lines newer than the last seen there.
- **Escape in a chat box** closes the box and does not release the capture:
  `browser-controls.ts` skips its own release for `[data-game-text]`. In
  fullscreen, where Keyboard Lock gives the page Escape, the mouse stays
  captured. In a window the browser itself still releases on Escape, and pages
  cannot stop that; Enter on an empty line closes the box and keeps the capture.
- **The game name overflowed (fixed):** `apply_game_name` wrote 22 units at the
  name, which holds 20, so it overwrote the first 4 bytes of the packet buffer
  (YR `0xA8D638`, RA2 `0xA3F640`). The check then saw a change at every poll and
  zeroed the kind of whatever packet was there. With three players, lines were
  lost at random: player 3 got nothing. It now writes 20 units, and the log no
  longer repeats `game name set`.
- **Tests:**
  - Vitest: `MatchChat.test.tsx` and `ChatBox.test.tsx`.
  - e2e: `web/e2e/chat-box.mjs` (the lobby box) and `quickmatch.mjs --row 11`
    (the panel, two players, and an announcement as a game row).
  - e2e: `wol.mjs --three --chat --match-chat`, a hosted Custom Match. Each of
    three players sends a line; every panel must show all three, in three
    colours. Shots: `chat-<name>`.
  - e2e: `match-messages.mjs`, a skirmish in either game. Enter must open no
    page line and the panel must offer no typing. RA2's skirmish starts with no
    opponent, so the script puts an Easy Enemy in the second slot first (the
    list at (272, 114), then (169, 159), in the game's 800x600). `--probe`
    stops at the setup screen and takes its picture. Passed in both games.
