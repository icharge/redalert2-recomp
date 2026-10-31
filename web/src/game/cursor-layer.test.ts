import { beforeEach, describe, expect, it } from "vitest";
import { PageCursor, placeCursor } from "./cursor-layer";
import { PAGE_CURSOR_RGBA_OFFSET, PageCursorKind, RA2_WEB_PROTOCOL, Shared } from "./protocol";

const SHARED = 4096; // where the fake ra2_shared_t sits in the fake heap
const PAGE = 64;

/** A fake wasm memory with a ra2_shared_t at SHARED and a 16 KB sprite after it. */
function fakeMemory(protocol = RA2_WEB_PROTOCOL) {
  const bytes = new Uint8Array(SHARED + PAGE_CURSOR_RGBA_OFFSET + PAGE * PAGE * 4);
  const words = new Int32Array(bytes.buffer);
  const at = SHARED >> 2;
  Atomics.store(words, at + Shared.protocol, protocol);
  Atomics.store(words, at + Shared.gameW, 640);
  Atomics.store(words, at + Shared.gameH, 480);
  Atomics.store(words, at + Shared.pointerX, 100);
  Atomics.store(words, at + Shared.pointerY, 200);
  Atomics.store(words, at + Shared.pageCursorKind, PageCursorKind.None);
  return { HEAPU8: bytes, HEAP32: words, at };
}

function publishSprite(
  memory: ReturnType<typeof fakeMemory>,
  w: number,
  h: number,
  hotX: number,
  hotY: number,
) {
  const { HEAPU8, HEAP32, at } = memory;
  const seq = Atomics.load(HEAP32, at + Shared.pageCursorSeq) + 2;
  Atomics.store(HEAP32, at + Shared.pageCursorKind, PageCursorKind.Image);
  Atomics.store(HEAP32, at + Shared.pageCursorW, w);
  Atomics.store(HEAP32, at + Shared.pageCursorH, h);
  Atomics.store(HEAP32, at + Shared.pageCursorHotX, hotX);
  Atomics.store(HEAP32, at + Shared.pageCursorHotY, hotY);
  for (let i = 0; i < w * h; i++) {
    HEAPU8[SHARED + PAGE_CURSOR_RGBA_OFFSET + i * 4] = 255;
    HEAPU8[SHARED + PAGE_CURSOR_RGBA_OFFSET + i * 4 + 3] = 255;
  }
  Atomics.store(HEAP32, at + Shared.pageCursorSeq, seq);
  return seq;
}

function fakeCanvas() {
  const canvas = document.createElement("canvas");
  return canvas;
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
  it("centres the picture in the box and puts the hot spot under the pointer", () => {
    // 640x480 in a 800x600 box: the picture is 800x600 scaled? No: 800/640 = 1.25,
    // 600/480 = 1.25, so it fills the box exactly.
    expect(
      placeCursor({
        gameWidth: 640,
        gameHeight: 480,
        box: { left: 0, top: 0, width: 800, height: 600 },
        x: 100,
        y: 200,
        hotX: 4,
        hotY: 8,
        spriteWidth: 32,
        spriteHeight: 32,
      }),
    ).toEqual({ left: 96 * 1.25, top: 192 * 1.25, width: 32 * 1.25, height: 32 * 1.25 });
  });

  it("leaves equal bars on both sides of a wider window", () => {
    const placement = placeCursor({
      gameWidth: 640,
      gameHeight: 480,
      box: { left: 0, top: 0, width: 1000, height: 600 },
      x: 0,
      y: 0,
      hotX: 0,
      hotY: 0,
      spriteWidth: 10,
      spriteHeight: 10,
    });
    // scale is 600/480 = 1.25; the picture is 800 wide, so 100 px of bars each side
    expect(placement).toEqual({ left: 100, top: 0, width: 12.5, height: 12.5 });
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

  beforeEach(() => {
    memory = fakeMemory();
  });

  let canvas = fakeCanvas();
  const layer = () => {
    canvas = fakeCanvas();
    return new PageCursor(
      canvas,
      () => picture({ left: 0, top: 0, width: 640, height: 480 }),
      () => memory,
      SHARED,
    );
  };

  it("draws the sprite at the pointer and asks the game to stop drawing its own", () => {
    const cursor = layer();
    publishSprite(memory, 32, 32, 2, 3);
    cursor.frame();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(1);
    expect(canvas.style.visibility).toBe("visible");
    expect(canvas.style.width).toBe("32px");
  });

  it("draws nothing and asks for nothing without a sprite", () => {
    const cursor = layer();
    cursor.frame();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(0);
    expect(canvas.style.visibility).toBe("hidden");
  });

  it("stops asking when the game says the cursor is gone", () => {
    const cursor = layer();
    publishSprite(memory, 32, 32, 0, 0);
    cursor.frame();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(1);
    const seq = Atomics.load(memory.HEAP32, memory.at + Shared.pageCursorSeq) + 2;
    Atomics.store(memory.HEAP32, memory.at + Shared.pageCursorKind, PageCursorKind.None);
    Atomics.store(memory.HEAP32, memory.at + Shared.pageCursorSeq, seq);
    cursor.frame();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(0);
  });

  it("keeps the last sprite while the game is publishing a new one", () => {
    const cursor = layer();
    publishSprite(memory, 32, 32, 0, 0);
    cursor.frame();
    const seq = Atomics.load(memory.HEAP32, memory.at + Shared.pageCursorSeq);
    Atomics.store(memory.HEAP32, memory.at + Shared.pageCursorSeq, seq + 1); // odd: mid-publish
    cursor.frame();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(1);
    expect(canvas.style.visibility).toBe("visible");
  });

  it("ignores a game build from before the page cursor", () => {
    memory = fakeMemory(9);
    const cursor = layer();
    cursor.frame();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(0);
    expect(canvas.style.visibility).toBe("hidden");
  });

  it("releases the request when the page goes away", () => {
    const cursor = layer();
    publishSprite(memory, 32, 32, 0, 0);
    cursor.frame();
    cursor.release();
    expect(memory.HEAP32[memory.at + Shared.pageCursorRequest]).toBe(0);
    expect(canvas.style.visibility).toBe("hidden");
  });
});
