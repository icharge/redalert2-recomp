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

- `-sINITIAL_MEMORY=1GB`, `-sALLOW_MEMORY_GROWTH=1`, `-sMAXIMUM_MEMORY=4GB`.
  Growth with pthreads makes every JS view of memory re-check its buffer.
  The game's JS side is small (the audio ring, the crash report), so this is
  cheap here. Stage 3 measures the game's real peak, and `INITIAL_MEMORY` is
  set above it so growth is rare.
- The host's C stack: `-sSTACK_SIZE=8MB` and
  `-sDEFAULT_PTHREAD_STACK_SIZE=8MB`, as on Linux. Every `RECOMP_CALL` is a
  real C call, and the game's call chains are deep. The guest's own stack
  (`esp`) is guest memory, allocated by `CreateThread` as now.

## Check

`pe_loader_selftest.c` and `kernel32_ext_selftest.c`, built with emcc and
run under Node, pass. Then, in stage 3, the game maps and binds:
`mapped C:\gamemd.exe: 0x00400000-0x00B93000` in the log.
