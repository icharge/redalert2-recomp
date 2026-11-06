import { describe, expect, it } from "vitest";
import { CursorKind, Shared } from "./protocol";
import { matchQuiet, sidebarInset, SIDEBAR_PX } from "./match-quiet";

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

describe("sidebarInset", () => {
  it("is the sidebar's width when the picture fills the canvas", () => {
    expect(sidebarInset({ width: 1024, height: 768 }, { width: 1024, height: 768 })).toBe(
      SIDEBAR_PX,
    );
  });

  it("scales with the picture", () => {
    expect(sidebarInset({ width: 2048, height: 1536 }, { width: 1024, height: 768 })).toBe(
      SIDEBAR_PX * 2,
    );
  });

  it("adds the black bar beside a letterboxed picture", () => {
    // a 4:3 picture in a 16:9 window: 240 px of black on each side
    expect(sidebarInset({ width: 1920, height: 1080 }, { width: 1440, height: 1080 })).toBe(
      240 + SIDEBAR_PX,
    );
  });

  it("is 0 before there is a picture", () => {
    expect(sidebarInset({ width: 1920, height: 1080 }, { width: 0, height: 0 })).toBe(0);
  });
});
