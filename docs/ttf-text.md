# TTF text: Thai in the game's own text

The text path uses Parley 0.12 for whole-string shaping and layout, and
Swash 0.2.10 for CPU glyph masks. It draws into the game's existing 16-bit
surfaces. It does not replace the presenter or require a new GPU API.

Since 23 November 2026 the browser build has it on, for **text with Thai only**
(design: `docs/superpowers/specs/2026-11-23-thai-text-design.md`). A string
with a unit in U+0E00..U+0E7F goes to the engine; any other string to the
game's bitmap renderer, unchanged. A string's measure and its draw read the
same units, so both take the same path. A mixed line (`[nick] สวัสดี`) is
drawn whole by the engine, its Latin part in Noto Sans. Chat carries real
Unicode: the page's chat boxes type code points into the game (`text_input.h`),
WOL lines leave as UTF-8 and match packets as UTF-16.

## Build and enable

`-DRA2_TTF_TEXT=ON` builds the engine in; `tools/build_web.py` sets it for
every web build (`build-web.cmd`/`.sh`). Other builds default to OFF, so they
have no Cargo dependency. Regenerate both editions' lifts after changing
`run_lift.py`; do not edit generated C.

The game builds bundle Noto Sans and Noto Sans Thai only. The Arabic and CJK
faces (17 MB) are the Cargo feature `all-scripts`, on for `cargo test` and the
`text/` harnesses (`RA2_TEXT_ALL_SCRIPTS=ON` there), off for the game
(`cmake/text.cmake` passes `--no-default-features`).

Native builds use Rust `1.99.0` with `i686-pc-windows-msvc` on Windows or
`i686-unknown-linux-gnu` on Linux. The Windows archive uses the static CRT.
The browser uses Emscripten 6.0.12 and Rust `nightly-2026-10-13` with
`rust-src`, rebuilding `std` for its pthread/shared-memory ABI. CMake keeps
Cargo output inside each build directory. The toolchain cache variables are
`RA2_TEXT_RUST_TOOLCHAIN` and `RA2_TEXT_WEB_RUST_TOOLCHAIN`.

At run time, where the engine is built in:

| Switch | Effect |
|---|---|
| (none) | on, Thai text only |
| `--no-ttf-text`, `RA2_TTF_TEXT=0` | off: Thai goes to the bitmap font, which has no Thai glyphs, and typing sends Windows-874 bytes |
| `--ttf-text-all`, `RA2_TTF_TEXT=all` | every string through the engine (testing; changes English screens) |
| `--ttf-text`, `RA2_TTF_TEXT=1` | on (the default; kept for old links) |

For the browser's development game route, append `?dev&arg=--no-ttf-text` to
the page URL. Under Node pass `--env RA2_TTF_TEXT=0`.

## Rendering boundary

Both editions have adapters for the bitmap-font measurement, label, and
paragraph entry points. Paragraphs use the original surface setup/release
calls. Center and right alignment use the game's original flag bits, `0x1`
and `0x2`. Layouts use the font object's line height and a fitted Noto Sans
style; this changes the appearance and width of opted-in text.

TTF reveal uses that same full-string layout throughout the animation and
reveals complete shaped clusters. This keeps wrapping and positioning stable
for callers that measure before drawing. The visible text uses the font's
foreground color; the bitmap renderer's palette highlight is not reproduced.
Use the default renderer to retain that original highlight appearance.

Glyph edges are sharp, near the bitmap font's (23 November 2026). The guest
adapter turns on the engine's game style (`ra2_text_engine_set_game_style`):

- **Steep smoothing** (`text/src/sharp.rs`): each pixel's share inside the
  unhinted outline goes through a steep curve: a quarter or less is clear,
  three quarters or more solid, the half between ramps. Letters are mostly
  solid pixels with a thin soft rim, which the adapter blends as before.
- **Thai at its reading size**: Thai runs (U+0E00..U+0E7F) are laid out at
  14/12.6 of the requested size, weight 600, full width, while Latin keeps
  the fitted 12.6 px, weight 700, 82%.

How it got there, all at the game's text size, where a Thai letter body at
the Latin 12.6 px is about 7 pixels:

| Tried | Result |
|---|---|
| Plain smoothing (hinted, Thai at 12.6 px) | readable, but softer than the game's letters |
| Threshold at half coverage (128) | ส drew as ล: its hook is one pixel a third covered |
| Threshold at a quarter (64) | hook kept, loops of อ and ม filled (ม read as บ) |
| Whole pixels, VERA20K's rule, Thai at 13.4 px | crisp; ซ and ช the same pixels (the tick is under a pixel) |
| Whole pixels, Thai at 14 px | ซ and ช two pixels apart; ถ is ก but for one pixel |
| Steep smoothing, Thai at 14 px (chosen by the player) | sharp, and sub-pixel details stay as a faint pixel |

VERA20K (`../vera20k/src/render/text_engine/`, read for the method; no code
taken, VERA is GPLv3) draws every glyph as whole pixels: a pixel is ink when
its centre is inside the outline, with TrueType's dropout control for strokes
thinner than a pixel, and it reads Brahmic scripts at 13.4 px, weight 600.
Its Thai size and weight are what this uses, raised to 14 px. The engine's
tests (`sharp.rs`) check eleven look-alike pairs at every pen phase (ซ and ช
now differ by about four pixels of ink), and the guest harness's case 1c
checks ส and ล through the adapter. Noto Sans Thai is the modern loopless
design (VERA bundles the same file); Noto Sans Thai Looped, the traditional
one, is not bundled.

The launcher's Thai font option (bundled Thai `game.fnt` files and the
`--thai-font-fix` switch) was retired on the same day. `src/runtime/thai_font.c`
stays: its `recomp_thai_call` is the lifted text calls' dispatch point that
`recomp_ttf_call` hangs off, and its bitmap shaping is off without the switch.

The C ABI is in [text_engine.h](../src/runtime/text_engine.h). It accepts
explicit UTF-16 lengths, supports caller-supplied scalable fonts, and owns
its layout handles and A8 masks. The guest adapter uses bundled fonts; it
does not discover mod TTF files. Malformed UTF-16 becomes replacement
characters. The header documents allocation limits and buffer ownership.
The guest adapter keeps a per-thread cache of at most 64 layouts and 8 MiB
of retained layout payload, including copied text. Font and shaper state
and temporary layout allocations are outside that cache budget.

This is a limited rendering integration. GDI text, individual glyph calls,
and unsupported control-character paths can still use the original
renderer. It does not establish complete screen coverage. Existing FNT and
legacy CP874 mod behavior remain available with TTF disabled.

## Fonts

Bundled OFL Noto faces cover Latin/Greek/Cyrillic, Thai, Arabic, and CJK.
See [the asset provenance and notices](../assets/fonts/README.md). Font
assets were taken from the licensed local Vera font set; no Vera renderer
source was copied.

## Verification

The standalone project exercises the actual Rust library and guest adapter:

```powershell
cargo +1.99.0 test --manifest-path text/Cargo.toml --locked
# From a 32-bit MSVC developer environment:
cmake -S text -B work/text-native -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build work/text-native
ctest --test-dir work/text-native --output-on-failure
```

Configure `text/` with `cmake/emscripten.cmake` in a separate directory to run
the harnesses under Node on a pthread. Assertions remain enabled in Release.

On 2026-11-09, all five Windows x86 and all five Emscripten harnesses passed
on code commit `8bbd9dfa`. They include feature-off behavior, the C ABI,
the guest adapter, and the production lifted bridge for both editions.
The Rust suite passed four unit tests and eleven behavior tests. Both
editions' native hosts rebuilt successfully; native game runtime has not
been checked. The Linux i386 core archive cross-compiled at an earlier
core revision in the initial worktree; the current Linux host and Linux
desktop/Wine/CrossOver runtime have not been verified.

On 2026-11-15 a sixth harness, `text_web_input` (the browser's typing
mapping, `src/web/text_input.h`), was added; all six passed on Windows x86
and under Emscripten.

An independent Chrome run of the gamemd browser module reached the real
800×600 main menu and Single Player submenu with TTF off and on, using
the same rebuilt module and local retail files. Pixel bounds for all six
main-menu captions confirmed that they were centered and stayed inside
their buttons; both screens were also visually inspected. Captures and
logs are in the working tree's `work/ttf-review-captures/`. This covers
those gamemd screens. Tactical chat, lobby chat, other paragraphs and
fields, and the RA2 edition's browser runtime remain unverified.

### Size

Production builds (`build-web.cmd --mode prod`, `-O3` link), the Wasm the page
downloads. Before is the production build of 22 November 2026, without the
engine; after is 23 November with it (Noto Sans and Noto Sans Thai only). The
difference also holds the other commits between the two, which are small C
changes; most of it is the engine (Parley, Swash, Rust's `std`).

| Edition | Wasm before | Wasm after | Brotli before | Brotli after | gzip after |
|---|---|---|---|---|---|
| RA2 | 126.2 MB | 135.0 MB (+8.7) | 12.0 MB | 15.9 MB (+3.9) | 23.2 MB |
| YR | 123.9 MB | 132.4 MB (+8.6) | 13.2 MB | 17.2 MB (+4.0) | 24.0 MB |

The two fonts are 2.27 MB of that (1.03 MB Brotli; Noto Sans is 2.05 MB of
it, a variable font with Greek and Cyrillic the Thai-only routing never uses).
The page also no longer ships the retired option's Thai bitmap fonts (11 MB of
`public/thai-fonts/`, fetched only when that option was on).

## Typing

With the engine on (the default), text committed in the page's TYPE box and
chat boxes reaches the game's edit controls as Unicode: each code point in the
Basic Multilingual Plane is posted as its own `WM_CHAR` value, which the game's
edit control stores as one UTF-16 unit. With `--no-ttf-text`, typing sends
Windows-874 bytes as before. See [the input diagnosis](thai-input-diagnosis.md) for the
edit control's contract and the probe results.

This covers the game's wide edit fields, such as the LAN lobby chat draft,
which the 2026-11-15 probe confirmed holds and draws Thai. Player name fields
are byte-only in the game and refuse characters past `0xFF`, so Thai names
are still not possible. No IME composition display, physical Thai keyboard
layout, network encoding or saved-setting change has been added. Tactical
chat and the RA2 edition were not checked.
