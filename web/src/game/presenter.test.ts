import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Presenter, type WasmMemory } from "./presenter";
import { CURSOR_PX, CURSOR_RGBA_OFFSET, CursorKind, Shared } from "./protocol";

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
  const presenter = new Presenter(canvas, () => memory, SHARED, null, cursor);
  return { memory, word, drawn, canvas, cursor, presenter };
}

beforeEach(() => {
  vi.stubGlobal("ImageData", FakeImageData);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Presenter", () => {
  it("captures during gameplay, releases on pause, and captures again on resume", () => {
    const { canvas, memory, word } = setup();
    const capture = vi.fn();
    const presenter = new Presenter(canvas, () => memory, SHARED, null, null, capture);
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
    word(Shared.frameSeq, 1);
    presenter.draw();
    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(1);
    expect(drawn).toHaveLength(1);
    expect(Array.from(drawn[0]!.data)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it("draws a frame once, and again when the sequence moves", () => {
    const { presenter, word, drawn } = setup();
    word(Shared.frameW, 1);
    word(Shared.frameH, 1);
    word(Shared.framePtr, FRAME);
    word(Shared.frameSeq, 1);
    presenter.draw();
    presenter.draw();
    expect(drawn).toHaveLength(1);
    word(Shared.frameSeq, 2);
    presenter.draw();
    expect(drawn).toHaveLength(2);
  });

  it("keeps the game's frame size when it exceeds the viewport", () => {
    const { presenter, word, canvas } = setup({ width: 1, height: 1 });
    presenter.configure("integer");
    word(Shared.frameW, 2);
    word(Shared.frameH, 1);
    word(Shared.framePtr, FRAME);
    word(Shared.frameSeq, 1);

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
    word(Shared.frameSeq, 1);

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
    Object.defineProperty(document, "exitPointerLock", { configurable: true, value: exitPointerLock });
    word(Shared.cursorKind, CursorKind.Arrow);
    word(Shared.cursorSeq, 1);

    try {
      presenter.draw();

      expect(exitPointerLock).toHaveBeenCalledOnce();
      expect(canvas.style.cursor).toBe("default");
    } finally {
      if (oldPointerLock) Object.defineProperty(document, "pointerLockElement", oldPointerLock);
      else Reflect.deleteProperty(document, "pointerLockElement");
      if (oldExitPointerLock) Object.defineProperty(document, "exitPointerLock", oldExitPointerLock);
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
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
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

  it("keeps a pause cursor inside the sidebar when the full game is letterboxed", () => {
    const { presenter, word, cursor } = setup({ width: 1280, height: 720 });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
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
