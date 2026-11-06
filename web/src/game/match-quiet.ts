import { CursorKind, Shared } from "./protocol";

/** The game's sidebar, in the game's own pixels: it sits at x = width - 168 (run_lift.py). */
export const SIDEBAR_PX = 168;

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

/**
 * How far the game's sidebar reaches in from the canvas's right edge, in CSS pixels: the
 * black bar beside a letterboxed picture (object-fit: contain) plus the sidebar's width at
 * the picture's scale. 0 before there is a picture.
 */
export function sidebarInset(
  box: { width: number; height: number },
  picture: { width: number; height: number },
): number {
  if (picture.width <= 0 || picture.height <= 0 || box.width <= 0 || box.height <= 0) return 0;
  const scale = Math.min(box.width / picture.width, box.height / picture.height);
  const blackBar = (box.width - picture.width * scale) / 2;
  return blackBar + SIDEBAR_PX * scale;
}
