# Runtime bundle and edition readiness plan

## Goal

Stop asking players to import `game.exe`, `gamemd.exe`, or `Blowfish.dll` for
each browser installation. The local web build supplies the exact runtime
inputs for the editions it builds. Players continue to provide the MIX
archives and other game content. The launcher reports whether Red Alert 2,
Yuri's Revenge, both, or neither have enough content to run.

## Runtime evidence

The web host requires its target executable at startup: `src/web/main.c`
checks its PE timestamp and maps the PE image into Wasm memory. The
registration-free Blowfish COM implementation in `src/linux/blowfish.c` reads
the initial cipher tables from `Blowfish.dll` when the game first requests the
object to decrypt MIX headers. They are runtime inputs: the game logic itself
is lifted and compiled to Wasm, but the native host still reads the PE image
and cipher tables when the game runs.

The game logic is built to Wasm from lifted C. The runtime bundle is still
needed because the host maps the target PE image and the cipher implementation
uses its initialization tables. The bundle does not replace the user's MIX
archives.

## Approach

1. **Trace the actual content requirements first.** For each edition, produce
   an evidence-backed manifest of required core archives and optional content.
   Derive it from archive opens in the lifted runtime and validate it against
   complete supported installs and successful browser boots. Do not treat the
   importer's current `*.mix` allowlist as proof that every archive is required.
2. **Generate local runtime bundles.** Extend the existing per-target web build
   to produce one bundle for each built edition. Each bundle contains the
   matching PE image (`game.exe` for RA2 or `gamemd.exe` for Yuri's Revenge),
   the shared `Blowfish.dll`, and metadata tying them to the Wasm build ID,
   expected PE stamp, and input hashes. Keep outputs below ignored
   `web/public/game/` (or another ignored build-output directory); never add
   retail-derived files to Git or publish them.
3. **Stage bundle files at launch.** The page loads the selected edition's
   bundle and exposes the PE image and DLL at the paths expected by
   the C host. Keep the runtime's stamp/build checks, now against the bundled
   image. Remove these files from the user import allowlist and required-file
   blocker. The runtime bundle must fail clearly when the selected edition
   was not built or its metadata does not match the Wasm target.
4. **Report readiness per edition.** Inspect the user's content once, then
   compute separate RA2 and Yuri's Revenge reports. Shared base-game archives
   count toward both; Yuri-specific archives count only toward Yuri's Revenge.
   Show `Ready`, `Missing required content` with filenames, or `Runtime not
built`. Keep optional movies separate from core readiness and explain what
   omitting them changes. A folder containing both editions may be ready for
   one and incomplete for the other.

## Implementation status

The local build now copies the matching edition executable and
`Blowfish.dll` into ignored `web/public/game/runtime/<edition>` output and
records their hashes, edition, PE timestamp, and Wasm build ID. At launch, the
browser verifies those hashes and stages both files before starting the host.
Imports no longer ask for either runtime file. MIX archives remain user
content. Import review and Library report readiness per edition; Play is
disabled when the selected edition lacks a built runtime or required core
archives.

The filename readiness check passes for both editions in the local `game/`
folder. Fresh target relinking and menu/skirmish smoke runs are still needed
before claiming end-to-end readiness. The gate does not validate archive
integrity.

## Readiness rules to establish

The exact archive manifest is an open research item, not an assumption. Record
the source for each required entry and include at least:

- common Red Alert 2 archives used by both editions;
- Yuri's Revenge-only archives and data;
- archives required to reach the main menu versus archives needed for a full
  skirmish;
- optional movie archives and the behavior when they are absent;
- any required non-MIX files the runtime reads from the user install.

The first readiness gate now checks the loose archives with hard-failure paths
in the generated startup code:

| Edition        | Required loose content               | Optional movie archives     |
| -------------- | ------------------------------------ | --------------------------- |
| Red Alert 2    | `ra2.mix`, `maps01.mix`, `multi.mix` | `movies*.mix`               |
| Yuri's Revenge | the Red Alert 2 set plus `ra2md.mix` | `movies*.mix`, `movmd*.mix` |

Evidence: the startup loader opens `MAPS%02d.MIX` and `MULTI.MIX` in
[`src/recomp/gen_game/recomp_0007.c`](../../src/recomp/gen_game/recomp_0007.c)
and its Yuri counterpart in [`src/recomp/gen/recomp_0007.c`](../../src/recomp/gen/recomp_0007.c);
the archive initialization paths also require `RA2.MIX` in
[`src/recomp/gen_game/recomp_0018.c`](../../src/recomp/gen_game/recomp_0018.c)
and `RA2MD.MIX` for Yuri in [`src/recomp/gen/recomp_0020.c`](../../src/recomp/gen/recomp_0020.c).
The map loop fails if its first base map archive is absent. Movie archive opens
have a 12-byte empty-archive fallback. Import creates placeholders for the
startup probes `MOVIES01.MIX` and, for Yuri, `MOVMD03.MIX` even when those files
are absent from the source folder. The browser also stages these placeholders
for legacy imports missing them, so movie omission does not block core
readiness. `MAIN.MIX` and theme packs are probed but their startup
paths continue when they are absent; the local supported install also has no
loose `MAIN.MIX`.

This filename gate says the edition has the core content required by those
startup paths. It is not a content-integrity check and does not yet claim a
successful skirmish; scripted menu and skirmish verification remains W14.5.

The check must distinguish a bootable menu from a complete playable install if
the evidence shows those require different file sets. It must not report an
edition ready solely because its runtime bundle exists.

## Verification

- Build the Yuri's Revenge and Red Alert 2 targets from local supported source
  installs; verify each bundle's build ID, PE stamp, edition, and input hashes.
- Import content with no executable or Blowfish DLL present. Confirm these
  files are supplied from the local bundle and are absent from the user's
  imported-file records; MIX archives remain in OPFS.
- Test four readiness cases: both editions complete, RA2-only content,
  Yuri-only additions missing, and a deliberately missing required shared
  archive. Confirm the two edition statuses are independent and list exact
  missing files.
- Boot each edition to the main menu and run a scripted skirmish using only
  its runtime bundle plus user-provided content. Check optional movie behavior
  separately.
- Confirm generated bundles are ignored by Git and are not included in the
  public page or service-worker precache.

## Constraint

This plan is for local builds that use the player's licensed game files as
inputs. The existing project rule remains: do not commit or publicly serve
generated game-derived artifacts. A hosted page that preloads these bundles
would require a separate policy decision and is outside this plan.
