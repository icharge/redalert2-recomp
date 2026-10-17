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

function setup() {
  const buffer = new ArrayBuffer(1 << 16);
  const memory: WasmMemory = { HEAPU8: new Uint8Array(buffer), HEAP32: new Int32Array(buffer) };
  const word = (index: number, value: number) => (memory.HEAP32[(SHARED >> 2) + index] = value);

  const drawn: FakeImageData[] = [];
  const context = {
    createImageData: (w: number, h: number) =>
      new FakeImageData(new Uint8ClampedArray(w * h * 4), w, h),
    putImageData: (image: FakeImageData) => drawn.push({ ...image, data: image.data.slice() }),
  };
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const presenter = new Presenter(canvas, () => memory, SHARED);
  return { memory, word, drawn, canvas, presenter };
}

beforeEach(() => {
  vi.stubGlobal("ImageData", FakeImageData);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Presenter", () => {
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
});
