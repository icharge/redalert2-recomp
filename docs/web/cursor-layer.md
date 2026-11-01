# The game cursor on a page layer

**Status: implemented; verified on a headless skirmish run for Yuri's Revenge,
same code path for Red Alert 2.** The art comes from the resources the game has
already loaded (`MOUSE.SHA` + `MOUSEPAL.PAL`, the technique the sibling
reimplementation `C:\Users\Norrapat\projects\ra2web` uses), decoded once per
cursor change, and drawn on the page above the picture. The first design —
capturing the cursor off the primary surface on every draw — froze the game and
is gone.

Related, already done:

- `?show-cursor=1` keeps the browser pointer visible with a green ring at the
  position the page reports to the game ([testing.md](testing.md)).
- A match start no longer flings the pointer-locked cursor when the picture
  changes from 800×600 to the match size (`web/src/game/input.ts`).

## Problem

In a match the game blits its software cursor into its own primary surface, so
the cursor advances at the game's frame rate and is delayed by presentation:

```
mouse event → shared pointer → game mouse thread → game draws the cursor
            → primary unlocked → presenter copies → page rAF → WebGL → compositor
```

The pointer position the page sends is immediate (`pointer_x/pointer_y`), so
drawing is what must be decoupled — with the game's own art, since the cursor
changes with context (move, attack, select, deploy, …).

## What was tried, and why it stopped

The first version read the cursor **off the primary surface**: right after the
game's blit it compared a rect of the screen with the saved background the mouse
class keeps (`+0x44`), and accumulated a sprite. That runs on the game's mouse
thread while it holds `MouseMutex`, and it locks the DirectDraw primary with
`DDLOCK_WAIT` — which the presenter also locks every frame. In testing the game
became unplayable, consistent with that lock stalling the game's own draw path.
It also copied and compared two 64×64×4 buffers on every cursor draw.

**Nothing of that design is kept**: no surface reads, no locks, no per-draw
diff.

Two more things were learned on the way, both now built in:

- the blit site's stack slot (`MEM32(esp)`) is **0**, not the cursor object, so
  the object is recorded at `Draw_Cursor`'s entry instead (`page_cursor_this`);
- skipping the blit must also pop its eleven stack arguments (`esp += 0x2C`).
  Without that the caller's frame was left 0x2C low and the next instructions
  read and wrote the wrong stack slots — it crashed in the sidebar, not in the
  cursor code. `run_lift.py`'s patch now does it, with a test.

## The technique (ra2web)

- `mouse.shp` + `mousepal.pal` are decoded **once** into a sprite sheet.
- The cursor is a **DOM canvas** above the game picture (`PointerSprite`,
  `z-index: 100`), moved on every mouse move, minus the hot spot.
- The frame is chosen from the game's pointer type (`PointerType`, frame
  ranges; some animate).
- Nothing is drawn into the game's own picture, so nothing has to be suppressed.

Our version differs in one useful way: we do not read the MIX. We take the bytes
the game already loaded into memory, so mods that replace the cursor are
covered for free.

## Evidence (both editions)

From `game\GameMD.exe` (YR) and `game\game.exe` (RA2):

| Thing                                                           | YR                        | RA2                      |
| --------------------------------------------------------------- | ------------------------- | ------------------------ |
| cursor shape load at boot (`mov ecx,"MOUSE.SHA"` → file loader) | `0x52C34C` → `0x5B40B0`   | same shape               |
| `MOUSEPAL.PAL` load (`mov ecx,"MOUSEPAL.PAL"` → loader)         | `0x52C13D` → `0x5B40B0`   | `0x511D6E` → `0x5956C0`  |
| convert class built from it                                     | `0x52C1D8` → `[0x87F6C8]` | `0x511E…` → `[0x8323C8]` |
| `WWMouseClass::Draw_Cursor`, which converts through that class  | `0x7B93F0`                | `0x772740`               |
| its blit call (the one to skip)                                 | `0x7B9516` → `0x4AF2A0`   | `0x772882` → `0x49F3A0`  |

The `WWMouseClass` object the hook receives:

| Offset           | Field                                                     |
| ---------------- | --------------------------------------------------------- |
| `+0x04`          | the loaded `MOUSE.SHA` file (raw bytes)                   |
| `+0x08`          | current frame index                                       |
| `+0x14`, `+0x18` | cursor x, y (screen)                                      |
| `+0x24`          | primary surface                                           |
| `+0x3C`, `+0x40` | hot spot (already resolved: centre / top-left per cursor) |
| `+0x48`, `+0x4C` | drawn position (client)                                   |
| `+0x50`, `+0x54` | frame width, height                                       |

`MOUSE.SHA` is a Westwood SHP, the same format ra2web's `src/data/ShpFile.ts`
parses independently:

```
u16 reserved, u16 width, u16 height, u16 frames
per frame (24 bytes): i16 x, i16 y, i16 w, i16 h, u8 compression,
                      3 bytes, u32, u32, u32 data offset
```

`GL_format 3` (Format3 RLE): per scanline a `u16` length, then bytes where a
non-zero byte is one palette index and a zero byte starts a run of transparent
pixels. `MOUSEPAL.PAL` is 768 bytes, `r,g,b` with each component 0..63 (the game
scales by 4). Index 0 is transparent.

## Design

```
game boot      → MOUSEPAL.PAL (768 B) ──┐
cursor change  → MOUSE.SHA frame (RLE) ─┼─→ shared memory ─→ page: decode, draw at pointer − hot
game blit site → "page draws it?" ──────┘                   (own canvas, above the picture)
```

**Host**

1. **Palette, once.** At the `MOUSEPAL.PAL` load site, copy the 768 bytes
   (`run_lift.py page_cursor_palette_patches`, one call site per edition).
2. **Cursor state, on change.** The hook at `Draw_Cursor`'s blit site reads the
   shape pointer, frame, hot spot and draw size. When shape/frame changes, it
   publishes the frame's SHP data (or its decoded indices, see below) with a new
   sequence number. No screen access, no allocation beyond a fixed buffer.
3. **Suppress only when asked.** While `page_cursor_request` is set and a sprite
   is published, skip the blit. Otherwise the game draws exactly as it does now.
4. Menus, pause, movies and the Windows-cursor path are untouched.

**Protocol** (`src/web/web_api.h`, `web/src/game/protocol.ts`, [protocol.md](protocol.md))

Keep `page_cursor_seq`, `page_cursor_kind`, `page_cursor_hot_x/y`,
`page_cursor_w/h`, `page_cursor_request`. Replace the 64×64 RGBA block with:

| Field                            | Meaning                                       |
| -------------------------------- | --------------------------------------------- |
| `page_cursor_palette`            | 768 bytes, `r,g,b` 0..63 (filled once)        |
| `page_cursor_x`, `page_cursor_y` | the frame's offset inside the sheet           |
| `page_cursor_data`               | the frame (see A/B below), `w*h` bytes or RLE |

Protocol 10 is uncommitted, so this is a reshape of the same version.

**Page**

- The overlay canvas already written (`web/src/game/cursor-layer.ts`) keeps its
  placement math, visibility rules and request handshake; only the pixel source
  changes (`palette[index]`, alpha 0 for index 0).
- Draws at `pointer − hot` each animation frame; hidden when the game stops
  drawing the cursor or the game build is older than protocol 10.

## Decode split

**Chosen: A, the host decodes to indices.** Shared memory carries
`w*h` palette indices per frame (plus the palette), so the page does a lookup
and nothing else, and the block stays fixed-size. The Format3 decoder lives in
`src/runtime/page_cursor.c` with a selftest, next to the reader that already has
to find the frame's offset and length.

(The alternative, B, was to publish the RLE and decode in TypeScript — also
workable, and closer to ra2web, but it puts a variable-length blob in the shared
struct for no gain on this side.)

## Tasks

### Phase 0 — probe (done)

Measured on a headless skirmish run (`RA2_PAGE_CURSOR=1
RA2_PAGE_CURSOR_DEBUG=1`, the `tools/playtest.py skirmish-start` script):

```
[cursor] palette: 00 00 16 | 3F 34 00
[cursor] probe #1 this=0x2F382E80 shape=0x0BF00048 frame=0 sheet=55x43 frames=517
[cursor]   frame x=0 y=0 w=22 h=17 comp=1 off=0x3080 (data 0x0BF030C8)
[cursor]   data 12 0B 23 00 00 00 00 00 00 00 00 00
[cursor]   hot=0,0 drawn=236,240 size=22x17
```

- **`[wwmouse+4]` is the loaded SHP**: 517 frames, a 55×43 largest frame, a sane
  frame entry, and `drawn=236,240` exactly where the script put the pointer.
- **The frame is uncompressed (`comp=1`)**, so the decoder's raw path is the one
  in use; Format 2 and 3 are implemented for the frames that use them.
- **The palette arrives whole**: every component ≤ 63; entry 1 is `63,52,0`,
  the cursor yellow.
- The hot spot is the game's own (per cursor), not half the sprite as ra2web
  has to guess.

| ID   | Task                                                                                                                                                                 | Done when                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| P0.1 | Log the shape pointer, sheet `w/h/frames`, frame entry `(x,y,w,h,compression,offset)`, first data bytes, hot spot and drawn position on the first 10 distinct frames | numbers agree with the SHP layout above (sheet size, frame count, compression 3) |
| P0.2 | Log the first bytes of `MOUSEPAL.PAL` from the load site                                                                                                             | 768 bytes arrive; components ≤ 63                                                |
| P0.3 | Decision point                                                                                                                                                       | if either is wrong, stop and keep today's cursor                                 |

### Phase 0.5 — remove the failed design (done)

| ID     | Task                                                                                                                                   | Done when                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| P0.5.1 | Delete the primary-surface read, the diff, the saved-background reader and the two 64×64 work buffers from `src/runtime/page_cursor.c` | no screen access left in the file |
| P0.5.2 | Replace the 64×64 RGBA block with the palette + indices: `web_api.h`, `protocol.ts`, the presenter's publish and the native composite  | builds; no RGBA path left         |

### Phase 1 — publish the state (done)

| ID   | Task                                                                                                     | Files                                                                   | Done when                                     |
| ---- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| P1.1 | Reshape the shared block: palette, frame rect, frame data, keep the words above; bump/adjust asserts     | `src/web/web_api.h`, `web/src/game/protocol.ts`, `docs/web/protocol.md` | builds; offsets match                         |
| P1.2 | Palette hook + tests (done for the probe; keep the byte guards)                                          | `run_lift.py`, `tools/test_lift_patches.py`                             | tests pass                                    |
| P1.3 | Publish the frame on change from the hook (A or B), with the seqlock; skip the blit only while requested | `src/runtime/page_cursor.c`                                             | sprite available before the first suppression |
| P1.4 | Decode + publish in the web presenter's pump                                                             | `src/web/presenter.c`                                                   | page sees palette and frames                  |

### Phase 2 — page cursor (done)

| ID   | Task                                                                             | Files                          | Done when                                 |
| ---- | -------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------- |
| P2.1 | Decode (A or B) and draw on the overlay canvas at `pointer − hot`                | `web/src/game/cursor-layer.ts` | known sprite lands exactly on the pointer |
| P2.2 | Visibility: hide on menus/pause/movies/dialogs; clear the request on stop/hidden | `cursor-layer.ts`, `Play.tsx`  | exactly one cursor in every state         |
| P2.3 | `?cursor=page` gate (already wired)                                              | `Play.tsx`                     | flag off ⇒ unchanged                      |
| P2.4 | Compare with `?show-cursor=1`                                                    | manual                         | no drift                                  |

### Phase 3 — verification and docs (in progress)

| ID   | Task                                                                                                                                  | Done when                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| P3.1 | Unit tests: RLE decoder (if B) or C selftest (if A); placement already covered                                                        | pass                                                                               |
| P3.2 | Headless skirmish (`tools/playtest.py skirmish-start`) with the feature on: frames advance, no stall, log says a sprite was published | pass                                                                               |
| P3.3 | Regression: menus, pause, movies, settings, classic/modern, both editions                                                             | pass                                                                               |
| P3.4 | Document the flag and fields                                                                                                          | `docs/web/testing.md`, `docs/web/protocol.md`, `docs/presenter.md`, `CHANGELOG.md` |

### Phase 4 — native parity (done)

| ID   | Task                                                                                                    | Done when                               |
| ---- | ------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| P4.1 | `present.c` composites the published frame (index→RGBA with the palette) at the real pointer, 1x and 2x | `RA2_PAGE_CURSOR=1` matches the browser |

## Verification log

- **Probe (YR, headless skirmish)**: palette 768 bytes, shape header 55×43 with
  517 frames, frame 0 `22×17 comp=1`, `drawn=236,240` for `--move 236,240`.
- **Both editions, end to end** (`RA2_TARGET=game RA2_PAGE_CURSOR=1
RA2_PAGE_CURSOR_DEBUG=1 python tools/playtest.py skirmish-start`):
  `pass skirmish-start exit 4 dialogs E2 100 102; in game, 18 distinct frames;
modes 800x600 -> 1280x720`, with `[cursor] palette: 00 00 16 | 3F 34 00` and
  `[cursor] frame 0: 22x17 at 0,0 in 55x43, hot 0,0` in
  `work/tests-game/skirmish-start/run.log` and **no fault**. Red Alert 2's
  cursor is the same 22x17 frame in a 55x43 sheet as Yuri's.
  The blit's epilogue differs between the editions - YR `0x4AF2A0` ends
  `add esp,0x20; ret 0x2C` (11 arguments), RA2 `0x49F3A0` ends
  `add esp,0x20; ret 0x28` (10) - so `page_cursor_patches` pops `0x2C` for YR
  and `0x28` for RA2. One value for both shifted `esp` and crashed the game in
  the sidebar, which is how the difference was found.
- **Decode + publish (YR, headless skirmish, suppression on)**: `[cursor] frame
0: 22x17 at 0,0 in 55x43, hot 0,0`, and the run completed its watchdog with no
  fault (the earlier crash was the unpopped `0x2C`, now fixed).
- **Lift patches**: `python tools/test_lift_patches.py` → 51 tests OK, covering
  the entry, blit and palette sites for both editions and the `esp += 0x2C` pop.
- **Page**: `npx vitest run` → 54 files, 505 tests pass (9 of them
  `cursor-layer`); `npx tsc --noEmit` clean.
- **Native and wasm, both editions**: `build.cmd` links `build\ra2.exe` (YR),
  `BUILD_DIR=build-game build.cmd` links Red Alert 2's host, and
  `build-web.cmd` links both modules (`ra2md.js`/`ra2.js`; the RA2 module was
  blocked by the same stale lift and now builds). RA2's earlier
  failure was a **stale lift**: `src/recomp/gen_game` still called
  `ra2_wdt_debug_msg` / `ra2_wdt_set_screen` from World Domination
  instrumentation that neither `run_lift.py` nor the sources define any more;
  regenerating `--target game` removes them (`wdt symbols in the new lift: 0`)
  and the host links.
- **The playtest case passes with the feature on**: `RA2_PAGE_CURSOR=1
RA2_PAGE_CURSOR_DEBUG=1 python tools/playtest.py skirmish-start` →
  `pass skirmish-start exit 4 dialogs E2 100 102; in game, 18 distinct frames;
modes 800x600 -> 2580x1080`, with `[cursor] palette:` and `[cursor] frame 0:
22x17 at 0,0 in 55x43, hot 0,0` in `work/tests/skirmish-start/run.log` and no
  fault. The game keeps drawing frames while the page side is suppressed.
- **Browser wiring**: with the rebuilt YR module (`web/public/game/ra2md.*`) and
  the dev server, `node web/e2e/cursor-page-layer.mjs
"http://127.0.0.1:5173/?dev=1&cursor=page&edition=ra2md"` finds the layer
  canvas mounted (`aria-hidden="true"`) beside the game canvas. The dev server's
  file path copies the whole install into wasm memory (1.07 GB into a 768 MB
  heap), so the game itself stops during that copy with `unwind` before it can
  boot — pre-existing, not the cursor. The browser game path is the OPFS import
  (`tools/playtest.py --web --web-import`), tried below.
- **Native presenter (YR)**: with `RA2_PAGE_CURSOR=1` and
  `RA2_PAGE_CURSOR_DUMP=work/tests/cursor-shots/rect`, a scripted skirmish logs
  `[present] cursor: drawn by the game`, `[cursor] frame 0: 22x17 at 0,0 in
55x43, hot 0,0`, and five `before`/`after` rect dumps. Diffing the last pair
  (`web/e2e` has no part in this; the BMPs are in `work/tests/cursor-shots/`)
  first run, with the real pointer outside the window, showed 8 pixels changed
  inside the 44x34 rect at its origin — the sprite drawn where the presenter put
  it, clipped where the picture ends (`to_game` clamps to the edge). A second run
  moves the real pointer to the middle of the screen (`SetCursorPos`); the dumps
  then land at `(2974,1252)` and the before/after pair differs in **688 pixels**,
  the whole arrow in its own palette colours. `work/tests/cursor-shots/
cursor-yr-8x.png` is that rect at 8x — the cursor the presenter draws, from the
- **Native presenter (RA2)**: the same run against `build-game\ra2.exe` with
  `RA2_TARGET=game` dumps at `(1426,836)`; its before/after pair differs in
  **752 pixels** — the same arrow, over the battlefield, in the same palette
  colours. `work/tests/cursor-shots/cursor-ra2-8x.png` is that rect at 8x: the
  sprite is drawn over live terrain, not a flat background.
  game's MOUSE.SHA and MOUSEPAL.PAL.
- **Pause menu (YR)**: a scripted skirmish with the feature on opens the game's
  pause dialog (`[dialog] open 0xB5`) and the run stays alive to the watchdog.
  The page and the presenter both hide the page cursor while
  `Shared.cursorKind != None` (menus, pause) and `host_menu_cursor()` is
  non-NULL, so the game's own cursor is the only one there.
- **Modern controls (presenter)**: the same scripted skirmish with
  `[present] controls=modern` in `RA2MD.INI` logs `[present] cursor: drawn by
the game` and publishes `frame 0` with no fault. Classic is the default and
  was what every other run exercised; the cursor hook is input-independent, so
  both modes go through the same path.
- **Regression with the feature on** (`RA2_PAGE_CURSOR=1`, `tools/playtest.py`):
  `menu-idle`, `menu-exit`, `sp-skirmish`, `movies-credits`,
  `movies-sneakpeeks`, `options-keyboard`, `back-options` — 0 failed; each log
  has `[cursor] palette: 00 00 16 | 3F 34 00` and no fault. In the menus and
  the movies no in-match frame is ever published, so the page cursor stays
  hidden and the game's own cursor paths are untouched.
- **Browser match, end to end** (`web/e2e/cursor-page-match.mjs`, a persistent
  Chrome profile, the dev server): import the install into OPFS once, play from
  the launcher, open the game with `?cursor=page`, start a skirmish, move the
  real pointer over the picture. The page logs `[cursor] the page draws the
in-match cursor (?cursor=page)` and shared memory reads:
  `protocol 10, pageCursorPaletteSeq 2, pageCursorSeq 14, pageCursorKind 1,
pageCursorRequest 1, pointerX 360, pointerY 195, cursorKind 0` — the palette
  and a frame are published, the page has asked the game to stop drawing its
  cursor, and the pointer moved. `work/tests/cursor-shots/
browser-cursor-page.png` is the match with the page's arrow at the pointer
  (360,195 game pixels -> ~(178,309) on screen through the letterbox).
- **A launcher change found on the way**: the game card's `data-game-id` is
  `ra2md` for Yuri's Revenge (it was `yr`), so `web/e2e/playtest.mjs`'s import
  flow could not click Play and reported the dialogs as never opened even though
  the game had run. Both the flow and the probe use `ra2md` now.
- **Not exercised**: the native presenter on a real screen by a person (the BMP
  dumps cover the compositing itself), and a long session for feel.
- **RA2's build** is blocked by the World Domination instrumentation in the
  generated Red Alert 2 code: `src/recomp/gen_game/recomp_0049.c` calls
  `ra2_wdt_debug_msg` and `ra2_wdt_set_screen`, which live (when they exist)
  in `src/web/wolapi.c` — a file the native RA2 host does not compile, and one
  that was being edited while this was tried (the definitions came and went).
  Every cursor source file compiles for RA2, and the cursor patches are in
  `src/recomp/gen_game` (entry `0x772744`, blit `0x772882`, palette `0x511D73`),
  so RA2 needs only that unrelated instrumentation fixed before it links.

## Risks

- **Palette site is exe-specific**; a build whose bytes differ keeps its own
  cursor (the palette hook declines) and the page shows none.
- **SHP variants**: handle compression 0/1/2/3; anything else hides.
- **`[+0x04]` may not be the raw file** on some build — the probe settles it.
- **Threads**: the hook runs on the mouse thread; publish behind a seqlock, and
  never cache the frame buffer beyond the call.
- **Mods** are free: we read what the game loaded.
- **Pointer position** stays the existing shared pointer — one source of truth,
  warps and Pointer Lock included.

## Acceptance criteria

- With `?cursor=page`, a match shows exactly one cursor, with the game's art and
  hot spot, moving at display refresh rate, at no measurable cost to the game.
- Without the flag, behaviour is unchanged.
- No input, click-routing or warp changes.
- Both editions, plus the menu/pause cursor paths, pass the existing tests and
  the new checks.
