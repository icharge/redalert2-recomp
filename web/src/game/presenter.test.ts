import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Presenter2d, type WasmMemory } from "./presenter";
import { CURSOR_PX, CURSOR_RGBA_OFFSET, CursorKind, PixelFormat, Shared } from "./protocol";

// jsdom has no canvas: a context that records what is drawn, and the ImageData it lacks
class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

const SHARED = 256; // where ra2_shared_t sits in the fake memory
const FRAME = 4096; // where the picture sits

function setup(viewport = { width: 0, height: 0 }) {
  const buffer = new ArrayBuffer(1 << 16);
  const memory: WasmMemory = { HEAPU8: new Uint8Array(buffer), HEAP32: new Int32Array(buffer) };
  const word = (index: number, value: number) => (memory.HEAP32[(SHARED >> 2) + index] = value);

  const drawn: FakeImageData[] = [];
  const context = {
    createImageData: (w: number, h: number) =>
      new FakeImageData(new Uint8ClampedArray(w * h * 4), w, h),
    putImageData: (image: FakeImageData) => drawn.push({ ...image, data: image.data.slice() }),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: viewport.width,
    height: viewport.height,
  } as DOMRect);
  const cursor = document.createElement("img");
  const presenter = new Presenter2d(canvas, () => memory, SHARED, null, cursor);
  return { memory, word, drawn, canvas, cursor, presenter };
}

beforeEach(() => {
  vi.stubGlobal("ImageData", FakeImageData);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Presenter2d", () => {
  it("writes presentMode 0 when started", () => {
    const { presenter, memory } = setup();
    presenter.start();
    expect(Atomics.load(memory.HEAP32, (SHARED >> 2) + Shared.presentMode)).toBe(0);
    presenter.stop();
  });

  it("puts the current picture on the canvas again after redraw(), though no new one came", () => {
    const { drawn, word, presenter } = setup();
    word(Shared.frameW, 2);
    word(Shared.frameH, 2);
    word(Shared.framePtr, FRAME);
    word(Shared.frameSeq, 2);
    presenter.draw();
    presenter.draw();
    expect(drawn).toHaveLength(1);
    presenter.redraw();
    presenter.draw();
    expect(drawn).toHaveLength(2);
  });

  it("captures during gameplay, releases on pause, and captures again on resume", () => {
    const { canvas, memory, word } = setup();
    const capture = vi.fn();
    const presenter = new Presenter2d(canvas, () => memory, SHARED, null, null, capture);
    presenter.draw();
    expect(capture).toHaveBeenLastCalledWith(false);
    word(Shared.frameW, 200);
    word(Shared.cursorKind, CursorKind.None);
    presenter.draw();
    expect(capture).toHaveBeenLastCalledWith(true);
    word(Shared.cursorKind, CursorKind.Overlay);
    presenter.draw();
    expect(capture).toHaveBeenLastCalledWith(false);
    word(Shared.cursorKind, CursorKind.None);
    presenter.draw();
    expect(capture).toHaveBeenLastCalledWith(true);
    word(Shared.cursorKind, CursorKind.Image);
    presenter.draw();
    expect(capture).toHaveBeenLastCalledWith(false);
  });

  it("draws nothing until the game publishes a picture", () => {
    const { presenter, drawn } = setup();
    presenter.draw();
    expect(drawn).toHaveLength(0);
  });

  it("draws the picture the game published, at its own size", () => {
    const { presenter, memory, word, drawn, canvas } = setup();
    memory.HEAPU8.set([10, 20, 30, 255, 40, 50, 60, 255], FRAME); // two pixels
    word(Shared.frameW, 2);
    word(Shared.frameH, 1);
    word(Shared.framePtr, FRAME);
    word(Shared.frameSeq, 2);
    presenter.draw();
    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(1);
    expect(drawn).toHaveLength(1);
    expect(Array.from(drawn[0]!.data)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it("draws a raw RGB565 frame correctly during a WebGL fallback", () => {
    const { presenter, word, memory, drawn } = setup();
    word(Shared.format, PixelFormat.Rgb565);
    word(Shared.frameW, 1);
    word(Shared.frameH, 1);
    word(Shared.framePtr, FRAME);
    word(Shared.framePitch, 2);
    word(Shared.frameIndex, 1);
    word(Shared.frameSeq, 2);
    memory.HEAPU8[FRAME] = 0x00;
    memory.HEAPU8[FRAME + 1] = 0xf8;

    presenter.draw();

    expect([...drawn[0]!.data]).toEqual([255, 0, 0, 255]);
  });

  it("draws a frame once, and again when the sequence moves", () => {
    const { presenter, word, drawn } = setup();
    word(Shared.frameW, 1);
    word(Shared.frameH, 1);
    word(Shared.framePtr, FRAME);
    word(Shared.frameSeq, 2);
    presenter.draw();
    presenter.draw();
    expect(drawn).toHaveLength(1);
    word(Shared.frameSeq, 4);
    presenter.draw();
    expect(drawn).toHaveLength(2);
  });

  it("does not draw while the game is publishing (an odd frame_seq), and draws the picture once it is whole", () => {
    const { presenter, word, drawn } = setup();
    word(Shared.frameW, 1);
    word(Shared.frameH, 1);
    word(Shared.framePtr, FRAME);
    word(Shared.frameSeq, 3);
    presenter.draw();
    expect(drawn).toHaveLength(0);
    word(Shared.frameSeq, 4);
    presenter.draw();
    presenter.draw();
    expect(drawn).toHaveLength(1);
  });

  it("captures a stable frame and releases readIndex after a concurrent publication", async () => {
    const { presenter, memory, word } = setup();
    const base = SHARED >> 2;
    word(Shared.frameW, 1);
    word(Shared.frameH, 1);
    word(Shared.framePtr, FRAME);
    word(Shared.frameIndex, 0);
    word(Shared.frameSeq, 2);
    memory.HEAPU8.set([10, 20, 30, 255], FRAME);
    const slice = memory.HEAPU8.slice.bind(memory.HEAPU8);
    let publishing = true;
    vi.spyOn(memory.HEAPU8, "slice").mockImplementation((start, end) => {
      if (publishing) {
        publishing = false;
        word(Shared.frameSeq, 3);
        memory.HEAPU8.set([40, 50, 60, 255], FRAME + 4);
        word(Shared.framePtr, FRAME + 4);
        word(Shared.frameIndex, 1);
        word(Shared.frameSeq, 4);
      }
      return slice(start, end);
    });

    const captured = await presenter.capture();

    expect(Array.from(captured.data)).toEqual([40, 50, 60, 255]);
    expect(Atomics.load(memory.HEAP32, base + Shared.readIndex)).toBe(-1);
  });

  it("waits for an in-progress publication before capturing", async () => {
    const { presenter, memory, word } = setup();
    word(Shared.frameW, 1);
    word(Shared.frameH, 1);
    word(Shared.framePtr, FRAME);
    word(Shared.frameIndex, 0);
    word(Shared.frameSeq, 3);
    memory.HEAPU8.set([70, 80, 90, 255], FRAME);
    setTimeout(() => word(Shared.frameSeq, 4), 0);

    const captured = await presenter.capture();

    expect(Array.from(captured.data)).toEqual([70, 80, 90, 255]);
  });

  it("rejects a picture if frame_seq changes while its pixels are copied", () => {
    const { presenter, memory, word, drawn } = setup();
    word(Shared.frameW, 1);
    word(Shared.frameH, 1);
    word(Shared.framePtr, FRAME);
    word(Shared.frameSeq, 2);
    memory.HEAPU8.set([10, 20, 30, 255], FRAME);
    const subarray = memory.HEAPU8.subarray.bind(memory.HEAPU8);
    vi.spyOn(memory.HEAPU8, "subarray").mockImplementation((start, end) => {
      word(Shared.frameSeq, 4);
      memory.HEAPU8.set([40, 50, 60, 255], FRAME);
      return subarray(start, end);
    });

    presenter.draw();
    expect(drawn).toHaveLength(0);

    presenter.draw();
    expect(drawn).toHaveLength(1);
    expect(Array.from(drawn[0]!.data)).toEqual([40, 50, 60, 255]);
  });

  it("keeps the game's frame size when it exceeds the viewport", () => {
    const { presenter, word, canvas } = setup({ width: 1, height: 1 });
    presenter.configure("integer");
    word(Shared.frameW, 2);
    word(Shared.frameH, 1);
    word(Shared.framePtr, FRAME);
    word(Shared.frameSeq, 2);

    presenter.draw();

    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(1);
    expect(canvas.style.width).toBe("100%");
    expect(canvas.style.height).toBe("100%");
  });

  it("keeps the published bitmap size and lets CSS fit the canvas", () => {
    const { presenter, word, canvas } = setup({ width: 2, height: 1 });
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    word(Shared.frameW, 4);
    word(Shared.frameH, 2);
    word(Shared.framePtr, FRAME);
    word(Shared.frameSeq, 2);

    presenter.draw();

    expect(canvas.width).toBe(4);
    expect(canvas.height).toBe(2);
    expect(canvas.style.width).toBe("100%");
    expect(canvas.style.height).toBe("100%");
  });

  it("hides the system cursor when the game draws its own, and shows the arrow when it asks", () => {
    const { presenter, word, canvas } = setup();
    word(Shared.cursorKind, CursorKind.None);
    word(Shared.cursorSeq, 1);
    presenter.draw();
    expect(canvas.style.cursor).toBe("none");
    word(Shared.cursorKind, CursorKind.Arrow);
    word(Shared.cursorSeq, 2);
    presenter.draw();
    expect(canvas.style.cursor).toBe("default");
  });

  it("releases pointer lock when the game asks to show its dialog cursor", () => {
    const { presenter, word, canvas } = setup();
    const exitPointerLock = vi.fn();
    const oldPointerLock = Object.getOwnPropertyDescriptor(document, "pointerLockElement");
    const oldExitPointerLock = Object.getOwnPropertyDescriptor(document, "exitPointerLock");
    Object.defineProperty(document, "pointerLockElement", { configurable: true, value: canvas });
    Object.defineProperty(document, "exitPointerLock", {
      configurable: true,
      value: exitPointerLock,
    });
    word(Shared.cursorKind, CursorKind.Arrow);
    word(Shared.cursorSeq, 1);

    try {
      presenter.draw();

      expect(exitPointerLock).toHaveBeenCalledOnce();
      expect(canvas.style.cursor).toBe("default");
    } finally {
      if (oldPointerLock) Object.defineProperty(document, "pointerLockElement", oldPointerLock);
      else Reflect.deleteProperty(document, "pointerLockElement");
      if (oldExitPointerLock)
        Object.defineProperty(document, "exitPointerLock", oldExitPointerLock);
      else Reflect.deleteProperty(document, "exitPointerLock");
    }
  });

  it("builds a CSS cursor from the game's image, with its hot spot", () => {
    const { presenter, memory, word, canvas } = setup();
    memory.HEAPU8.fill(
      255,
      SHARED + CURSOR_RGBA_OFFSET,
      SHARED + CURSOR_RGBA_OFFSET + CURSOR_PX * CURSOR_PX * 4,
    );
    const stamp = {
      width: 0,
      height: 0,
      getContext: () => ({ putImageData: vi.fn() }),
      toDataURL: () => "data:image/png;base64,AAAA",
    };
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "canvas" ? (stamp as unknown as HTMLCanvasElement) : create(tag),
    );
    word(Shared.cursorKind, CursorKind.Image);
    word(Shared.cursorHotX, 3);
    word(Shared.cursorHotY, 5);
    word(Shared.cursorSeq, 1);
    presenter.draw();
    expect(stamp.width).toBe(CURSOR_PX);
    expect(canvas.style.cursor).toContain("url(data:image/png;base64,AAAA) 3 5");
  });

  it("draws the pause cursor over the full game and sidebar at game coordinates", () => {
    const { presenter, word, canvas, cursor } = setup({ width: 400, height: 300 });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,AAAA",
    );
    word(Shared.cursorKind, CursorKind.Overlay);
    word(Shared.cursorSeq, 1);
    word(Shared.cursorHotX, 3);
    word(Shared.cursorHotY, 4);
    word(Shared.gameW, 200);
    word(Shared.gameH, 100);
    word(Shared.pointerX, 100);
    word(Shared.pointerY, 50);

    presenter.draw();

    expect(cursor.src).toContain("data:image/png;base64,AAAA");
    expect(cursor.style.display).toBe("block");
    expect(cursor.style.left).toBe("194px");
    expect(cursor.style.top).toBe("142px");
    expect(cursor.style.width).toBe("64px");
    expect(cursor.style.height).toBe("64px");
    expect(canvas.style.cursor).toBe("none");
  });

  it("does not read layout during draw", () => {
    const { presenter, word, canvas } = setup({ width: 400, height: 300 });
    word(Shared.gameW, 200);
    word(Shared.gameH, 100);
    word(Shared.cursorKind, CursorKind.Overlay);
    word(Shared.cursorSeq, 1);
    const rect = vi.mocked(canvas.getBoundingClientRect);
    rect.mockClear();

    for (let i = 0; i < 10; i++) presenter.draw();

    expect(rect).not.toHaveBeenCalled();
  });

  it("only rewrites cursor position and size styles when their numeric values change", () => {
    const { presenter, word, cursor } = setup({ width: 400, height: 300 });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,AAAA",
    );
    word(Shared.gameW, 200);
    word(Shared.gameH, 100);
    word(Shared.cursorKind, CursorKind.Overlay);
    word(Shared.cursorSeq, 1);
    word(Shared.pointerX, 100);
    word(Shared.pointerY, 50);
    const setProperty = vi.spyOn(cursor.style, "setProperty");

    presenter.draw();
    setProperty.mockClear();
    for (let i = 0; i < 10; i++) presenter.draw();

    expect(setProperty).not.toHaveBeenCalled();

    word(Shared.pointerX, 101);
    presenter.draw();

    expect(setProperty).toHaveBeenCalledOnce();
    expect(setProperty.mock.calls[0]?.[0]).toBe("left");
  });

  it("updates cached cursor bounds when the canvas resizes", () => {
    let resize: ResizeObserverCallback | undefined;
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    const { presenter, word, canvas, cursor } = setup({ width: 400, height: 300 });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,AAAA",
    );
    vi.mocked(canvas.getBoundingClientRect).mockReturnValue({
      left: 20,
      top: 30,
      width: 800,
      height: 600,
    } as DOMRect);
    resize?.([], {} as ResizeObserver);
    word(Shared.cursorKind, CursorKind.Overlay);
    word(Shared.cursorSeq, 1);
    word(Shared.gameW, 200);
    word(Shared.gameH, 100);
    word(Shared.pointerX, 100);
    word(Shared.pointerY, 50);
    word(Shared.cursorHotX, 3);
    word(Shared.cursorHotY, 4);

    presenter.draw();

    expect(cursor.style.left).toBe("408px");
    expect(cursor.style.top).toBe("314px");
  });

  it("disconnects the cursor bounds observer when stopped", () => {
    const disconnect = vi.fn();
    class FakeResizeObserver {
      constructor() {}
      observe() {}
      disconnect = disconnect;
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { presenter } = setup();

    presenter.stop();

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("keeps a pause cursor inside the sidebar when the full game is letterboxed", () => {
    const { presenter, word, cursor } = setup({ width: 1280, height: 720 });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,AAAA",
    );
    word(Shared.cursorKind, CursorKind.Overlay);
    word(Shared.cursorSeq, 1);
    word(Shared.gameW, 2580);
    word(Shared.gameH, 1080);
    word(Shared.pointerX, 2450);
    word(Shared.pointerY, 500);

    presenter.draw();

    expect(cursor.style.display).toBe("block");
    expect(Number.parseFloat(cursor.style.left)).toBeCloseTo(1215.5, 1);
    expect(Number.parseFloat(cursor.style.top)).toBeCloseTo(340.16, 1);
    expect(Number.parseFloat(cursor.style.left)).toBeGreaterThan(1280 * (1778 / 2580));
  });
});
