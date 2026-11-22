# Handoff: reverse-engineering tools (address lookup, names ledger)

Reference: [reverse-engineering.md](reverse-engineering.md), which says what
the tools are and how to use them. This file says where the work stands.
Updated 2026-11-11. Everything is in the working tree on `web-port`,
uncommitted; there are unrelated in-progress changes in this checkout
(`docs/web/`, `docs/superpowers/plans/`), so preserve them.

## Where it stands (2026-11-11): lifted and built

Both editions were lifted again with the ledger wiring and both build
(`build/ra2.exe`, `build-game/ra2.exe`); `run_lift.py --check` exits 0 for
both. The real lift found two things the earlier tests could not:

- `main()` reused the name `known` for another list, so `name_lift` got a list
  and crashed. The ledger names now travel as `host_names`.
- The lift emits calls to three web-only functions (`web_wol_icon_surface`,
  `ra2_net_tuning_timing_send_rate`, `ra2_net_tuning_timing_max_ahead`, from
  `wol_icon_surface_patches` and `net_timing_event_patches`), so no native
  link could succeed. `src/runtime/host.c` now stubs them for non-browser
  builds, as it already did for `ra2_web_save_reference_prompt`. The Linux
  build does not compile `host.c` and has not been tried.

Checked on that lift: `[*] names:` counts 6 ledger names per edition, no
`[!] names:` line, 7 "named by the host" headers per tree (six names and the
hook), no `sub_` reference left to a ledger address. Not done: running the
built game, and the web build with this lift.

The analysis and disassembly took about 4 minutes in all here, not the 15
the earlier estimate gave.

## What was done

Started from a read of how VERA20K (`../vera20k`, a Rust rewrite of Yuri's
Revenge) does its reverse engineering. Most of it serves a rewrite and does
not fit a lift; two things did, and both are built:

| Piece | Files |
|---|---|
| Address lookup in a VERA20K checkout | `tools/vera_lookup.py`, `tools/test_vera_lookup.py` (15 tests) |
| Names ledger, loader and checks | `tools/names_ledger.py`, `tools/test_names_ledger.py` (14 tests), `names/gamemd.json`, `names/game.json` (6 entries each) |
| Ledger into the lift | `run_lift.py`: 16 lines added, 3 removed |
| Docs | `docs/reverse-engineering.md`, a paragraph in `README.md` ("Reading the lifted C"), a bullet in `CONTRIBUTING.md`, two bullets in `CLAUDE.md` |

## Checked, and not

Checked:

- Every `tools/test_*.py` file passes with the wiring in, `test_lift_patches`
  (74) and `test_lift_check` (3) among them.
- The lookup against the real checkout: 3.4 s the first run, 0.2 s from the
  index; exit codes 0, 1 and 2.
- The wiring's data path, on a three-function scratch tree through
  pcrecomp's real `name_lift.name_lift` with the real `gamemd.exe`: the
  ledger's names replaced `sub_` names at the definitions and the call
  sites, the hook kept `hook_debuglog`, and `not_function_starts` listed the
  entries the scratch tree had no function for.
- Each seed entry's evidence, against both executables: call targets, string
  addresses, and that the stack probe's 47 bytes and the float-to-int
  helper's 61 bytes match between the editions.

Not checked: that the built game runs, and the web build on this lift.
Six functions change name in each edition and the native builds link, so no
break from the renaming is expected.

## Things found on the way

- This machine's `game/gamemd.exe` is 4,813,072 bytes and keeps the original
  body at `0x0049F5C0`; `docs/RECON.md` describes the Steam build
  (5,286,208 bytes, `mov al, 1; ret` there). The PE timestamp is the same,
  so `run_lift.py` accepts both. The seed evidence uses strings that hold
  for either.
- The lift cuts some native functions into pieces: `sub_005312A0` ends at
  `0x0053138C` in the generated tree, and "GUI:LoadingEx" (`0x005314F8`) is
  in the next piece. A ledger entry names the piece that starts at its
  address, no more.
- VERA20K is GPLv3 with added terms; this project is MIT. The lookup reads
  it in place and its index stays in the ignored `work/`.

## What could come next

Not started; none of it is owed.

- **A cross-edition site matcher.** Red Alert 2's patch sites are found by
  hand from Yuri's Revenge's ("found by their shapes", `run_lift.py`). A
  tool that takes a `gamemd.exe` address and finds the `game.exe`
  counterpart by bytes with the addresses masked would turn the stack-probe
  and float-to-int matches above into a command.
- **More ledger entries**, as functions are worked out. Good first sources:
  the comments already in `run_lift.py` (each patch names what it patches)
  and the addresses `docs/bringup.md` discusses.
- **`name_lift.py` could print the evidence** in the header in place of
  "named by the host". That is a change in pcrecomp, its own commit there.

## Suggested skills

- `superpowers:test-driven-development` for any change to the two tools:
  both were written test first.
- `superpowers:verification-before-completion` before calling the wiring
  verified: it needs the real lift above.
- `reverse-engineer-anything` (REA) when a ledger entry needs a function
  read in a disassembler and not only in the lifted C.
