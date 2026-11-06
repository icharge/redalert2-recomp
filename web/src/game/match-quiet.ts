import { CursorKind, Shared } from "./protocol";

/**
 * True while a match plays: the page's controls keep out of the way then. The game draws its
 * own cursor in play (CursorKind.None) and switches to the overlay or the arrow for its pause
 * menu and score screen, so no flag of its own is needed. `base` is the shared struct's word
 * index (game.shared >> 2).
 */
export function matchQuiet(heap: Int32Array, base: number): boolean {
  return (
    Atomics.load(heap, base + Shared.matchState) !== 0 &&
    Atomics.load(heap, base + Shared.frameW) > 0 &&
    Atomics.load(heap, base + Shared.cursorKind) === CursorKind.None
  );
}
