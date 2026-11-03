import { beforeEach, describe, expect, it } from "vitest";
import { PageCursor, placeCursor, type PageCursorOptions } from "./cursor-layer";
import {
  CURSOR_PX,
  CURSOR_RGBA_OFFSET,
  CursorKind,
  PAGE_CURSOR_INDICES_OFFSET,
  PAGE_CURSOR_PALETTE_OFFSET,
  PageCursorKind,
  RA2_WEB_PROTOCOL,
  Shared,
} from "./protocol";

const SHARED = 4096; // where the fake ra2_shared_t sits in the fake heap
const PAGE = 64;
const PALETTE = SHARED + PAGE_CURSOR_PALETTE_OFFSET;
const INDICES = SHARED + PAGE_CURSOR_INDICES_OFFSET;

/** A fake wasm memory with a ra2_shared_t at SHARED, its palette and a frame. */
function fakeMemory(protocol = RA2_WEB_PROTOCOL) {
  const bytes = new Uint8Array(INDICES + PAGE * PAGE);
  const words = new Int32Array(bytes.buffer);
  const at = SHARED >> 2;
  Atomics.store(words, at + Shared.protocol, protocol);
  Atomics.store(words, at + Shared.gameW, 640);
  Atomics.store(words, at + Shared.gameH, 480);
  Atomics.store(words, at + Shared.pointerX, 100);
  Atomics.store(words, at + Shared.pointerY, 200);
  Atomics.store(words, at + Shared.pageCursorKind, PageCursorKind.None);
  // a two-entry palette: 0 = transparent, 1 = yellow (63, 52, 0), 2 = red
  bytes[PALETTE + 1 * 3] = 63;
  bytes[PALETTE + 1 * 3 + 1] = 52;
  bytes[PALETTE + 2 * 3] = 63;
  Atomics.store(words, at + Shared.pageCursorPaletteSeq, 2);
  return { HEAPU8: bytes, HEAP32: words, at };
}

/** Publish a frame: w x h of index 1 at (x, y) in a sheet w x h. */
function publishFrame(
  memory: ReturnType<typeof fakeMemory>,
  sheetW: number,
  sheetH: number,
  w: number,
  h: number,
  x = 0,
  y = 0,
) {
  const { HEAPU8, HEAP32, at } = memory;
  const seq = Atomics.load(HEAP32, at + Shared.pageCursorSeq) + 2;
  Atomics.store(HEAP32, at + Shared.pageCursorKind, PageCursorKind.Image);
  Atomics.store(HEAP32, at + Shared.pageCursorSheetW, sheetW);
  Atomics.store(HEAP32, at + Shared.pageCursorSheetH, sheetH);
  Atomics.store(HEAP32, at + Shared.pageCursorX, x);
  Atomics.store(HEAP32, at + Shared.pageCursorY, y);
  Atomics.store(HEAP32, at + Shared.pageCursorW, w);
  Atomics.store(HEAP32, at + Shared.pageCursorH, h);
  Atomics.store(HEAP32, at + Shared.pageCursorHotX, 2);
  Atomics.store(HEAP32, at + Shared.pageCursorHotY, 3);
  for (let i = 0; i < w * h; i++) HEAPU8[INDICES + i] = 1;
  Atomics.store(HEAP32, at + Shared.pageCursorSeq, seq);
  return seq;
}

function fakeCanvas() {
  return document.createElement("canvas");
}

/** Publish the Win32 cursor the menus and the pause overlay use. */
function publishWindowsCursor(
  memory: ReturnType<typeof fakeMemory>,
  kind: number = CursorKind.Image,
) {
  const { HEAP32, at } = memory;
  const seq = Atomics.load(HEAP32, at + Shared.cursorSeq) + 1;
  Atomics.store(HEAP32, at + Shared.cursorKind, kind);
  Atomics.store(HEAP32, at + Shared.cursorHotX, 0);
  Atomics.store(HEAP32, at + Shared.cursorHotY, 0);
  memory.HEAPU8[SHARED + CURSOR_RGBA_OFFSET + 3] = 255; // one opaque pixel
  Atomics.store(HEAP32, at + Shared.cursorSeq, seq);
  return seq;
}

function moveMouse(x: number, y: number) {
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y }));
}

function picture(box: { left: number; top: number; width: number; height: number }) {
  const element = document.createElement("canvas");
  element.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON() {},
    }) as DOMRect;
  return element;
}

describe("placeCursor", () => {
  it("scales the hot spot under the pointer through the letterbox", () => {
    const placement = placeCursor({
      gameWidth: 640,
      gameHeight: 480,
      box: { left: 0, top: 0, width: 800, height: 600 },
      x: 100,
      y: 200,
      hotX: 4,
      hotY: 8,
      spriteWidth: 32,
      spriteHeight: 32,
    });
    expect(placement).toEqual({
      left: 96 * 1.25,
      top: 192 * 1.25,
      width: 32 * 1.25,
      height: 32 * 1.25,
    });
  });

  it("leaves equal bars on both sides of a wider window", () => {
    expect(
      placeCursor({
        gameWidth: 640,
        gameHeight: 480,
        box: { left: 0, top: 0, width: 1000, height: 600 },
        x: 0,
        y: 0,
        hotX: 0,
        hotY: 0,
        spriteWidth: 10,
        spriteHeight: 10,
      }),
    ).toEqual({ left: 100, top: 0, width: 12.5, height: 12.5 });
  });

  it("has no place for a picture or a sprite that is not there", () => {
    const base = {
      gameWidth: 640,
      gameHeight: 480,
      box: { left: 0, top: 0, width: 800, height: 600 },
      x: 1,
      y: 2,
      hotX: 0,
      hotY: 0,
      spriteWidth: 32,
      spriteHeight: 32,
    };
    expect(placeCursor({ ...base, gameWidth: 0 })).toBeNull();
    expect(placeCursor({ ...base, box: { left: 0, top: 0, width: 0, height: 0 } })).toBeNull();
    expect(placeCursor({ ...base, spriteWidth: 0 })).toBeNull();
  });
});

describe("PageCursor", () => {
  let memory: ReturnType<typeof fakeMemory>;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    memory = fakeMemory();
    canvas = fakeCanvas();
  });

  const layer = (options: PageCursorOptions = {}) => {
    canvas = fakeCanvas();
    return new PageCursor(
      canvas,
      () => picture({ left: 0, top: 0, width: 640, height: 480 }),
      () => memory,
      SHARED,
      options,
    );
  };

  it("draws the game's frame and asks it to stop drawing its own", () => {
    const cursor = layer();
    publishFrame(memory, 55, 43, 22, 17);
    cursor.frameStep();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(1);
    expect(canvas.style.visibility).toBe("visible");
    expect(canvas.style.width).toBe("55px"); // the sheet, at 1:1
    expect(canvas.width).toBe(55);
    expect(canvas.height).toBe(43);
  });

  it("draws nothing and asks for nothing without a frame", () => {
    const cursor = layer();
    cursor.frameStep();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(0);
    expect(canvas.style.visibility).toBe("hidden");
  });

  it("stops asking when the game says the cursor is gone", () => {
    const cursor = layer();
    publishFrame(memory, 55, 43, 22, 17);
    cursor.frameStep();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(1);
    const seq = Atomics.load(memory.HEAP32, memory.at + Shared.pageCursorSeq) + 2;
    Atomics.store(memory.HEAP32, memory.at + Shared.pageCursorKind, PageCursorKind.None);
    Atomics.store(memory.HEAP32, memory.at + Shared.pageCursorSeq, seq);
    cursor.frameStep();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(0);
    expect(canvas.style.visibility).toBe("hidden");
  });

  it("keeps the last frame while the game is publishing a new one", () => {
    const cursor = layer();
    publishFrame(memory, 55, 43, 22, 17);
    cursor.frameStep();
    const seq = Atomics.load(memory.HEAP32, memory.at + Shared.pageCursorSeq);
    Atomics.store(memory.HEAP32, memory.at + Shared.pageCursorSeq, seq + 1); // odd: mid-publish
    cursor.frameStep();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(1);
    expect(canvas.style.visibility).toBe("visible");
  });

  it("draws a frame with the hot spot that came with it", () => {
    const cursor = layer();
    publishFrame(memory, 55, 43, 22, 17); // hot 2, 3
    cursor.frameStep();
    expect(canvas.style.transform).toBe("translate(98px, 197px)"); // (100-2, 200-3) at 1:1
    const placed = canvas.style.transform;
    // The game has started the next frame: the hot spot is already written but
    // the sequence is odd, so the published frame is still the old one.
    const seq = Atomics.load(memory.HEAP32, memory.at + Shared.pageCursorSeq);
    Atomics.store(memory.HEAP32, memory.at + Shared.pageCursorSeq, seq + 1);
    Atomics.store(memory.HEAP32, memory.at + Shared.pageCursorHotX, 20);
    Atomics.store(memory.HEAP32, memory.at + Shared.pageCursorHotY, 30);
    cursor.frameStep();
    expect(canvas.style.transform).toBe(placed);
    // The whole new frame lands: its hot spot moves the sprite with it.
    Atomics.store(memory.HEAP32, memory.at + Shared.pageCursorSeq, seq + 2);
    cursor.frameStep();
    expect(canvas.style.transform).toBe("translate(80px, 170px)"); // (100-20, 200-30)
  });

  it("ignores a game build from before the page cursor", () => {
    memory = fakeMemory(9);
    const cursor = layer();
    cursor.frameStep();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(0);
    expect(canvas.style.visibility).toBe("hidden");
  });

  it("releases the request when the page goes away", () => {
    const cursor = layer();
    publishFrame(memory, 55, 43, 22, 17);
    cursor.frameStep();
    cursor.release();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(0);
    expect(canvas.style.visibility).toBe("hidden");
  });

  it("draws the game's Win32 arrow in the menus at the mouse's own position", () => {
    publishWindowsCursor(memory);
    const cursor = layer();
    cursor.start();
    moveMouse(100, 200);
    cursor.frameStep();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(0); // nothing to skip
    expect(canvas.style.visibility).toBe("visible");
    expect(canvas.width).toBe(CURSOR_PX);
    expect(canvas.style.width).toBe(`${CURSOR_PX}px`);
    expect(canvas.style.transform).toBe("translate(100px, 200px)");
    cursor.stop();
  });

  it("scales the menu arrow and its hot spot with the picture", () => {
    publishWindowsCursor(memory);
    Atomics.store(memory.HEAP32, memory.at + Shared.cursorHotX, 4);
    Atomics.store(memory.HEAP32, memory.at + Shared.cursorHotY, 8);
    canvas = fakeCanvas();
    const scaled = new PageCursor(
      canvas,
      () => picture({ left: 0, top: 0, width: 1280, height: 960 }),
      () => memory,
      SHARED,
    );
    scaled.start();
    moveMouse(200, 400);
    scaled.frameStep();
    expect(canvas.style.transform).toBe("translate(192px, 384px)"); // (100-4, 200-8) x2
    expect(canvas.style.width).toBe(`${CURSOR_PX * 2}px`);
    scaled.stop();
  });

  it("waits for a real mouse position before taking the menus over", () => {
    publishWindowsCursor(memory);
    const calls: boolean[] = [];
    const cursor = layer({ onActive: (active) => calls.push(active) });
    cursor.frameStep();
    expect(canvas.style.visibility).toBe("hidden");
    expect(calls).toEqual([false]); // the presenter's CSS cursor stays
  });

  it("leaves the plain system arrow to the presenter", () => {
    publishWindowsCursor(memory, CursorKind.Arrow);
    const cursor = layer();
    cursor.start();
    moveMouse(100, 200);
    cursor.frameStep();
    expect(canvas.style.visibility).toBe("hidden");
    cursor.stop();
  });

  it("uses the shared pointer under Pointer Lock, as the pause overlay does", () => {
    publishWindowsCursor(memory, CursorKind.Overlay);
    Object.defineProperty(document, "pointerLockElement", {
      configurable: true,
      get: () => document.body,
    });
    try {
      const cursor = layer();
      cursor.frameStep();
      expect(canvas.style.visibility).toBe("visible");
      expect(canvas.style.transform).toBe("translate(100px, 200px)"); // Shared.pointerX/Y
    } finally {
      Reflect.deleteProperty(document, "pointerLockElement");
    }
  });

  it("tells the presenter to hide its cursor, and gives it back on release", () => {
    publishWindowsCursor(memory);
    const calls: boolean[] = [];
    const cursor = layer({ onActive: (active) => calls.push(active) });
    cursor.start();
    moveMouse(10, 20);
    cursor.frameStep();
    expect(calls).toContain(true);
    publishFrame(memory, 55, 43, 22, 17); // the match takes the layer over
    cursor.frameStep();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(1);
    cursor.release();
    expect(calls.at(-1)).toBe(false);
    cursor.stop();
  });
});
