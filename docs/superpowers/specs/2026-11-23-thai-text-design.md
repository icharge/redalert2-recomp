# Thai text in the browser build: design

Date: 23 November 2026. Approach C, chosen by the user.

## Intent

Thai should read properly in the browser build: in the game's own text
(menus, labels, dialogs, Thai translations) and in chat (the lobby, the game
rooms, the match panel). "Properly" means shaped Thai: vowels and tone marks
sit over or under the letter they belong to, as Thai readers expect.

Today the only way is the "Thai font fix". It swaps the bitmap font so that
Latin-1 letters draw as Thai, and Thai travels as those Latin-1 bytes
(Windows-874). It is off by default because it can't place vowels and tone
marks. With it off, Thai shows as `ÊÇÑÊ´Õ`, and over WOL a Thai chat line goes
out as those Latin-1 letters.

## Goals

- Thai typed in the page's chat boxes (lobby `ChatBox`, match `MatchChat`)
  reaches the game, the WOL wire and the other players as real Unicode Thai
  (U+0E00–U+0E7F), and every player on this build sees it shaped.
- Any game text that contains Thai is drawn shaped, by the TrueType engine
  from the `unicode-text-task2` branch (Parley + Swash, Noto fonts).
- Text without Thai is drawn by the original bitmap renderer, pixel for pixel
  as today.
- Thai translations (CSF) are written as real Unicode, not Windows-874.
- Both editions (Yuri's Revenge and Red Alert 2).

## Non-goals

- Player names. They stay English letters only (the user's rule).
- Players on the original game (native clients, CnCNet, Thai font mods).
  Browser players only for now: what they see of a Thai line is not a concern.
- Other scripts (CJK, Arabic) and fonts from mods.
- A physical Thai keyboard typing straight into the game's own edit fields
  without the page's boxes. The page's HTML boxes already take the OS
  keyboard and IME.
- The native Windows and Linux hosts. The engine builds there behind its
  CMake option, but this work verifies only the browser.

## Anti-goals

- English screens looking any different from today.
- A Thai line that one player sees shaped and another sees as `ÊÇÑÊ´Õ`
  (two encodings in play at once).
- Leaving the old Thai font option half-working beside the new path.

## Constraints

- `unicode-text-task2` is 177 commits behind `web-port`. Its engine is
  verified on the main menu only (gamemd), with harnesses for the C ABI, the
  guest adapter and the lifted bridge.
- The engine adds Rust to the web build (Emscripten 6.0.12 with
  `nightly-2026-10-13` and `rust-src`, see `docs/ttf-text.md` on the branch)
  and enlarges the Wasm. A fast-link gamemd build with it was 168 MB
  (32 MB Brotli); the production delta is not measured.
- An edit to `run_lift.py` means relifting both editions (about 10 minutes
  each, `--check` must pass).
- Builds go to the approved folders only: `build/ra2`, `build/ra2md`,
  `build/ra2-fast`, `build/ra2md-fast` (CLAUDE.md). The branch built in its own
  `build-web-ttf/`, which stays in its worktree.
- The game's packet for match chat holds 111 UTF-16 units; Thai needs one
  unit per character, as Latin does. The WOL server accepts lines up to
  16 KB, so UTF-8 Thai (3 bytes a character) is not a limit.

## Approaches

- **A. The TrueType engine for all game text.** Shaped Thai everywhere,
  but every English screen changes look and width, on an engine verified on
  one screen. Rejected: risk to the classic look for no gain on English text.
- **B. Keep the bitmap font, fix the Thai font option.** Stack vowels and
  tone marks in the bitmap renderer, convert Latin-1 bytes to and from Thai
  at the edges. No Rust, no size cost, but Thai stays a pixel font, accented
  Latin letters break while it is on, and the byte trick stays. Rejected: a
  workaround, not support.
- **C. The TrueType engine for text that contains Thai only (chosen).** A
  string with a Thai character goes to the engine; any other string to the
  bitmap renderer. Real Unicode end to end. The risk stays on Thai text, which
  is broken today anyway.

## The design

### 1. Bring the engine to `web-port`

Merge `unicode-text-task2` into `web-port` in the main checkout (builder's
call, 23 November: there the approved build caches, the lifts and
`web/public/game/` are already set up; the worktree has none for RA2). The
merge stays uncommitted until both editions build and the harnesses pass.
Nothing is pushed.

### Order

Chat first (sections 2 to 5 and 8): that is the goal. Translations
(section 6) and retiring the old Thai font option (section 7) come after,
as their own commits.

### Out of scope (builder's calls after the review)

- Byte-only places keep Windows-874: the map search box (`map_box.c`
  matches map names byte for byte), Thai map titles, and names stored in
  `[MultiPlayer] Handle` (names are English only).
- A CSF is converted only when its table says `windows-874` (the
  `encoding` field in `strings.json`); there is no guessing from content,
  since accented European letters share those byte values.
- An install's own Thai `game.fnt` loads as it does today with the Thai
  option off.

### 2. Route only Thai to the engine

`recomp_ttf_call` (`src/runtime/text_guest_lift.c`) already falls back to
the bitmap renderer when it returns 0. Add one check at its entry for the
three targets (measure, label, paragraph): read the string (UTF-16, up to its
terminator or the caller's limit) and go on only if it has a unit in
U+0E00–U+0E7F. A string's measure and its draw see the same text, so they
take the same path and agree on width.

Mixed strings (`[player] สวัสดี`) are drawn whole by the engine, Latin part in
Noto Sans. Accepted: splitting a string between two renderers would break
the game's own width sums.

### 3. On by default, with a way out

In the web build the engine is compiled in and on. `--no-ttf-text` (and
`RA2_TTF_TEXT=0`) turns it off, for a player who hits a problem; Thai then
shows as boxes or `?`, not as Latin-1. The `RA2_TTF_TEXT` CMake option
becomes ON for the web build in `build-web.cmd`/`.sh`.

### 4. Typing carries Unicode

`push_text` (`src/web/presenter.c`) sends each typed code point as its own
UTF-16 unit, not as a Windows-874 byte (the branch's `src/web/text_input.h`
does this under `--ttf-text`; it becomes the only path). This covers both
chat boxes: `ra2_chat_send` (lobby, rooms) and `ra2_match_chat_send` (match).
A character outside the Basic Multilingual Plane becomes `?`.

### 5. The wire carries Unicode

- **WOL** (`src/web/wolapi.c`): lines already go to the page as JS strings
  from the game's UTF-16 and come back the same way, so real Thai travels as
  UTF-8 with no change. A test checks it.
- **Match chat**: the packet's text is UTF-16 (`match_chat.c`), so real Thai
  passes through. `MatchChat.tsx`'s `gameText` (Latin-1 to Thai when the Thai
  option is on) is removed.
- The page's panels (MESSAGES, the match panel) show what arrives as is.

### 6. Thai translations as Unicode

`web/src/storage/csf.ts` writes Thai tables as Windows-874 bytes for the old
font. It writes them as UTF-16 Thai instead; the CSF format is UTF-16 already.
Imported Thai CSF files in Windows-874 are converted when loaded.

### 7. Retire the Thai font option

Remove the launcher's Thai font choice and its built-in bitmap fonts
(`web/src/storage/thai-fonts.ts` and its assets), the `game.fnt` override,
`thaiFontFix` in `Play.tsx`, and the C side of the fix (`src/runtime/thai_font.c`
keeps only what the TTF routing needs, if anything). A player's stored
preference is ignored.

### 8. Fonts and size

Bundle only Noto Sans and Noto Sans Thai for the web build (drop the CJK and
Arabic faces the branch carries, 19 MB of the fonts folder). Measure the
production Wasm (and its Brotli) before and after, both editions, and record
it in `docs/ttf-text.md`.

## Verification

- The branch's harnesses (`text_c_abi`, `text_guest_abi`, `text_web_input`,
  and the rest) pass under Emscripten, plus a new harness case: a string
  without Thai is refused by the routing and one with Thai is taken.
- Vitest for `csf.ts` (Thai written as UTF-16) and the chat boxes.
- Browser e2e, both editions:
  - `chat-box.mjs`: a Thai line typed in the lobby box goes out as UTF-8 Thai
    on the wire (`privmsg #Lob_... :สวัสดี`), and a screenshot shows it shaped
    in the lobby's transcript and in a game room.
  - `quickmatch.mjs --row 11`: a Thai line from A's match panel reaches B's
    panel as Thai, and the game's own message row draws it shaped.
  - A screen with only English (main menu, skirmish setup) is pixel
    identical to a build without the engine.
  - A Thai translation (one CSF string) draws shaped on a menu.

## Left to the builder

- How the Thai check reads a string whose length the caller limits
  (label's `max_units`) and whether to cache the answer per pointer.
- Which other text paths the game uses for chat transcripts (GDI text,
  single-glyph calls) and whether they need routing too; the branch's doc
  lists them as not covered. Found by the e2e screenshots.
- Conflicts in the merge of 177 commits.
- Whether `src/runtime/thai_font.c` keeps any part.
