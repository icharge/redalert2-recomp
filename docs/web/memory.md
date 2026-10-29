# The guest's address space

The first risk, and a change in pcrecomp, not here.

## What the lifted C assumes

The Linux build defines `RECOMP_FLAT_MEMORY`, so `ADDR(va)` is the address
itself (`runtime/recomp32/recomp_types.h`): a pointer the game holds is a
pointer the host can use. That holds because the host is a 32-bit process
and `win32hle` puts the game's memory where the game expects it:

- **The image.** `pe_loader.c` `mmap`s `gamemd.exe` at its own base,
  0x00400000, with `MAP_FIXED_NOREPLACE`. `SizeOfImage` is 0x793000, so the
  image spans 0x00400000 to 0x00B93000, about 12 MB.
- **Heaps.** `HeapAlloc` and the CRT's `malloc` go to the host's `malloc`
  (`kernel32.c`), so they land wherever the host heap is.
- **Virtual memory.** `VirtualAlloc` is an `mmap` reservation, at a given
  address if the game asks for one, otherwise anywhere. Decommit is
  `madvise(MADV_DONTNEED)`. Release is `munmap`.

## What wasm gives

One linear memory, addressed from 0, up to 4 GB with `-sMAXIMUM_MEMORY=4GB`.
Every address below the top is a valid load or store. There is no `mmap` at
a fixed address, no page protection and no faults below the top.

wasm32 pointers are 32 bits, so a guest address is a host address, exactly
as on 32-bit Linux. Flat memory can stay. The only thing wasm doesn't give us
is control over where things are placed.

## The change

1. **Keep the image's range free.** Emscripten places its static data,
   stack and heap from `GLOBAL_BASE` upward. Link with
   `-sGLOBAL_BASE=16MB`, above the image's end at 0x00B93000.
   Everything below 16 MB belongs to the guest image and nothing else.
2. **`pe_loader.c`.** Under `__EMSCRIPTEN__`, a fixed-base map checks that
   `[image_base, image_base + span)` lies below `GLOBAL_BASE`, zeroes it and
   copies the headers and sections in, as it does after `mmap` today. An
   image that doesn't fit fails with the same message. DLLs mapped
   "anywhere" use `aligned_alloc(0x10000, span)`.
3. **`kernel32.c` `VirtualAlloc`.**
   - With no address: `aligned_alloc(0x10000, size)` and `memset` 0,
     recorded in `g_region` as now.
   - With an address inside a region: unchanged (commit).
   - With an address outside every region: fail with
     `ERROR_NOT_ENOUGH_MEMORY`, as Linux does when the range is taken. The
     game handles that and retries without an address. Log it once, so a
     game that needs fixed addresses is visible.
   - Decommit: `memset` 0 over the range (pages read as zero again, the
     same contract as `MADV_DONTNEED`).
   - Release: `free`.
4. **No other changes.** `HeapAlloc` and `malloc` are already in linear
   memory. `RECOMP_FLAT_MEMORY` stays defined. The generated C is unchanged.

### Option B, if A fails

Drop `RECOMP_FLAT_MEMORY`, so that `ADDR(va)` adds `g_mem_base` (as dos32 and
nextstep do), and place the image anywhere. This costs a global load per
access in the generated C, and every place `win32hle` turns a guest pointer
into a host pointer (`APTR`, `RETP`) must add or subtract the base. It's
the fallback, not the plan ([decisions.md](decisions.md), D2).

## Memory size

- `-sINITIAL_MEMORY=640MB`, `-sALLOW_MEMORY_GROWTH=1`,
  `-sMAXIMUM_MEMORY=768MB`. This caps Wasm linear memory below 1 GiB, leaving
  room for compiled code and small browser-side buffers. This is not a total
  browser-process cap. To keep the game within that total budget the archives
  stay in OPFS and are read in place through WasmFS ([storage.md](storage.md),
  "How the game reads its files"): copying a 1 GB install into memory would
  not fit under this cap. WasmFS's in-memory files live in this linear memory,
  so only the small files (under 1 MiB) are copied into it. Growth with
  pthreads makes every JS view of memory re-check its buffer.
- The host's C stack: `-sSTACK_SIZE=8MB` and
  `-sDEFAULT_PTHREAD_STACK_SIZE=8MB`, as on Linux. Every `RECOMP_CALL` is a
  real C call, and the game's call chains are deep. The guest's own stack
  (`esp`) is guest memory, allocated by `CreateThread` as now.

## Bounded caches

- `src/web/read_cache.c` holds at most eight 1 MiB blocks (8 MiB of payload)
  and 64 small per-file trackers.
- `src/runtime/hdvox.c` holds two record arenas, each capped at 24 MiB
  (48 MiB total).
- The 2x image memo has 1,024 round-robin entries. A source rectangle is at
  most 256x256; each stored 2x image takes `4 * w * h` bytes, so memo pixel
  payload is capped at 256 MiB, plus the entry metadata.
- The picture publisher has three current frame slots. Each slot's payload is
  `w * h * bytes_per_pixel`; replacement buffers remain alive while the page
  reads or displays them, then are collected. Both WebGL and 2D presenters
  publish `readIndex`, so collection does not depend on the presenter mode.
  During replacement, up to three prior slot buffers may also be awaiting
  release.
- HD composition layers are not allocated by the current browser build; Task
  5's GPU HD layer implementation is deferred. Its proposed upper bound, if
  implemented later, is `w * h * 4 + 4 * w * h * 2` bytes.

These are source-level caps, not measured process peaks. The HD-off 1440p
ten-minute soak ran in headed Chrome at 2560×1440 and completed after one
automatic reload when the match returned to the 800×600 menu shell. With
`INITIAL_MEMORY=640MB`, Wasm peaked at 640 MiB and grew by 0 bytes after the
first 60 seconds; the zero-growth gate passes. JS heap growth was 2,571,580
bytes, and every running-game sample published a picture. The previous run
with 256 MiB initial memory grew 137.7 MiB after the automatic save reload and
reached 768 MiB. The main-menu peak was 627.5 MiB, which rounds to 640 MiB for
`INITIAL_MEMORY`. An earlier 4K HD-off soak peaked at 442.5 MiB with no Wasm
growth after the first minute. Its peak plus 25% is below the 768 MiB floor,
so `MAXIMUM_MEMORY` remains 768 MiB. Repeat the 4K soak on the final build.

## Check

`pe_loader_selftest.c` and `kernel32_ext_selftest.c`, built with emcc and
run under Node, pass. Then, in stage 3, the game maps and binds:
`mapped C:\gamemd.exe: 0x00400000-0x00B93000` in the log.
