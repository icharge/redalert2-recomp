# XCC mod packs: how they are packed, and how to extract one

A mod distributed for the stock game is often a single file made by **XCC Mod
Creator** and opened by **XCC Mod Launcher**: a `.xmlf`, or a `.exe` that is the
launcher with the mod appended. This page is the format, what activation does
with each part, and what an importer has to do to turn a pack into the folder
that `mods/` (and the browser's MODS tab) already takes.

The source studied is the XCC Utilities checkout beside this repo
(`../xcc`, commit `6f91bf8`). XCC Utilities is GPLv3; this repo is MIT, so the
port must be written from this description, not copied from the C++ source.
No real pack was available while writing this: everything below is read from
the source, and the validation checklist at the end says how to confirm it.

## 1. The container

The payload is an **XIF** file: a small header, then a compressed or raw
*key/value tree*. `misc/xif_key.*` and `misc/xif_value.*` are the reader and
writer.

### Header

`misc/xif_key.h:28` defines `file_id = 0x1a464958`, which is `58 49 46 1A`,
i.e. the ASCII string **`XIF\x1a`**.

| Version | Header | Body |
|---|---|---|
| 0 (`file_version_old`) | `int32 id`, `int32 version` — 8 bytes | raw tree, absolute key/value ids (`load_old`) |
| 1 (`file_version_new`) | `int32 id`, `int32 version`, `int32 size_uncompressed` — 12 bytes | zlib stream |
| 2 (`file_version_fast`) | 20 bytes, below | raw or compressed tree, then optional external data |

Version 2 header (20 bytes, `t_xif_header_fast`):

    int32 id                 0x1A464958
    int32 version            2
    int32 size_uncompressed  0 = tree is stored raw; otherwise decompressed size
    int32 size_compressed    bytes of tree data at offset 20
    int32 size_external      bytes of external data after the tree data

If `size_uncompressed != 0`, look at the first three bytes at offset 20: `BZh`
means **bzip2**, anything else means **zlib** (`xif_key.cpp:256`). The current
Creator always writes version 2: the export dialog's *XMLF* filter calls
`vdata(true)` (raw, `size_uncompressed = 0`), *GZ* calls `vdata()` (zlib), *BZ*
calls `export_bz()` (bzip2 level 9). Version 1 and 0 are read for older files.

### Tree

`Cxif_key::save` / `load_new` (`xif_key.cpp:136`, `xif_key.cpp:69`). Ids are
**deltas**: each entry stores `id - previous_id`, and readers accumulate.

    key:
      int32 key_count
      key_count * ( int32 id_delta, key )
      int32 value_count
      value_count * ( int32 id_delta, value )

    value:
      uint8 type
      type 0 bin32      -> uint32 (inline)
      type 2 int32      -> int32  (inline)
      type 5 float      -> float  (inline)
      type 4 external   -> int32 size; bytes live in the external block
      type 1 binary     -> int32 size, bytes
      type 3 string     -> int32 size, bytes, NUL-terminated (size includes the NUL)

Type bytes are `t_vt` in `xif_value.h:26`. `vt_external_binary` keeps big
payloads out of the compressed tree; the bytes follow the tree in the same
traversal order (keys in id order, then values in id order; `xif_value.cpp:176`).
If `size_uncompressed == 0` the tree is stored raw at offset 20; otherwise
`size_compressed` bytes at offset 20 are decompressed. The external block
follows the tree either way (`xif_key.cpp:264-272`).

### The `.exe` wrapper

An exported EXE is the launcher executable, then the XIF bytes, then an
`int32` holding the XIF length (`XCC Mod CreatorDoc.cpp:86-107`). Both readers
locate it the same way: take the last 4 bytes as `cb`, check that
`cb + 4 <= size` and that the 4 bytes at `size - 4 - cb` are `XIF\x1a`, then
slice `[size - 4 - cb, size - 4)` (`XCC Mod Launcher.cpp:26-56`,
`XCC Mod CreatorDoc.cpp:62-67`). A launcher started from such an exe reads its
own file (`GetModuleFileName`); `-activate` also exists for silent activation.

Modules are *not* inside the exe or the main `.xmlf`: they are sibling files
named `<base> 00.xmlf`, `<base> 01.xmlf`, … where `<base>` is the pack's path
without extension (`xcc_mod.cpp:521-536`, `:1166-1176`). A pack is therefore
a set of files; an importer must look for the siblings too.

## 2. The content

Ids come from the shared `enum` at `xcc_mod.cpp:152-187`: the root uses 7-30 for
options and 256/257 for the mode/module lists, while a file entry uses 3-6 and
27-29. Ids 0-2 (`cx`, `cy`, `c_frames`) are legacy and unused.

| Id | Name | Meaning |
|---|---|---|
| 3 | `fname` | file name, base name only when exported |
| 4 | `ft` | `t_file_type` (`cc_file.h:24`) |
| 5 | `fdata` | the bytes |
| 6 | `encoding` | how the bytes were transformed (below) |
| 7 | `name` | author |
| 8 | `mail` | author mail |
| 9 | `link_title` | site title |
| 10 | `link` | site URL |
| 11 | `game` | `t_game`: 5 = Red Alert 2, 6 = Yuri's Revenge (`cc_structures.h`) |
| 12 | `mod_name` | title shown by the launcher |
| 13 | `csf_diff_compression` | |
| 14 | `ini_diff_compression` | |
| 15 | `custom_button_text` | |
| 16-20 | `exit/manual/site/update/xhp_button` | launcher buttons |
| 21-22 | `mod_version`, `mod_ucf` | version and update-control URL |
| 23 | `confirm_deactivate` | 0/1/2 |
| 24 | `mf_version` | format version; > 2 is refused (`:49`, `:1161`) |
| 25-26 | `shp/vxl_compression` | |
| 27 | `cb_d` | decoded size of a compressed SHP/VXL |
| 28 | `mode` | mode id, absent = -1 = always |
| 29 | `module` | module id, absent = -1 |
| 30 | `mod_mfs` | mix number, `"98"` by default |

Root keys `0x100` (256) and `0x101` (257) hold **modes** and **modules** as
values (id → display name). Every other root key is a **category**: its id is
the category enum, and its child keys are the files, numbered 0, 1, 2, …

Categories, in order (`xcc_mod.cpp:48`):

    0 cameo   1 hva    2 ini     3 map      4 mix      5 screen   6 shp
    7 sound   8 speech 9 st     10 theme   11 video   12 vxl    13 launcher
   14 manual 15 interface 16 tmp 17 side 1 18 side 2  19 side 3

A file entry is a child key with values `fname` (3) and `fdata` (5) always,
`ft` (4) normally, `encoding` (6) when transformed, `cb_d` (27) for
SHP/VXL, and `mode`/`module` when not -1. The exported main pack records
`mode` but deliberately not `module`; module entries live only in their own
file (`xcc_mod.cpp:343-357`, `:457-465`).

### Encodings (`xcc_mod.cpp:189`)

| Value | Name | Payload |
|---|---|---|
| 0 / absent | `enc_none` | the file as-is |
| 1 | `enc_diff` | INI or CSF **diff**: only changed/new sections and strings |
| 2 | `enc_jpeg` | (not produced by `save`) |
| 5 | `enc_ogg` | (not produced by `save`) |
| 7 | `enc_shp` | SHP RLE-4 stream, see below |
| 8 | `enc_vxl` | VXL RLE-4 stream, see below |

JPEG and OGG are not marked; `ft` (4) identifies them. A `.jpeg`/`.ogg` source
file is stored raw and converted at activation.

### Diff compression (INI)

With `ini_diff_compression` on (default), `save` reads the *base* copy of the
INI from `local.mix`/`localmd.mix` (itself stored inside `ra2.mix`/`ra2md.mix`),
compares section by section, and stores only keys whose value differs or that
the base does not have; unchanged sections are dropped (`xcc_mod.cpp:358-396`).
It is not a real diff: **deletions cannot be represented**. On activation the
diff text is parsed over the base INI and the merged result is written
(`:801-828`). A partial diff on its own is not a usable `rules.ini`.

CSF works the same way when `csf_diff_compression` (13) is on, against the
language mix: for every label in the mod's CSF, keep it if the base lacks it or
its value differs, drop it otherwise (`:397-418`), then merge onto the base at
activation (`:850-891`).

### SHP `enc_shp`

`shp_encode4` / `shp_decode4` in `misc/shp_ts_file.cpp:544` and `:621`. It is a
transposed, per-scanline encoding of a normal SHP(TS):

    header: uint16 cx, uint16 cy, uint16 c_frames        (6 bytes)
    per frame:
      uint8 lm, rm, tm, bm     left/right/top/bottom margins
      rows: uint8 lm, uint8 rm, then the row RLE

The row RLE has no marker: a non-zero byte is one literal pixel, and a `0x00`
byte is followed by a run length (1..255) counting that zero
(`encode4_line`, `:427`). `shp_decode4` rebuilds the usual SHP(TS) header
(`t_shp_ts_header` and 24-byte image headers, with scanline offsets) using the
`cb_d` size from value 27; the decoder is ~45 lines (`:621-664`). Port it; do
not try to guess the normal layout from the stream.

### VXL `enc_vxl`

`vxl_encode4` / `vxl_decode4` in `misc/vxl_file.cpp:483` and `:581`:

    uint32 c_sections
    per section:
      char id[16], int32 section_i, float scale,
      float x/y/z_min_scale, float x/y/z_max_scale,
      uint8 cx, uint8 cy, uint8 cz, int8 unknown
      cx*cy spans, each: (z_inc, count, count * (colour, normal)) until z_inc == cz;
                         a single cz byte means an empty span

`vxl_decode4` rebuilds the standard VXL: header (`VXL` id, section counts and
size), section headers, an offset table per section (`span_start_ofs`,
`span_end_ofs`), the span bytes with a trailing count, and
`t_vxl_section_tailer`s. The `cb_d` value (27) is the output size. Note the
encoder does not store the section transform, and the decoder writes neither
that nor the embedded palette; treat those as zero/stock values and validate
visually.

## 3. What activation does (the target layout)

`Cxcc_mod::activate` (`xcc_mod.cpp:551-938`) is the specification for the
folder an extractor should produce. With `mod_mfs = "98"` it writes:

| Category | Destination |
|---|---|
| cameo, shp, speech, tmp | `ecache98.mix` / `ecachemd98.mix` |
| ini (except `missionsmd.pkt`) | `expand98.mix` / `expandmd98.mix` |
| screen (except `glsmd.pal`, `glslmd.shp`) | expand mix |
| mix, hva, vxl, interface, map | expand mix |
| side 1/2/3 | rebuilt `sidec01/2/3.mix`, added to the expand mix |
| `missionsmd.pkt`, `glsmd.pal`, `glslmd.shp` | loose in the game folder |
| st (CSF) | merged CSF, loose (`ra2.csf` / `ra2md.csf`) |
| theme | loose `.wav` (RA2/YR) |
| video | loose |
| sound (RA2/YR) | appended to `audio.bag` + `audio.idx` (`misc/xse.cpp`) |
| launcher, manual | not activated; read by the launcher itself |

Mix names: `expand<suffix><nn>.mix`, `ecache<suffix><nn>.mix`, suffix `md` for
Yuri's Revenge (`xcc_dirs.cpp:151-172`). The game's search list already
contains `expandmd##.mix`, which is why `mods/README.md` tells players to
rename a stray MIX to `expandmdNN.mix`.

Activation also transforms:

- `ft_jpeg` -> `.pcx` (same stem, `xcc_mod.cpp:694-714`): decode JPEG and save
  as PCX. A pack can ship `.jpg` art that the game expects as `.pcx`.
- `ft_ogg` -> `.wav` (RA2/YR, IMA ADPCM) or `.aud` (Tiberian Sun, irrelevant
  here) (`:715-748`).
- `ft_pcx` with one plane in `cameo`/RA2 `screen` -> `.shp` (`:749-762`).
- `ft_xif` in `map` -> `.map` (`:771-789`); only for map-project inputs.
- SHP/VXL encodings -> decoded SHP/VXL (`:763-770`).
- A full CSF entry overwrites the target; text `name=value` entries and diffs
  merge onto the base language CSF (`:850-891`).

`ct_launcher` holds launcher art and `intro.ogg` (`banner.jpeg`,
`exit_button.jpeg`, `manual_button.jpeg`, `mod_button.jpeg`, `site_button.jpeg`,
`update_button.jpeg`, `xhp_button.jpeg`); `ct_manual` is an HTML tree with an
`index`. They are not game content, but an importer can surface the title,
version and manual instead of dropping them.

## 4. Extracting a pack in this repo

The browser import is the place this pays off: a player with a `.xmlf` or a
self-installing mod `.exe` has one file, where `ModsScreen` used to answer
"Drop a folder, not a file." (`web/src/screens/launcher/ModsScreen.tsx`). The
Windows/Linux side takes folders under `mods/<edition>/<name>/`, so the same
conversion serves a small CLI for native play.

Suggested shape, reusing what exists:

1. **Open the container.** Accept `.xmlf`, `.xmcf` (a Creator project: same
   tree, no file data), a wrapped `.exe` (slice the trailer), and a folder that
   contains them. Read the header, inflate (zlib via `DecompressionStream`,
   bzip2 via a small decoder/wasm), parse the delta-coded tree.
2. **Read the content model** into `{options, modes, modules, categories[
   {category, fname, ft, encoding, cbD, mode, module, bytes}]}` plus the
   sibling module files.
3. **Decode each payload** to the file activation would write:
   `enc_none` as-is; `enc_shp`/`enc_vxl` through the ported decoders;
   `enc_diff` INI/CSF merged over the *player's own* base (read `localmd.mix`
   out of `ra2md.mix` for `rulesmd.ini`, and `langmd.mix` for `ra2md.csf`),
   which the browser can already do with `storage/mix.ts` and
   `storage/csf.ts`; JPEG/OGG/1-bit-PCX through their conversions if the
   exporter is to be faithful.
4. **Assemble the mod folder**, either
   - **faithful**: reproduce `activate()` -- one `expandmd98.mix`, one
     `ecachemd98.mix`, the merged `.csf`, theme/video files and
     `audio.bag`/`audio.idx`. This is the route XCC itself takes for SHP, VXL,
     TMP and cameo art, and the only one that does not depend on the game
     finding a loose art file; or
   - **loose**: write INI/CSF/maps at the top level, which the overlay and
     `mods/README.md` support, and put everything else in the two MIX files
     anyway.
5. **Hand it to the existing import**: build a `FolderSource`
   (`web/src/storage/importer.ts`) whose `list()` returns the generated files
   and call `importMod` (`web/src/storage/mods.ts:19`). `importMod` wants flat
   names, which matches XCC's base-name-only `fname`; it already rejects
   executable patches and case-colliding names, records sizes and removes
   partial copies. Extend `MOD_DATA` (`web/src/storage/install.ts:129`) for the
   loose outputs it may emit (`.pkt`, `.avi`, `.bik`, `.tmp`) or keep those
   inside the expand mix.

`importMod`'s `MOD_PATCH` check is important here: a pack's `.exe` is the
launcher, not an Ares/Phobos DLL patch, and must be unwrapped and discarded
rather than copied. A `ct_mix` entry is opaque: add it to the expand mix as
XCC does, do not unpack it. Never write outside the new mod folder (sanitise
`fname` to a base name, reject `..`, absolute paths and reserved names).

Whole-pack limits are worth enforcing before decompression: the XIF header's
`size_uncompressed` is attacker-controlled, so cap it (e.g. 512 MB) and cap the
number of tree nodes, categories and entries.

### Codecs to port (in order of how much a pack needs them)

1. XIF reader (small).
2. bzip2 in the browser (the *BZ* export is the default first filter); zlib is
   built in.
3. `shp_decode4` (~45 lines) and `vxl_decode4` (~90 lines).
4. INI merge (parse, apply, write) and CSF merge (reuse `storage/csf.ts`).
5. MIX writer, to make `expand##.mix`/`ecache##.mix` (the reader already
   exists; the writer is the new part).
6. Optional, only for packs that need them: JPEG->PCX, OGG->WAV(IMA ADPCM),
   1-plane PCX->SHP, XIF map project->`.map`, `audio.bag`/`idx` append.

## 5. Things that will bite

- **The base game is required for diffs.** A pack normally stores only changed
  INI keys and changed CSF labels. Extracting without the player's
  `localmd.mix`/`langmd.mix` gives a partial `rulesmd.ini`, which is wrong as
  a loose replacement. If the base is missing, either keep the diff and mark
  the mod partial, or refuse.
- **Packs built on another mod.** The diff was taken against the *author's*
  install, which may itself have been modded. Merging onto a vanilla install
  then produces what XCC itself would have produced on this player's install --
  usually right, but the author's own base mod is still a missing dependency to
  report.
- **`mod_mfs` is not always 98.** Read root value 30; the pack may write
  `expandmd42.mix` etc. `mod_mfs` can be any string.
- **Modes and modules are real.** Files with `mode` set are only installed when
  the player picks that mode in the launcher; modules are separate `.xmlf`
  files and always merge. An importer must either expose modes (and generate a
  folder per choice), or default to the "Base" mode (id -1) and say so.
  Ignoring `mode` would install every variant at once.
- **The Creator's own `.xmlf` import is lossy.** `Cxcc_mod::load(key, dir)`
  writes each payload to `<project>/<category>/<fname>` verbatim and records
  only mode/module (`xcc_mod.cpp:288-303`); it does not restore `encoding` or
  `ft`. Re-exporting re-detects the type from those encoded bytes, so
  `enc_shp`/`enc_vxl` (and arguably diff) payloads are not round-trippable. Use
  the pack as the source of truth, not the Creator as an intermediate.
- **`save_as_pcx` does not exist in this snapshot.** `misc/xcc_mod.cpp:703`
  calls a `Cvirtual_image` method the tree does not declare (it has
  `save(Cvirtual_file&, t_file_type)` instead), so the tools at `6f91bf8` may
  not build as-is. Treat the source as the specification, not a runnable
  oracle.
- **VXL palette/transform.** `vxl_decode4` fills neither the embedded palette
  nor the section transform; verify against the game (`docs/voxels.md`) before
  trusting an extracted voxel.
- **Sound needs the bag.** A `ct_sound` entry is appended to `audio.bag` and
  `audio.idx` (`xse.cpp`), which first copies the stock bag out of
  `audiomd.mix`. Emitting loose `.wav` will not be heard; merging into a copy of
  the player's bag is the correct move (and makes the mod folder large).
- **Pack names are untrusted.** Exported entries carry only a base name, but a
  hand-made or project file may carry a path; take the base name. XCC's own
  model keys a category by `fname`, so duplicates within one category collapse
  to the last; case-only duplicates are distinct to it and collide on Windows,
  so dedupe case-insensitively. Cap the tree, entry count and total size.

## 6. Validation

No sample pack was available, so the byte layout above is derived by reading
the writer and the reader side by side. To confirm before shipping an importer:

1. Unit-test the XIF reader against a synthetic file written from this spec
   (raw, zlib and bzip2; external > 64 KiB payload; delta ids spanning 256 and
   257; a string value) and assert a round trip.
2. Use XCC's own readers as the oracle if a buildable XCC can be found: write a
   pack from a synthetic tree, then read it back. (See the `save_as_pcx` note
   above -- check that the tool builds first.)
3. Best end-to-end check: run `XCC Mod Launcher.exe -activate` with a real
   pack against a **copy** of a game install, and diff the game folder it
   produces against our exported mod folder. That covers the mix names, the
   category routing and the diff merges in one shot. Do not run it against the
   real install: activation writes into the game folder and deactivation only
   removes files it knows about (`xcc_mod.cpp:945-978`).
4. Re-load the extracted mod in this game (F9/F10 or `--mod`) and check a unit,
   a cameo, a voxel, a map and a string from the pack.

## 7. Implementation direction (MIT)

The reader is written in TypeScript, from this page, as original work. The
format is a fact; XCC's expression of it is not copied. That is what keeps the
new files under this repo's MIT licence while interoperating with a GPLv3
tool's output. The task breakdown, acceptance bar and commit split are in
[the work plan](superpowers/plans/2026-11-15-mod-pack-import.md).

### Rules that keep it MIT

- **Spec-first, one way.** Implement from this page and from behavioural
  fixtures. Do not translate `xif_key.cpp`, `xcc_mod.cpp`, `shp_ts_file.cpp` or
  `vxl_file.cpp` line by line, and do not carry over their comments, identifier
  names or function boundaries. A translation is a derivative of the GPL code;
  an independent implementation of the same layout is not.
- **No copyleft in the core.** Platform zlib (`DecompressionStream("deflate")`)
  and an own bzip2 decoder. Do not pull a GPL bzip2 port or a 7-Zip binary into
  this module: `7z-wasm` is LGPL and stays in the archive worker where it
  already lives. A permissively licensed (MIT) bzip2 package would also be
  acceptable, behind one seam, but the default is our own ~200 lines so the
  core has no runtime dependency.
- **Only public constants and our own fixtures.** CRC tables, the Blowfish
  constants already in `storage/blowfish-tables.ts`, and format magic numbers
  are facts. Test fixtures are generated (Python `bz2`, a synthetic XIF writer
  in the test) or come from a player's own pack at runtime; no retail files,
  no XCC binaries, no extracted mod content are committed.
- **Provenance in every new file**, e.g. *Independent implementation of the XIF
  / XCC mod-pack container from `docs/mod-packs.md`. No XCC Utilities code
  (GPLv3) was copied or translated.*

### Shape

A pure core with I/O only at the edges, so it runs in vitest and in the page:

    web/src/storage/modpack/
      xif.ts        bytes -> XIF tree (v0/v1/v2, raw/zlib/bzip2, external block, limits)
      bzip2.ts      bunzip2(bytes); behind one `decompress()` seam
      model.ts      XIF tree -> ModPack (options, modes, modules, entries); no decoding
      shp4.ts       decodeShp4(bytes, cbD) -> SHP(TS) bytes
      vxl4.ts       decodeVxl4(bytes, cbD) -> VXL bytes
      mix-write.ts  writeMix(entries) -> new-format MIX (reuses mixHash)
      build.ts      ModPack + BaseData -> { files, warnings } (the activate() target)
      base.ts       OPFS adapter: range reads, localmd.mix/langmd.mix, base INI/CSF
      index.ts      the one entry point the UI imports

    bytes -> xif -> model -> (payload decode) -> build -> FolderSource -> importMod

Pure modules take `Uint8Array` and return data; they never touch OPFS, the
DOM or `navigator`. `base.ts` is the only part that reads the install, and it
reads ranges (a 204 MB `ra2md.mix` is never loaded whole: the encrypted index,
then `localmd.mix`, then `rulesmd.ini`).

Core types (our own design, not XCC's):

```ts
type Game = "ra2" | "ra2md";

interface ModPack {
  options: { name: string; modName: string; version: string; game: Game; mfs: string };
  modes: { id: number; name: string }[];      // root key 0x100
  modules: { id: number; name: string }[];    // root key 0x101
  entries: PackEntry[];
  warnings: string[];
}

interface PackEntry {
  category: number;          // 0..19, kept as the format's number
  fname: string;             // base name only
  ft: number;                // t_file_type, for jpeg/ogg/pcx/map decisions
  encoding: 0 | 1 | 7 | 8;   // none / diff / shp / vxl
  decodedSize?: number;      // vi_cb_d
  mode: number;              // -1 = always
  module: number;            // -1 = base
  bytes: Uint8Array;
}

/** Installed game data the pack needs. */
interface BaseData {
  ini(name: string): Promise<Uint8Array | null>;  // localmd.mix -> rulesmd.ini, ...
  csf(): Promise<Uint8Array | null>;              // langmd.mix -> ra2md.csf
}

interface BuiltPack {
  files: { name: string; bytes: Uint8Array }[];   // flat, as importMod wants
  warnings: string[];
}
```

`build.ts` mirrors the activation table in section 3 and returns warnings for
anything it cannot produce yet, rather than dropping it silently.

### Phases

1. `xif.ts` + `bzip2.ts` with unit tests (raw, zlib, bzip2; external payload;
   delta ids; string values; size caps).
2. `model.ts`: options, modes/modules, entries, category validation, module
   lookup from sibling names.
3. `shp4.ts` and `vxl4.ts`, with fixtures generated by an independent Python
   reference of this spec (decode only; no encoder needed).
4. `mix-write.ts` and `build.ts`: the target folder, diff INI/CSF merge, loose
   outputs, warnings. Tests read the generated mix back with `mix.ts`.
5. UI: `ModsScreen` accepts `.xmlf`/`.exe` and packs found in a dropped folder,
   builds a `FolderSource`, calls `importMod`. A synthetic pack drives an
   existing-screen test.
6. Deferred, reported as warnings until wanted: JPEG->PCX, OGG->WAV(IMA ADPCM),
   1-bit PCX->SHP, XIF map project->`.map`, `audio.bag`/`idx` append. Never
   silently drop a category.

`MOD_DATA` (`storage/install.ts`) gains the loose outputs the builder can emit
(`.pkt`, `.avi`, `.bik`, `.tmp`) or the builder keeps them inside the mixes.

### Status: shipped (2026-11-15)

`web/src/storage/modpack/` implements the reader and the conversion:

| File | What |
|---|---|
| `xif.ts` | header v0/v1/v2, raw/zlib/bzip2, external block, node/size limits |
| `bzip2.ts` | own decoder (multi-block, RLE1, inverse BWT, MTF/RLE2) |
| `model.ts` | options, modes/modules, entries, safe folder name |
| `shp4.ts`, `vxl4.ts` | SHP-4 and VXL-4 decoders, `cb_d` checked |
| `ini.ts` | diff over the base INI, preserving its comments and order |
| `mix-write.ts` | plain new-format MIX (ids from `mixHash`) |
| `build.ts` | the activation routing, INI/CSF merge, side merge, warnings |
| `base.ts` | OPFS range reads: encrypted index, `localmd.mix`, `langmd.mix`, side archives |
| `load.ts` | packs from a single file or a folder, EXE trailer, sibling modules |

The MODS tab takes a `.xmlf`/`.exe` from INSTALL MOD (pick the folder that
holds it) or a drop; the import detects whether the source is a pack or an
ordinary mod folder. It shows the builder's warnings after the copy.
`storage/install.ts` accepts the loose `.pkt`, `.avi` and `.bik` outputs.

Tests: `pnpm exec vitest run src/storage/modpack src/screens/launcher/ModsScreen.test.tsx`
(95 tests), plus `pnpm typecheck`, `pnpm lint` and `pnpm build`. The range
reader is also checked against this machine's real `ra2md.mix` (encrypted
index, `localmd.mix`, `rulesmd.ini`) when the file is present; that test skips
when it is not.

In-game smoke (2026-11-15): a pack built through `buildPackSource` -- a
`rulesmd.ini` difference (`Money=7500`) and a decoded `gi.shp` -- was installed
as `mods/Smoke Mod` in a test folder. The game logged `[mods] playing Smoke Mod
(/game/mods/Smoke Mod over the game's folder)`, reached a Yuri's Revenge
skirmish, showed **Credits 7500** where the unmodded game shows 10000, and drew
the GIs as the pack's solid SHP instead of the soldier sprites. The evidence
(screenshots, the merged rules and the built mixes) is
[work/tasks/mod-smoke/README.md](../work/tasks/mod-smoke/README.md). The
`ecachemd98.mix` cameo was built and decoded correctly but its sidebar slot was
not reached in the harness (the MCV deploy/selection that
`e2e/battle-controls.mjs` uses fails on this build); the unit SHP exercises the
same loader path.

Still deferred (warned, never silently dropped): sound into
`audio.bag`/`audio.idx`, JPEG->PCX, OGG->WAV, 1-bit PCX->SHP, map-project
conversion, a mode picker, a native CLI, and the launcher art/manual.

Limits: bzip2 block CRCs are not verified (the decoder checks the structure and
the declared size); randomised bzip2 blocks from very old encoders are refused;
the pack's strings and string table are read as Windows-1252; a VXL's palette
and section transform are not in the stream and are written as zero.

### What would break the licence

- Copying or mechanically translating the C++ (including its comments/names).
- Vendoring a GPL bzip2 implementation, or moving `7z-wasm` into the core.
- Committing a retail file, an XCC binary, or content extracted from a pack as
  a fixture.

