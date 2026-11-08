# Reading a saved game

How to find out what a `.sav` is (its title, which game wrote it, when) without
loading it, and how to load one in a test. This is how the "Operation:
Sub-Divide" save was picked out of a folder of `SovNNx.sav` files for the
load-stall fix below.

## Where saves are

The game writes its saves beside its exe as `SAVE%04lX.sav` (`SAVE0001.sav`,
...). The file name says nothing about the mission; the title is inside. In
the browser the page copies them to `save/<edition-storage>/` in OPFS
([web/storage.md](web/storage.md#saves)). Saves kept for testing live in
`work/perf/` and `work/perf/user-saves/` (not in version control).

## The file format

A `.sav` is an **OLE compound file** (the same container as old `.doc` files):
a small FAT file system with named streams. `CONTENTS` holds the game state
itself (1 to 2 MB, the game's own serialised objects). Beside it the game
writes small header streams, which are what the Load Saved Game screen lists:

| Stream | Type | Example | Meaning |
|---|---|---|---|
| `Scenario Description` | UTF-16LE, NUL-terminated | `[Operation: Sub-Divide]`, `Skirmish Game` | The title on the Load screen |
| `Internal Version` | int32 LE | `0x288CC` / `0x2B898` | Save-format number: `0x288CC` is Red Alert 2 (`game.exe`), `0x2B898` is Yuri's Revenge (`gamemd.exe`) |
| `Version` | int32 LE | `1` | |
| `Scenario Number` | int32 LE | `6` | Mission number within the campaign (RA2 Allied saves seen so far use 20 to 23 for missions 9 to 12) |
| `Campaign` | int32 LE | `1`, `2`, `-1` | Which campaign. Seen: RA2 Allied `1`, RA2 Soviet `2`, Yuri Soviet `1`, skirmish `-1` |
| `GameType` | int32 LE | `0`, `5` | Seen: campaign `0`, skirmish `5` |
| `Player House` | UTF-16LE | `America`, `Russia`, or empty | Often empty in campaign saves |
| `Player Name`, `Player Name2` | UTF-16LE | empty | |
| `Executable Name` | UTF-16LE | `SUN.EXE` | Always `SUN.EXE` (a Tiberian Sun leftover); it does not tell the games apart |
| `Start Time`, `Last Save Time`, `Play Time` | FILETIME (uint64 LE, 100 ns since 1601 UTC) | `2011-11-10T17:01:00Z` | The three have been equal in every save checked |

Saves from some older installs also carry a `\x05SummaryInformation`
property set that repeats the title (property 2) and times. Saves this
build makes do not, so read the named streams, not that.

`Internal Version` is the useful check before loading: the other game's save
is refused, and a save from a different install of the same game (for
example the 2011 user saves here, against the 2026 saves this build writes)
can hold values this install doesn't expect.

## Reading it

`tools/save_info.py` prints the header of one or more saves (it needs
`pip install olefile`):

```bash
python tools/save_info.py work/perf/user-saves/Sov06T.sav
```

```
work/perf/user-saves/Sov06T.sav
  title     '[Operation: Sub-Divide]'
  game      Red Alert 2 (game.exe) (internal version 0x288CC)
  scenario  6  campaign 2  game type 0  house ''
  saved     2011-11-10T17:01:00+00:00  (started 2011-11-10T17:01:00+00:00)
  state     1429252 bytes in CONTENTS
```

To find a save by its title, list a folder and search:

```bash
python tools/save_info.py "work/perf/user-saves/*.sav" | grep -B1 -A4 "Sub-Divide"
```

`--json` prints one object per save, for scripts. With nothing installed, a
rough look also works, because the stream names and the title are plain
UTF-16 in the file:

```bash
python -c "import re,sys; b=open(sys.argv[1],'rb').read(); print([s.decode('utf-16le') for s in re.findall(rb'(?:[\x20-\x7e]\x00){6,}', b)][:20])" work/perf/user-saves/Sov06T.sav
```

## Loading one in a test

`web/e2e/load-saved-game.mjs` loads a real save through the imported game in
a headless browser and requires the simulation to advance (it reads the
game's frame counter, RA2 `0x00A40D2C`, Yuri `0x00A8ED84`). It uses a
disposable profile (`work/load-saved-game/profile`) and replaces the `.sav`
files in that profile's `/game`:

```bash
cd web
node e2e/load-saved-game.mjs --save ../work/perf/user-saves/Sov06T.sav --game ../game --require-reference-prompt --shots ../work/sub-divide-fixed
```

`--edition ra2md` loads a Yuri's Revenge save. `--require-reference-prompt`
fails the run unless the unresolved-reference dialog (below) appears and is
answered with Ignore & Continue.

## Unresolved references in a save

While loading, the game rebuilds pointers between saved objects
(`SwizzleManagerClass`, RA2 `0x0069FC30`). When a saved pointer has no
matching object, the original code divides by zero on purpose
(`idiv` at RA2 `0x0069FCBD`, Yuri `0x006CF3DD`) to crash. The lifter's
generic divide fallback returns zero instead, so the loop never moved on:
the Sub-Divide save sat at one simulation frame forever, which looked like
an endless load. `save_reference_fault_patch` in `run_lift.py` replaces both
sites with a page dialog: **Ignore & Continue** clears the dangling pointer
and moves to the next entry; **Cancel Load** stops the load. Native builds
have no dialog, so they keep the original crash (`host.c` stub returns 0).

The loop merges two sorted lists: the pointers waiting to be fixed (`edi`,
count `ebp`) and the objects loaded so far (`ecx`, count `ebx`). Its inner
step (RA2 `0x0069FCA0`, Yuri `0x006CF3C0`) moves `ecx` forward while the
request is larger, with no end check. A request above every known object
walked `ecx` off the array: after 214 ignored references the Sub-Divide load
crashed inside `sub_0069FC30` with `ecx` far past the list. The same patch
makes that step treat "no entry left" (`ebx <= 1`) as unresolved, so it goes
to the same prompt.

### Saves from another install

`work/perf/user-saves/` came from another install (all dated 2011). In the
browser, as of 2026-11-09:

| Save | Result |
|---|---|
| `busy-ra2.sav` (made by this build) | Loads and runs in 4.8 s, no prompt |
| `Sov06T.sav` (Sub-Divide) | One prompt; Ignore & Continue clears 447 references and reaches a running mission in 5 s, but mostly under shroud with an empty build list, so the restored state is incomplete (`work/sub-divide-fixed/`) |
| `Sov02T.sav` (Hostile Shore) | No unresolved references; crashes in `sub_007825E8` (heap free) |
| `Sov12S.sav` | A song id that is really a pointer (`0x30005C1B`), see [web/issues.md](web/issues.md) #16 |
| Yuri `busy.sav` (made by this build) | Loads in 7.3 s, no prompt |
| Yuri `Sov03UMD`, `Sov05UMD`, `Sov07TMD` | One prompt (1 to 11 references cleared), then a running mission in about 9 s |
| Yuri `Sov01UMD`, `Sov02SMD` | One prompt (3 and 1 cleared), then a crash in `sub_005471F0` |
| Yuri `Sov06LMD` | One prompt (6 cleared), then a crash in `sub_004C1AC0` |
| Yuri `Sov04DMD` | No prompt; crashes in `sub_007C946E` (heap allocation) |

The Yuri runs are in `work/yr-load/<name>/` (`e2e/load-saved-game.mjs --edition ra2md`).
`Sov04DMD` crashes with no reference cleared, like RA2's `Sov02T`. So clearing
references is not what breaks the others: the state in these saves doesn't
match this build.

Their header matches this game (`Internal Version` `0x288CC`), but the state
inside does not: hundreds of pointers with no object, and fields holding
values of the wrong kind. The likeliest cause is a different `game.exe`
build that kept the same version number. So the header check above can't
prove a save will load; loading it is the only test.
