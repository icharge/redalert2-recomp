# XCC Mod Pack Import: Work Plan (2026-11-15)

**Status: phases 0-7 done (2026-11-15).** The reader is
`web/src/storage/modpack/`; what shipped and what is deferred is in
[docs/mod-packs.md §7](../../mod-packs.md#status-shipped-2026-11-15).

Goal: the YuriNET Launcher's MODS tab accepts an XCC mod pack (`.xmlf`, or a
`.exe` made by XCC Mod Creator / XCC Mod Launcher) and turns it into the same
flat mod folder the tab already imports and plays.

Format and routing: [docs/mod-packs.md](../../mod-packs.md). This plan is the
task breakdown and the acceptance bar.

## Non-goals

- No native Windows/Linux CLI in this pass. The core is pure TS, so a Node
  script can reuse it later.
- No Ares/Phobos support: a pack that patches the exe is still rejected.
- No removal of the existing folder import. A pack is one more source.
- No game/Wasm rebuild is needed; this is frontend-only.

## Constraints

- **MIT.** Original implementation from the format doc. No translated XCC
  code, comments or names. Provenance header in each new file.
- **No new runtime dependency.** Platform zlib (`DecompressionStream`), own
  bzip2, existing `mix.ts`/`csf.ts`/`crc32.ts`. Do not move `7z-wasm` into the
  core (LGPL); it stays in the archive worker.
- **No retail files or XCC binaries** in tests. Fixtures are synthetic, or
  generated with Python `bz2` and embedded as base64.
- **No whole-file read of a game MIX.** `ra2md.mix` is 204 MB here; read its
  index and the one entry needed (`localmd.mix` 4.8 MB, `rulesmd.ini` 743 KB
  inside it) through an OPFS range reader.
- **No unsafe names.** Base names only; reject `..`, separators, reserved
  names; dedupe case-insensitively; cap decompressed size, node count and
  depth.

## Where it goes

```
web/src/storage/modpack/
  xif.ts          container reader (v0/v1/v2, raw/zlib/bzip2, external, limits)
  bzip2.ts        own decoder, behind `decompress(kind, bytes)`
  model.ts        tree -> ModPack (options, modes, modules, entries)
  shp4.ts         decodeShp4(bytes, cbD?) -> SHP(TS)
  vxl4.ts         decodeVxl4(bytes, cbD?) -> VXL
  mix-write.ts    writeMix(files) -> new-format MIX
  ini.ts          parse/merge/write an INI (diff application)
  build.ts        ModPack + BaseData -> BuiltPack { files, warnings }
  base.ts         OPFS adapter: range reads, localmd.mix/langmd.mix, side mixes
  index.ts        the entry point the UI uses

web/src/screens/launcher/ModsScreen.tsx   accept packs, show warnings
web/src/storage/install.ts               MOD_DATA additions
```

Data flow: `bytes -> xif -> model -> decode -> build -> FolderSource ->
importMod`. Only `base.ts` and the screen touch OPFS/DOM.

## Phase 0: test scaffolding

- `xif-vectors.ts` (test helper): a spec-based XIF writer for raw and zlib
  trees (zlib via `node:zlib`), plus base64 bzip2 vectors generated once with
  Python `bz2` (small text, empty, highly repetitive, ~200 KB pseudo-random).
- Hand-written hex fixtures for one tiny raw XIF and one external-value file, so
  the first test does not rely on our own writer.
- Acceptance: a test builds a tree, `readXif` returns it; the literal fixture
  reads without the writer.

## Phase 1: `xif.ts` and `bzip2.ts`

- `readXif(data): Promise<XifNode>` — async because zlib uses
  `DecompressionStream`.
  - Header versions 0/1/2, `BZh` detection, external block placement.
  - Delta ids, value types 0/1/2/3/4/5, NUL-terminated strings.
  - Limits: decompressed size, node count, depth, external size, trailing bytes.
- `bunzip2(data): Uint8Array` — header, blocks, Huffman/MTF/RLE2, inverse BWT,
  RLE1, EOS; CRC checked when present. Behind `decompress(kind, bytes)`.
- Tests: raw/zlib/bzip2 trees; external > 64 KiB; ids spanning 256/257;
  truncated header/index/stream; size bomb; multi-value keys; empty tree.
- Acceptance: all tests; `pnpm typecheck`; no import of Node or DOM modules
  from production files.

## Phase 2: `model.ts`

- `parseModPack(root, nameHint): ModPack`.
- Options: name, `mod_name`, version, `game` (5/6), `mfs` (default 98),
  `mf_version` > 2 is an error. Modes/modules from keys 0x100/0x101.
- Entries: category 0-19, `fname`, `ft`, `encoding`, `decodedSize`, `mode`,
  `module`, bytes. Unknown root keys are warnings, not entries.
- `entriesForMode(pack, mode)` and `mergeModule(pack, sibling)` helpers.
- Tests: full synthetic pack; mode filtering; module merge; duplicate and
  case-colliding names; unknown category; bad `fname`.
- Acceptance: tests pass; model keeps warnings instead of throwing for a
  recoverable entry.

## Phase 3: `shp4.ts` and `vxl4.ts`

- `decodeShp4`: 6-byte header, per-frame margins, scanline RLE
  (`0` + run length), rebuild `t_shp_ts_header`, 24-byte image headers,
  8-byte-aligned frame offsets, `compression = 3`, `cbD` respected.
- `decodeVxl4`: section header, `cx*cy` spans, z-inc/count/colour+normal,
  rebuild `VXL` header, section headers, start/end offset tables, span bytes
  with trailing count, tailers. Zero palette and transform (the stream does not
  carry them); warn when a pack has voxels.
- Fixtures: hand-written encoded streams with known decoded bytes (2-3 frames,
  empty frame, margins; a 2x2x4 section with an empty span). No encoder needed.
- Acceptance: byte-exact output; a decoded SHP is accepted by the game's own
  SHP loader in a later smoke test; unit tests cover malformed input.

## Phase 4: `mix-write.ts`, `ini.ts`, `build.ts`

- `writeMix(files)`: `u32 0`, `u16 count`, `u32 bodySize`, 12-byte entries
  sorted by id, offsets from the body start, `mixHash` for ids. Verify by
  reading the result with `mix.ts`.
- `ini.ts`: parse sections/keys, apply a diff (replace/add), write Latin-1.
  Deletions are not representable in a pack diff; never invent them.
- `build.ts`: the activation table from the doc.
  - Routing: ecache (cameo/shp/speech/tmp), expand (ini/mix/screen/map/interface/
    hva/vxl/side), loose (CSF, theme, video, `missionsmd.pkt`, `glsmd.pal`,
    `glslmd.shp`).
  - Side mixes: merge the stock `sidec0N.mix` from the base archive (or
    `sidec02md.mix` for YR's third side) with the pack's entries, then add the
    result to the expand mix.
  - Encodings: `enc_none`, `enc_shp`, `enc_vxl`, `enc_diff` (INI over base,
    CSF over base via `parseCsf`/`rewriteCsf` with `inject` and `extra`).
  - Mode: Base (-1) by default; if Base has no entries and modes exist, use the
    lowest mode and warn.
  - Warnings: modes ignored, modules missing, base data missing, JPEG/OGG/PCX/
    map-project conversions deferred, sound skipped, unknown category, clash.
  - Output flat file names (what `importMod` requires).
- Tests: synthetic pack -> files map; read the mixes back with `mix.ts`; INI
  diff over a synthetic base; CSF diff over a synthetic base; side merge; mode
  selection; warnings.
- Acceptance: the built folder is playable by the existing mod loader; no
  category is dropped without a warning.

## Phase 5: `base.ts`

- `readRange(path, start, length)` over OPFS (File.slice + arrayBuffer).
- MIX range reader: header, RSA key block, first encrypted index block, rest of
  the index; `bodyOffset`; entry bytes by hash. Old and new formats.
- `BaseData`:
  - `ini(name)`: edition's `localmd.mix` (inside `ra2md.mix`) or `local.mix`
    (inside `ra2.mix`).
  - `csf()`: `langmd.mix`/`language.mix` -> `ra2md.csf`/`ra2.csf`.
  - `sideMix(n)`: the stock side archive for the edition.
  - Fall back to a loose file where the game would find one; return null.
- Tests: range reader over an in-memory synthetic MIX (reuse the encrypted
  builder pattern in `mix.test.ts`), offsets at boundaries, missing entry.
- Acceptance: no call path reads a whole 100 MB+ file.

## Phase 6: UI

- `ModsScreen`:
  - Drop: a folder behaves as today; a `.xmlf`/`.exe` file is wrapped as a
    one-file `FolderSource` and converted.
  - Picker: one INSTALL MOD folder input. A folder that holds a `.xmlf`/`.exe`
    at its top is auto-detected as a pack; a single pack file is dropped.
  - A pack inside a dropped folder is found by the converter (top-level
    `.xmlf`/`.exe`), so folder drops with sibling module files work.
  - Progress: "Preparing the mod…", then the existing copy progress.
  - Show `BuiltPack.warnings` in the status line; a fatal error keeps today's
    failure line.
  - Name: `options.mod_name` sanitized, else the file stem; must satisfy
    `importMod`'s 1-64 character rule.
- `install.ts`: extend `MOD_DATA` with the loose outputs the builder may emit
  (`.pkt`, `.avi`, `.bik`, `.tmp`) or keep them in the mixes.
- Tests: drop a synthetic `.xmlf` -> generated files land under
  `game/<slot>/mods/<name>/` and a `ModRecord` is written; a rejected pack
  (exe patch, bad size) cleans up; the pack inside a folder path; warnings
  shown.
- Acceptance: existing ModsScreen tests plus the new ones pass.

## Phase 7: docs, verification, cleanup

- Update `docs/mod-packs.md` §7 with what shipped and what is deferred.
- Add a `web/CHANGELOG.md` entry (the changelog test expects a maintained log).
- Run:
  - `pnpm typecheck`
  - `pnpm exec vitest run src/storage/modpack src/screens/launcher/ModsScreen.test.tsx`
  - `pnpm lint`
  - `pnpm build` (frontend only; no Wasm rebuild)
- Manual smoke: the retail install path is not committed. On this machine use
  `game/` plus a synthetic pack; a real pack is optional.
- Remove task scratch under `work/tasks/` if any; keep only committed fixtures.

## Commits

One commit per phase that stands alone:

1. `modpack: XIF container and bzip2`
2. `modpack: pack model`
3. `modpack: SHP-4 and VXL-4 decoders`
4. `modpack: MIX writer, INI merge, pack build`
5. `modpack: read base data from the install`
6. `mods: import XCC mod packs in the launcher`
7. `docs: mod pack import shipped and deferred`

Stage only the paths above. The working tree has unrelated edits; do not mix
them in.

## Risks and decisions

- **Async XIF** because the browser inflates through `DecompressionStream`.
  Keep the only async point in `xif.ts`.
- **Own bzip2** is the biggest single risk. Gate it on the fixtures; if it
  becomes a maintenance problem, swap the one `decompress()` call for a
  permissively licensed decoder, not a GPL port.
- **Base data is mandatory for `enc_diff`.** Without `localmd.mix`/`langmd.mix`
  the extracted INI/CSF is a partial file. Warn and keep the diff, or refuse
  when the pack is diff-only; decide in Phase 4 with a test.
- **Modes.** Base-only by default. A pack whose content lives in a mode still
  imports (lowest mode + warning), so the user is not left with an empty mod.
- **VXL transform/palette** are not in the stream; zero them and warn.
- **Side mixes** need a base archive read; if it fails, warn rather than
  producing a side mix with only the mod's files.
- **Deferred conversions** (JPEG/OGG/1-bit PCX/map project/sound) are warnings,
  never silent drops.
