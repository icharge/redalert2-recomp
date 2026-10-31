# The game cursor on a page layer

**Status: implemented through Phase 2; verification and docs (P1.4, P2.4, P3.2–P3.4) still open.** This page is the design and the task
breakdown for moving the in-match software cursor from the game's picture to a
page layer, so it moves at display refresh rate like the native pointer. It
assumes the reader knows [protocol.md](protocol.md) (shared memory) and
[architecture.md](architecture.md) (input and presentation).

Related, already done:

- `?show-cursor=1` keeps the browser pointer visible (crosshair) with a green
  ring at the position the page reports to the game; it does not take Pointer
  Lock. See [testing.md](testing.md).
- A match start no longer flings the pointer-locked cursor to an edge when the
  picture changes from the 800×600 menus to the match size
  (`web/src/game/input.ts`).

## Problem

In a match the game blits its software cursor into the primary surface. The
page only sees published frames, so the cursor position advances at the game's
frame rate and is delayed by 1–2 presentation frames:

```
mouse event → shared pointer → game mouse thread → game draws the cursor
            → primary unlocked → presenter copies → page rAF → WebGL → compositor
```

The position the page sends is immediate (`shared.pointer_x/pointer_y`), so the
drawing is what needs to be decoupled from the frame. The game's own cursor art
must be kept: the cursor changes with context (move, attack, select, …).

## What exists

- `ra2_shared_t` (src/web/web_api.h, mirrored by `Shared` in
  web/src/game/protocol.ts) publishes the pointer position, a cursor
  sequence/kind/hotspot, and a 32×32 RGBA image. That image path is used by the
  menus' Windows cursor and the pause overlay.
- `src/web/presenter.c::update_cursor` publishes the Windows cursor the game
  sets; `warp_cursor` publishes game-initiated pointer moves.
- `web/src/screens/Play.tsx` has a rAF overlay for `?show-cursor=1` that maps a
  game point through the letterbox; the page-cursor draw can reuse that math.
- In a match the game does not call `SetCursor`; it draws an SHP frame itself,
  so `cursor_kind` is `NONE` and no sprite reaches the page.

## YR evidence (analysis so far)

From `game\GameMD.exe` (Ghidra via REA):

- Cursor art: `MOUSE.SHA` at `0x82604c`, `MOUSEPAL.PAL` at `0x826084`.
- `MouseClass` vtable `0x7E1964` (32 slots); `WWMouseClass` vtable `0x7F7B2C`
  (18 slots).
- Current position: WWMouse object at `0xB78164`, `+0x14/+0x18`, written by the
  poll at `0x7BA090` (mouse thread `0x7B8610`; interval hook `0x7B8536`).
- `0x56BBE0` walks a 256-entry cursor/timing table — a candidate, not yet
  confirmed as the draw path.

The exact draw call site, the current-shape pointer and the hotspot are Phase 0.
The generated tree (`src/recomp/gen`) is regenerated from `run_lift.py`; never
edit it by hand.

## Design

### Host (game thread)

1. **Hook the draw.** A `run_lift.py` hook at the game's cursor-blit site, per
   edition, with a byte-signature guard. It captures the active shape (frame
   pixels, size, hotspot) and the target position.
2. **Publish on change.** Convert the shape to RGBA (same approach as the
   Windows cursor, or the shape's palette) and write it to shared memory with a
   new sequence number, size, hotspot and a page-cursor kind. Animated cursors
   bump the sequence when their frame changes.
3. **Suppress only when asked.** The page sets a request word when it can draw.
   The hook skips the in-surface blit only while that word is set; otherwise
   the in-frame cursor remains (safe fallback if the hook is missing or the
   page stalls).
4. Menus, pause and the Windows-cursor path are unchanged.

### Protocol

Bump `RA2_WEB_PROTOCOL` and **append** fields to `ra2_shared_t`, so the existing
cursor block's offsets and static asserts stay stable:

| Field | Meaning |
|---|---|
| `page_cursor_seq` | up whenever the sprite or its visibility changes |
| `page_cursor_kind` | hidden, image (the page draws it) |
| `page_cursor_w/h` | sprite size |
| `page_cursor_hot_x/y` | hotspot |
| `page_cursor_rgba` | fixed maximum (64×64 = 16 KB pending Phase 0) |
| `page_cursor_request` | page-written; the host reads it with Atomics |

The page ignores the block when `protocol` is lower than the new version. Keep
the existing 32×32 `cursor_rgba` unchanged.

### Page

- A dedicated overlay canvas above the game canvas, drawn in rAF from the
  shared pointer and sprite: letterbox + `dpr`, offset by the hotspot, hidden
  when the kind says hidden.
- The same visibility rules as the game: menus, pause, movies, and the
  settings/exit dialogs keep their current cursor paths; the request word is
  cleared when the page stops or the tab is hidden.
- Gate: `?cursor=page` first (like the other debug flags); a saved setting can
  follow.

## Task breakdown

Sizes are relative (S/M/L), not dates. Every task lists what "done" means.

### Phase 0 — locate the draw (gate: stop if this fails)

| ID | Size | Task | Files | Done when |
|---|---|---|---|---|
| P0.1 | M | Find the YR cursor-blit call site, current-shape pointer/index, frame size and hotspot; note how each changes on hover | this page | addresses + struct offsets recorded; confirmed on a running match |
| P0.2 | M | Repeat for Red Alert 2 (`game\game.exe`); record signature pairs | this page | both editions have guarded sites |
| P0.3 | S | Measure the largest `MOUSE.SHA` frame and whether cursors animate | this page | buffer size and animation rule fixed |
| P0.4 | S | Temporary debug log of shape id/size/hotspot while moving over units/ground | `run_lift.py`, `src/web/presenter.c` (temporary) | log tracks the visible cursor |
| P0.5 | S | Gate review | this page | go/no-go recorded here |

### Phase 1 — publish the sprite and suppress the blit

| ID | Size | Task | Files | Depends | Done when |
|---|---|---|---|---|---|
| P1.1 | S | Extend the shared struct and TypeScript mirror; bump the protocol; static asserts | `src/web/web_api.h`, `web/src/game/protocol.ts`, `docs/web/protocol.md` | P0.5 | protocol builds; docs updated |
| P1.2 | M | Add the draw hooks and signature guards for both editions, with lift-patch tests | `run_lift.py`, `tools/test_lift_patches.py` | P0.2 | lift tests pass; no site matches → feature off |
| P1.3 | M | Publish sprite on change; skip the blit only when `page_cursor_request` is set | `src/web/presenter.c`, `run_lift.py` | P1.1, P1.2 | one sprite per shape; no blit while requested |
| P1.4 | S | Temporary corner overlay proves the published sprite matches the in-game cursor for move/attack/select | `web/src/screens/Play.tsx` (temporary) | P1.3 | pixel-identical sprite, correct hotspot |

### Phase 2 — page cursor

| ID | Size | Task | Files | Depends | Done when |
|---|---|---|---|---|---|
| P2.1 | M | Overlay renderer: rAF, letterbox mapping, dpr, hotspot | `web/src/screens/Play.tsx`, `Play.module.css`, new `web/src/game/cursor-layer.ts` | P1.3 | ring test with a known sprite lands exactly on the pointer |
| P2.2 | M | Request/visibility state machine: set when ready, clear on stop/hidden; hide in menus/pause/movies/dialogs | `web/src/game/cursor-layer.ts`, `Play.tsx` | P2.1 | exactly one cursor in every state |
| P2.3 | S | `?cursor=page` gate and one dev log line | `Play.tsx` | P2.2 | flag off → unchanged behavior |
| P2.4 | S | Compare with `?show-cursor=1` (system pointer vs page cursor vs game cursor) | manual | P2.3 | no drift or jump observed |

### Phase 3 — verification and documentation

| ID | Size | Task | Files | Depends | Done when |
|---|---|---|---|---|---|
| P3.1 | S | Unit tests for mapping/hotspot/visibility | `web/src/game/cursor-layer.test.ts` | P2.1 | tests pass |
| P3.2 | M | e2e: overlay follows the pointer in a match; no in-frame cursor pixels remain; both editions | `web/e2e/` | P2.4 | screenshots + position samples pass |
| P3.3 | M | Regression: menus, pause, movies, settings, classic/modern, mods replacing `MOUSE.SHA` | e2e + manual | P3.2 | no regressions |
| P3.4 | S | Document the flag and protocol fields | `docs/web/testing.md`, `docs/web/protocol.md`, `docs/web/README.md` | P3.3 | docs index links here |

### Phase 4 — optional native parity

| ID | Size | Task | Files | Depends | Done when |
|---|---|---|---|---|---|
| P4.1 | M | Reuse the published sprite in the native presenter behind the same request flag | `src/runtime/present.c`, `src/runtime/host.c` | P3.4 | `--run` matches the browser behavior |

**Execution order:** P0.1 → P0.2/P0.3 → P0.4 → P0.5 → P1.1/P1.2 → P1.3 → P1.4
→ P2.1 → P2.2 → P2.3 → P2.4 → P3.x. P4 only after P3.

## Risks

- **RE variance between editions.** Hooks must fail closed (keep the in-frame
  cursor) when the signature does not match.
- **Lift churn.** Addresses live in `run_lift.py` with signature guards and
  tests; record them here after Phase 0.
- **Double cursor during transitions.** Keep suppression and page drawing
  driven by the same request word; verify in e2e.
- **Animated/large cursors.** The sequence must change on animation steps; the
  buffer must cover the largest frame.
- **Mods.** Read the shape the game loaded, never the file on disk.
- **Pointer position.** Use the existing shared pointer only; do not add a
  second source of truth (warps and Pointer Lock already feed it).

## Open decisions (recommended defaults)

1. **Rollout:** `?cursor=page` flag first, then a settings entry. (recommended)
2. **Suppression default:** keep the in-frame cursor when the flag is off.
   (recommended)
3. **Visibility:** follow the game's own cursor visibility exactly, including
   movies and pause. (recommended)
4. **Native parity:** after the browser path is proven. (recommended)

## Acceptance criteria

- With `?cursor=page`, a match shows exactly one cursor, with the game's art
  and hotspot, moving at display refresh rate.
- Without the flag, behavior is unchanged.
- No input, click-routing or warp changes.
- Both editions and the existing menu/pause cursor paths pass their tests, plus
  the new e2e checks.
