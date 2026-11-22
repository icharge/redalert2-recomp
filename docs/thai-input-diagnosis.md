# Thai input diagnosis — 2026-11-11

## Observed behavior

Chrome, Yuri's Revenge (`gamemd`), TTF code revision `f282020c`, local retail
files, ephemeral browser profile. Production input and Wasm were used without
modifying game memory or the game files.

| Field | Input method | Result |
| --- | --- | --- |
| Skirmish player name | Chromium committed text through the TYPE textarea | Latin `TestA` works; appended `การ` becomes `¡ÒÃ` |
| LAN lobby Your Name | Same | `LobbyAการ` becomes `LobbyA¡ÒÃ`, including the player list |
| LAN lobby chat draft | Same | `ChatAการ` becomes `ChatA¡ÒÃ` |
| LAN lobby chat draft | Synthetic DOM keydown/up, `key=ก`, `code=KeyD`, canvas focused | Appends Latin `d`; physical scan-code translation remains US-layout based |

This tests drafts, not chat delivery to another player. The keyboard control
is a DOM event probe, not a real Windows keyboard-layout or OS IME test.

## Encoding evidence

For committed text `การ`, expected UTF-16 units are `0E01 0E32 0E23`.
Actual copies of the typed name and chat strings in Wasm memory contain
`00A1 00D2 00C3`, the CP874 bytes widened as Latin characters. Latin prefixes
survive, distinguishing the issue from a missing focus or dropped commit.
Screenshots agree with the memory probe after allowing the game to paint.

Relevant boundaries:

- `web/src/game/input.ts` forwards committed textarea text through `sendText`.
- `web/src/screens/Play.tsx` calls `game.exports.ra2_input_text(text)`.
- `src/web/presenter.c:ra2_input_text` decodes UTF-8, converts to CP874, and
  queues ANSI `WM_CHAR` messages. The TTF switch does not change that path.
- The shared HLE in `../pcrecomp/runtime/win32hle/kernel32_crt.c` reports
  ACP 1252 and its narrow/wide conversion currently uses a CP1252 table.
- Default HLE Edit storage in `user32.c` inserts `(char)w`. A large Unicode
  `WM_CHAR` value alone therefore does not establish a Unicode edit contract.
  The game's subclassed NewEdit path needs its own proven insertion seam.

The confirmed loss occurs before the TTF renderer receives the string.
The renderer should not reinterpret every Latin-1-range UTF-16 character
as Thai: that would corrupt legitimate Latin text and translations.

## Reproduction artifacts

Task-owned scratch files are in `work/thai-input-probe/`: screenshots,
memory results, console/game logs, and the small assertion helper. From the
task2 worktree, with the dev server on port 5175 and its local game route:

```powershell
node work/check-thai-input.mjs
```

This is a diagnostic, not part of CI; see the fix below for its current result. It opens an isolated
browser, types Latin plus Thai into all three fields, captures each screen,
and fails unless the full expected UTF-16 string reaches a game buffer.
The retained scratch helper can also check an already running test page.
The standalone command was run after the interactive probe and exited 1
with `thaiPreserved: false` for all three fields. Separately,
`cargo +1.99.0 test --manifest-path text/Cargo.toml --locked --test behavior thai_marks_shape_with_visible_ink`
passed (1/1), confirming that proper Thai Unicode produces visible glyph
ink in the text core. This does not replace a browser input test.

## Proposed direction

Preserve Unicode from the browser's UTF-8 commit into the active edit's
UTF-16 draft, then let the existing TTF path shape that draft. Keep ANSI
conversion at explicitly identified legacy boundaries. Do not globally
change ACP or reinterpret all existing guest strings.

Before production implementation, prove the NewEdit mutation ABI and its
caret/selection notifications for each edition; identify which names/chat
paths later narrow into byte-only storage or network packets. A working
Unicode draft must not imply that arbitrary Unicode already survives
multiplayer transmission, saved settings, or every other edit control.
No input fix or browser editor redesign is included in this diagnosis.

## Fix: Unicode into the game's edit control (2026-11-15)

### The game's edit control (NewEdit)

Both editions subclass their dialog edits with one window procedure: YR
`0x00614B30`, RA2 `0x005F2966` (found by its `WM_IME_CHAR`, `0x286`, compare).
For `WM_CHAR` it does not call the original Edit. In YR,
`0x006150FD..0x0061527A`:

- the low 16 bits of `wParam` are the character; values up to `0x1F` go to
  the original procedure (backspace and other controls);
- when the control has a filter string (`+0x50`), a character that
  `0x007CA8C6` finds in it is refused, and so is anything past the length
  limit (`+0x48`);
- **when the control's flag at `+0x30` is set, values from `0x100` are
  refused**;
- otherwise the value is inserted as one UTF-16 unit into the control's
  wide string (`+0x3C`, insert at `0x007B72F0`, caret at `+0x40`).

`WM_IME_CHAR` converts through `0x007781B0` and the private message `0x4D9`
takes a UTF-16 unit directly; both join the same insertion path.

Text leaves the control two ways. Message `0x4B3` copies the wide string.
`WM_GETTEXT` narrows it through `0x00735090`, which keeps only the low byte
of each unit (no code page). Player names are read that way, so names are
byte strings in the game, and the name fields set the byte-only flag that
stops a Unicode character from being cut to its low byte.

### What changed

- `src/web/text_input.h` (new): `web_text_char(codepoint, unicode)` gives the
  `WM_CHAR` value. With `--ttf-text` it is the code point (BMP only); without
  it, the Windows-874 byte, unchanged from before. Controls other than
  backspace and Enter, surrogates and code points above U+FFFF are `?` in
  both modes. Tested by `text/tests/web_text_input.c` (`text_web_input`).
- `src/web/presenter.c`: `ra2_input_text` queues the code point; the game
  thread maps it when it posts `WM_CHAR`, since `--ttf-text` is a game-side
  switch.
- `src/web/map_box.c`: the map search mirror keeps its place when the game's
  box inserts a Unicode character, holding Thai as its CP874 byte (map names
  use bytes) and anything else as `?`. Covered in `map_box_selftest.c`.
- pcrecomp `runtime/win32hle/user32.c`: the built-in (not subclassed) Edit
  stores a character past `0xFF` as `?`, as an ANSI window gets it, instead
  of its low byte. `user32_edit_selftest.c` covers it.

### Result

Same probe, gamemd fast build with `RA2_TTF_TEXT=ON`, `--ttf-text`, local
retail files from `D:\Westwood\RA2`:

| Field | Before | After |
| --- | --- | --- |
| LAN lobby chat draft | `ChatA` + `00A1 00D2 00C3` | `ChatA` + `0E01 0E32 0E23`, NUL-terminated; drawn as Thai by the TTF path |
| Skirmish player name | `TestA` + `00A1 00D2 00C3` | `TestA` only: the field refuses the Thai characters |
| LAN lobby Your Name | `LobbyA` + `00A1 00D2 00C3` | `LobbyA` only: same |

The probe still exits 1, because it requires all three fields. The name
fields refuse the characters most likely through the `+0x30` flag above;
this was read from the code, not traced at run time.

With TTF off, typing is unchanged: the same Windows-874 bytes as before, for
the Thai FNT.

### Still open

- **Thai player names** need a decision. Names are byte strings in the game
  (`0x00735090` keeps the low byte), and other players' clients read them as
  bytes. Real Thai names would need the name fields' flag cleared and a byte
  encoding chosen for storage and the network, plus a way for the TTF path
  to know which strings are CP874 names. Sending CP874 bytes again would
  store Thai the legacy way but draw it as `¡ÒÃ` under `--ttf-text`.
- Not run: the RA2 edition in the browser, tactical (in-match) chat, chat
  delivery to another player, and saved settings. The physical-keyboard
  path (scan codes) is still US-layout only; Thai arrives only as committed
  text from the page's TYPE box.
