# Building DestroyAnims: the owner's house colour

A building's `DestroyAnim=` (rulesmd.ini) is an ordinary AnimClass spawned when
the building dies. In retail Yuri's Revenge it does not take the owner's house
colour: its colour-16..31 trim is drawn in one fixed colour whoever owned the
building. The web/Linux builds change that for Yuri's Revenge with
`destroy_anim_remap_patch` in `run_lift.py`. Addresses are gamemd.exe 1.001.

## What the engine does

- Spawn: `BuildingClass__virtual_315` (0x004415F0), block 0x00441CAC-0x00441D66.
  It picks a random entry of BuildingType+0x748, constructs the anim
  (`AnimClass__constructor` 0x00421EA0, no house argument; anim+0xD4, its
  palette convert, starts at 0), then tests `GetTechnoType()+0xDF0`
  (0x00441D2F). Only if that is set does it store the owner's convert,
  TechnoClass vslot 121 (0x00705D70), into anim+0xD4 (0x00441D41).
- +0xDF0 is the scheme list of the type's art `Palette=` key
  (TechnoType+0xDD0, read at 0x0071583E and 0x00716D82, loaded by 0x006263D0).
- Draw: `AnimClass__virtual_69` (0x00422CA0). With +0xD4 set (0x004232A3) it
  draws through it. With +0xD4 = 0 it uses the anim palette [0x87F6C0], or for
  `AltPalette=yes` (AnimType+0x361) the unit-palette convert of
  `ColorSchemes[0]` (0x004232D8-0x004232F0): a fixed scheme, not the owner.
  Building death anims are `AltPalette=yes` (artmd.ini: "use the unit palete").
- vslot 121 without a custom palette returns `ColorSchemes[owner]+0x30C`, the
  same kind of convert as `ColorSchemes[0]+0x30C`.
- Save/load: the save (0x004253B0) finds +0xD4 among `ColorSchemes[i]+0x30C`
  and stores the index in +0xD8; the load (0x00425330) restores it.

## Why `Palette=unittem.pal` on the building did nothing

The palette loader (0x00627590) builds the file name itself: the key's value,
then the theater suffix (table at 0x007E1BC6: TEM, SNO, URB, DES, UBN, LUN),
then `.` and the extension. `Palette=unittem.pal` asks for
`UNITTEM.PALTEM.PAL`, which does not exist, so +0xDF0 stays 0 (checked in game
with a temporary print at the gate: `df0=00000000` with that key). The value is
a base name (`Palette=unit` loads `UNITTEM.PAL`), but the engine allows only
one extra building palette and stock artmd.ini already uses one
(`[CANEWY04] Palette=lib`), so `Palette=unit` stops the game with "You have
violated the limit of having only one extra building palette." A mod has no
art-only route to the owner colour.

## The patch

`destroy_anim_remap_patch` replaces the `je 0x441D69` at 0x00441D35 (no custom
palette): when the new anim's type has `AltPalette=yes`, it goes on to the
original store at 0x00441D37 (anim+0xD4 = vslot 121), otherwise it skips as
before. Anims without `AltPalette` keep anim.pal (a unit-palette convert would
draw them in the wrong colours); types with a custom palette are unchanged.
Every instruction it relies on is checked (`DESTROY_ANIM_REMAP_SITES`); if one
differs nothing is patched. Tests: `tools/test_lift_patches.py`
(`DestroyAnimRemapTests`).

Side effect: civilian buildings with an AltPalette DestroyAnim (`CAWS01DM`,
`CACH06DM`, ...) now die in their owner's colour, matching their intact trim,
where they used `ColorSchemes[0]` before. Not checked in game.

Red Alert 2 (game.exe) has the same code (gate 0x0043E97A/0x0043E980, store
0x0043E98C to anim+0xBC, vslot 0x1CC) and is not patched.

## Test (2026-11-26, ra2md fast build)

Test mod `mods/yr/destroy-anims-test` (GAPOWR `DestroyAnim=GAPOWRDM`,
`AltPalette=yes`), with stock explosion/debris and AP anims off, Rate 75 and
`ShortGame=no`; the Desolator script of
`F:\projects\ra2-sprite-work\game-test\README.md`, run by its `run.mjs`. The
skirmish colour is random per run. Hue counts on the building body (frame
before death vs three animation frames):

| run | owner | intact: blue / purple / orange px | animation: blue / purple / orange px |
|---|---|---|---|
| 1 | orange | 65 / 0 / 491 | 29-35 / 0 / 566-657 |
| 2 | blue | 470 / 0 / 303 | 193-344 / 0 / 293-514 |
| 3 | purple | 292 / 83 / 290 | 164-177 / 49-115 / 291-311 |
| 4 (final build, no debug print) | teal | 319 / 0 / 269 | 164-177 / 0 / 291-311 |

Blue-class trim appears in the animation only for the blue and teal owners,
purple only for the purple owner (run 4's teal trim is teal by eye); before the patch the animation trim was the same orange
(126,76,0) for every owner (game-test README round 6). The intact building and
the anim body colours look unchanged by eye. Fires and other anims were not
measured; they do not pass through this code.
