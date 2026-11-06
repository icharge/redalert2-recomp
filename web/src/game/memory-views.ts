import type { WasmMemory } from "./presenter";

/** ra2.js is a classic script, so its top-level growMemViews is a global of the page. */
const pageRefresh = (): (() => void) | undefined =>
  (globalThis as { growMemViews?: () => void }).growMemViews;

/**
 * The game's memory as views the page can read all of. The game thread grows the memory
 * (a big match size does), but Emscripten rebuilds the page thread's HEAP views only when
 * its own page-side code runs, which it rarely does once the game is up. Until then the
 * views end at the old size and a frame published past it can't be read: the picture stays
 * black or frozen. growMemViews swaps in views of the grown buffer when the memory has grown,
 * and does nothing otherwise.
 */
export function liveViews(
  module: { HEAPU8?: Uint8Array; HEAP32?: Int32Array },
  refresh: (() => void) | undefined = pageRefresh(),
): WasmMemory {
  if (!module.HEAPU8 || !module.HEAP32) throw new Error("the game's memory is not up yet");
  refresh?.();
  return { HEAPU8: module.HEAPU8, HEAP32: module.HEAP32 };
}

/** liveViews for a reader that needs only the bytes (the UDP relay). */
export function liveBytes(
  module: { HEAPU8?: Uint8Array },
  refresh: (() => void) | undefined = pageRefresh(),
): Uint8Array {
  if (!module.HEAPU8) throw new Error("the game's memory is not up yet");
  refresh?.();
  return module.HEAPU8;
}
