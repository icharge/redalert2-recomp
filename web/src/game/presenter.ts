import { CURSOR_PX, CURSOR_RGBA_OFFSET, CursorKind, Shared } from "./protocol";

/** The wasm memory's views. Emscripten makes new ones when the memory grows, so ask each time. */
export interface WasmMemory {
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
}

/**
 * Draws what the game thread publishes (src/web/presenter.c) on the canvas, once per
 * animation frame: the picture, and the cursor the game sets in its menus. The canvas
 * is the picture's own size and CSS scales it (object-fit: contain), so a resize costs
 * the game nothing.
 */
export class Presenter {
  private raf = 0;
  private frameSeq = -1;
  private cursorSeq = -1;
  private image: ImageData | null = null;
  private readonly context: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly memory: () => WasmMemory,
    /** the address of ra2_shared_t, from ra2_shared() */
    private readonly shared: number,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("this browser gave no 2D canvas");
    this.context = context;
  }

  start(): void {
    const tick = () => {
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  /** One animation frame: the picture if it changed, the cursor if it changed. */
  draw(): void {
    const { HEAP32, HEAPU8 } = this.memory();
    const base = this.shared >> 2;
    const word = (index: number) => Atomics.load(HEAP32, base + index);

    const seq = word(Shared.frameSeq);
    if (seq !== this.frameSeq) {
      const width = word(Shared.frameW);
      const height = word(Shared.frameH);
      const pointer = word(Shared.framePtr) >>> 0;
      if (width > 0 && height > 0 && pointer > 0) {
        this.frameSeq = seq;
        if (this.canvas.width !== width || this.canvas.height !== height) {
          this.canvas.width = width;
          this.canvas.height = height;
          this.image = null;
        }
        this.image ??= this.context.createImageData(width, height);
        // a view on shared memory cannot back an ImageData, so the pixels are copied
        this.image.data.set(HEAPU8.subarray(pointer, pointer + width * height * 4));
        this.context.putImageData(this.image, 0, 0);
      }
    }

    const cursorSeq = word(Shared.cursorSeq);
    if (cursorSeq !== this.cursorSeq) {
      this.cursorSeq = cursorSeq;
      this.setCursor(
        word(Shared.cursorKind),
        word(Shared.cursorHotX),
        word(Shared.cursorHotY),
        HEAPU8,
      );
    }
  }

  private setCursor(kind: number, hotX: number, hotY: number, heap: Uint8Array): void {
    const style = this.canvas.style;
    if (kind === CursorKind.None) {
      style.cursor = "none";
    } else if (kind === CursorKind.Arrow) {
      style.cursor = "default";
    } else {
      const from = this.shared + CURSOR_RGBA_OFFSET;
      const pixels = heap.slice(from, from + CURSOR_PX * CURSOR_PX * 4); // a copy: ImageData cannot be shared
      const stamp = document.createElement("canvas");
      stamp.width = stamp.height = CURSOR_PX;
      const context = stamp.getContext("2d");
      if (!context) {
        style.cursor = "default";
        return;
      }
      context.putImageData(
        new ImageData(new Uint8ClampedArray(pixels.buffer), CURSOR_PX, CURSOR_PX),
        0,
        0,
      );
      style.cursor = `url(${stamp.toDataURL()}) ${hotX} ${hotY}, default`;
    }
  }
}
