# Task 1 report: CPU TTF text core

## C ABI

Include `src/runtime/text_engine.h`. Create an engine with
`ra2_text_engine_create`; it registers the bundled fallback set and disables
system font discovery. Register caller TTF/OTF bytes once with
`ra2_text_engine_add_font`; the bytes are copied and the returned font id can
be passed to layout calls as the preferred family. Font id 0 uses the bundled
family sequence.

Use `ra2_text_layout_utf16` for default left alignment and font defaults.
`ra2_text_layout_utf16_ex` additionally accepts line height (0=font default),
alignment (0=left, 1=center, 2=right), weight (0=normal), and width ratio
(1=normal). Both accept explicit UTF-16 code-unit count, font size, and wrap
width (0=no wrapping). Unpaired UTF-16 surrogates are replaced with U+FFFD.

`ra2_text_layout_get_metrics` reports advance, logical dimensions, the first
line baseline, and signed ink bounds in logical layout coordinates.
`ra2_text_layout_render_mask` writes A8 coverage into caller memory with a
byte row pitch, signed layout origin, and clipping. A negative `ink_x` or
`ink_y` is preserved in the mask. The C adapter can blend this coverage into
RGB565, RGB555, or 32-bit RGB surfaces. Reuse a layout for repeated draws;
there is no per-frame cache. Layouts contain their raster mask and can be
destroyed independently of the engine.

The engine and layouts are same-thread handles. Font bytes are capped at
128 MiB; text at 16,384 UTF-16 units; font size at 1..512 px; wrap width and
mask dimensions at 16,384 px; aggregate glyph raster scratch and final masks
at 16M pixels. Calls catch Rust panics and return `RA2_TEXT_INTERNAL_ERROR`.
Rust allocator exhaustion is not recoverable through this ABI and may abort;
the input/output caps bound normal allocations.

## Fonts and licensing

Bundled, unmodified assets copied from `vera20k/src/render/fonts`:

- Noto Sans variable font (2.015): Latin, Greek, Cyrillic.
- Noto Sans Thai variable font (2.001).
- Noto Sans Arabic UI variable font (2.011).
- Noto Sans CJK SC regular (2.004): useful Han, Kana, and Hangul coverage.

Noto Sans fonts are under SIL Open Font License 1.1. `assets/fonts/OFL.txt`
and `assets/fonts/OFL-CJK.txt` carry the upstream notices. Provenance is
recorded in `assets/fonts/README.md`. No Vera renderer implementation was
copied.

## Verification

The initial behavior run was RED: empty text unexpectedly measured a 4.68 px
advance, and Noto Sans `j` lost its negative left ink bearing (`ink_x` was 0).
The later standalone U+0301 regression was RED before removing the
zero-logical-width raster shortcut. Visual QA also found reused Swash image
coverage contaminating following glyphs. A regression rendered Noto Sans `A`
then `W` into a reused image and compared its pixels with a fresh `W`; it
failed byte-for-byte before `render_glyph` cleared the image and passed after.
The fixed suite is GREEN:

- `cargo test --locked --manifest-path text/Cargo.toml` — 9 ABI behavior tests
  and 1 Swash image-reuse test passed, plus doc tests. Covers Latin advance/ink,
  Thai marks, joined Arabic, mixed
  scripts and CJK, empty/malformed UTF-16, caller font registration, extended
  layout, negative `j` bearing, and a standalone combining mark.
- `cmd /c work\build-text-native.cmd` — i686 Windows static archive and C ABI
  harness passed (1/1).
- `cmd /c work\build-text-web.cmd` — wasm32 Emscripten archive and Node C ABI
  harness passed (1/1). Emscripten emitted its `-pthread + ALLOW_MEMORY_GROWTH`
  performance warning; the test passed.
- `text/specimen.pgm` — portable grayscale sample showing Latin, Thai, Arabic,
  and CJK text from the C ABI. It was regenerated and visually checked after
  fixing Swash image reuse. Recreate with
  `cargo run --manifest-path text/Cargo.toml --example specimen -- text/target/text-specimen.pgm`.

The parent separately confirmed the Linux i686 archive cross-compiles. No
Linux GUI runtime or Wine was installed for that target, so Linux runtime
execution was unavailable in this environment.
