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

This is a known-failing diagnostic, not part of CI. It opens an isolated
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
