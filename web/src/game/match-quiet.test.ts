import { describe, expect, it } from "vitest";
import { CursorKind, Shared } from "./protocol";
import { matchQuiet } from "./match-quiet";

function shared(values: Partial<Record<keyof typeof Shared, number>>): Int32Array {
  const heap = new Int32Array(2048);
  for (const [key, value] of Object.entries(values))
    heap[Shared[key as keyof typeof Shared]] = value;
  return heap;
}

describe("matchQuiet", () => {
  it("is quiet while a match plays: the game draws its own cursor", () => {
    expect(
      matchQuiet(shared({ matchState: 1, cursorKind: CursorKind.None, frameW: 1024 }), 0),
    ).toBe(true);
  });

  it("is not quiet on the pause menu, which shows the overlay or arrow cursor", () => {
    expect(
      matchQuiet(shared({ matchState: 1, cursorKind: CursorKind.Overlay, frameW: 1024 }), 0),
    ).toBe(false);
    expect(
      matchQuiet(shared({ matchState: 1, cursorKind: CursorKind.Arrow, frameW: 1024 }), 0),
    ).toBe(false);
  });

  it("is not quiet in the menus", () => {
    expect(matchQuiet(shared({ matchState: 0, cursorKind: CursorKind.None, frameW: 800 }), 0)).toBe(
      false,
    );
  });

  it("is not quiet before the first picture", () => {
    expect(matchQuiet(shared({ matchState: 1, cursorKind: CursorKind.None, frameW: 0 }), 0)).toBe(
      false,
    );
  });

  it("reads from the shared struct's own address", () => {
    const heap = new Int32Array(4096);
    const base = 1024;
    heap[base + Shared.matchState] = 1;
    heap[base + Shared.frameW] = 1024;
    heap[base + Shared.cursorKind] = CursorKind.None;
    expect(matchQuiet(heap, base)).toBe(true);
  });
});
