# Experimental TTF UI rendering

The optional text path uses Parley 0.12 for whole-string shaping and layout,
and Swash 0.2.10 for CPU glyph masks. It draws into the game's existing
16-bit surfaces. It does not replace the presenter or require a new GPU API.
The original bitmap renderer remains the default.

## Build and enable

Set `-DRA2_TTF_TEXT=ON` when configuring CMake. The option defaults to OFF,
so ordinary builds have no Cargo dependency. Regenerate both editions' lifts
after changing `run_lift.py`; do not edit generated C.

Native builds use Rust `1.99.0` with `i686-pc-windows-msvc` on Windows or
`i686-unknown-linux-gnu` on Linux. The Windows archive uses the static CRT.
The browser uses Emscripten 6.0.12 and Rust `nightly-2026-10-13` with
`rust-src`, rebuilding `std` for its pthread/shared-memory ABI. CMake keeps
Cargo output inside each build directory. The toolchain cache variables are
`RA2_TEXT_RUST_TOOLCHAIN` and `RA2_TEXT_WEB_RUST_TOOLCHAIN`.

For browser iteration, use a separate build directory, `WEB_LINK_OPT=-O1`,
and a `WEB_OUT` outside `web/public/game`. See [the toolchain guide](web/toolchain.md).
Release builds should use the normal link optimization.

Enable the compiled feature at runtime with `--ttf-text`. For the browser's
development game route, append `?dev&arg=--ttf-text&arg=--no-intro` to the page
URL. `RA2_TTF_TEXT=1` also enables it; under Node pass it through the host's
`--env RA2_TTF_TEXT=1` option. Leaving the flag off selects the existing
renderer, including the existing Thai option.

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

The current fast-link gamemd module is approximately 168.4 MB of Wasm,
31.7 MB Brotli, and 40.4 MB gzip. These are iteration build sizes, not release
sizes or a measured feature delta.

## Typing

With `--ttf-text`, text committed in the page's TYPE box reaches the game's
edit controls as Unicode: each code point in the Basic Multilingual Plane is
posted as its own `WM_CHAR` value, which the game's edit control stores as
one UTF-16 unit. Without the flag, typing sends Windows-874 bytes as before,
for the Thai FNT. See [the input diagnosis](thai-input-diagnosis.md) for the
edit control's contract and the probe results.

This covers the game's wide edit fields, such as the LAN lobby chat draft,
which the 2026-11-15 probe confirmed holds and draws Thai. Player name fields
are byte-only in the game and refuse characters past `0xFF`, so Thai names
are still not possible. No IME composition display, physical Thai keyboard
layout, network encoding or saved-setting change has been added. Tactical
chat and the RA2 edition were not checked.
