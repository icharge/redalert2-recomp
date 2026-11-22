# Reverse engineering: finding out what an address is

The lift does not need to know what a function does. People do, at three
points: choosing the instruction a patch goes on (`run_lift.py`), reading game
memory from the host (modern controls, queue-five, HD voxels, save info), and
doing either for both `gamemd.exe` and `game.exe`.

Two tools help, both adapted from how [VERA20K](https://github.com/YuriPlanet/vera20k)
works. VERA20K is a Rust rewrite of Yuri's Revenge; it has to understand every
function it ports, so it has studied the same Yuri's Revenge 1.001 code this
project lifts.

## The rule: a name is a lead, the bytes are the proof

It is VERA20K's rule and it fits here. A name from Ghidra, YRpp, Ares or
VERA20K says where to look. What a patch or a host read may rely on is what
the instructions, the strings and the callers show. VERA20K's own notes list
YRpp addresses that land inside an instruction and names that turned out to
describe another function.

The patches already work this way: `yr_startup_order_patches` checks every
call and byte it depends on and patches nothing when one differs.

## Looking an address up in VERA20K

```
py -3 tools/vera_lookup.py 0x6FDD50
py -3 tools/vera_lookup.py sub_005BED40 0x7CA650 --max 5
```

It needs a VERA20K checkout beside this one (`../vera20k`; `--vera` or the
`VERA20K` variable for another place). For each address it prints:

- the names written next to it in VERA20K's source, with how often;
- what VERA20K's Ghidra naming passes say (`tools/ghidra_pass/passes/*.json`):
  a rename and the evidence recorded for it;
- every line of its Rust source and Markdown that cites the address;
- cited ranges the address falls inside (`0x006F9042..0x006F9148`);
- when nothing cites it, the nearest cited address on each side.

The first run reads the checkout (about three seconds) and keeps where each
address is cited in `work/vera_index.json`; later runs take a fifth of a
second. The index is rebuilt when the checkout's commit changes. `--no-cache`
reads it afresh, for a checkout with uncommitted changes.

Limits:

- **Yuri's Revenge only.** VERA20K knows nothing of `game.exe`. Find the
  Red Alert 2 counterpart by the function's strings or bytes, as the patches
  in `run_lift.py` do.
- **Read in place.** VERA20K is GPLv3 with added terms and this project is
  MIT. The tool copies nothing from it into this repo (`work/` is ignored);
  do not paste its code or its ledger text here either.
- **Exit status**: 0 found, 1 nothing cites it, 2 no checkout.

Worth reading in that checkout before touching a game object from the host:

- `docs/ghidra-workflow.md`, "Class layouts": the `TechnoClass`, `FootClass`
  and `BuildingClass` fields checked against the code, and where YRpp's
  headers are wrong.
- The same file, "Interpret evidence": the ways a decompile misleads on this
  binary, each with the address where it did.

## The names ledger

What has been established about a function goes in a ledger, one per edition:

```
names/gamemd.json    Yuri's Revenge
names/game.json      Red Alert 2
```

```json
{"address": "0x007CA650", "name": "CRT__chkstk",
 "evidence": "Bytes: push ecx; cmp eax, 0x1000; ... MSVC 6's stack probe. 39 direct callers."}
```

- **`address`** is the function's first instruction, `0x` and eight digits.
- **`name`** is `Module__Function`, the shape the lift's own names have
  (`MapClass__Init_Clear`). It becomes a C function in the build, so a bare
  `memcpy` or `_ftol` would collide with the C library's; the loader refuses
  one.
- **`evidence`** says what in the binary shows it. No entry without it.

When the same function is known in both editions, give it the same name in
both files and let each entry's evidence name the other's address.

```
py -3 tools/names_ledger.py                        # check both ledgers
py -3 -m unittest tools/test_names_ledger.py tools/test_vera_lookup.py
```

### Into the generated C

`run_lift.py` reads the edition's ledger before it lifts, so a bad ledger
stops the run at once and not after the minutes a lift takes. After the lift
it hands the names, with the hook names, to pcrecomp's `name_lift.py`, which
writes them over `sub_XXXXXXXX` everywhere in the generated tree and puts a
header on each function:

```c
/* CRT__chkstk (0x007CA650)
 *   named by the host
 *   called from 39 places
 */
void CRT__chkstk(void) {
```

"Named by the host" is `name_lift.py`'s wording for a name it was given; the
evidence stays in the ledger. The lift's last lines say how many names the
ledger had, and list any entry whose address is not the start of a lifted
function (a typo, or an address inside a function):

```
[*] names: N of M functions named from the binary's own evidence and the ledger (6 names, names\gamemd.json)
[!] names: 0x007CA654 (CRT__mid_function) is not the start of a lifted function; the ledger entry names nothing
```

A ledger name wins over one `name_lift.py` would have inferred. A hooked
function keeps its `hook_` name: the ledger may not name it, and the lift
refuses a ledger that does.

Two things to know:

- **A ledger edit does not force a lift.** A name changes no behaviour, so the
  ledgers are not part of the lift stamp (`lifter_stamp()`,
  `cmake/lift_check.cmake`). A new name reaches the generated C at the next
  lift, whenever a patch or a lifter change causes one.
- **Nothing outside the generated tree may use a `sub_` name.** The host
  sources (`src/runtime`, `src/web`, `src/linux`) use none today, only two
  comments mention one, so a new name cannot break them. A patch in
  `run_lift.py` may write `RECOMP_CALL(sub_005312A0)`: patches are emitted
  before the names are applied, and the rename covers them.
