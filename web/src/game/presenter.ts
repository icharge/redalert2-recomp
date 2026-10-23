import { CURSOR_PX, CURSOR_RGBA_OFFSET, CursorKind, Shared, type Scale } from "./protocol";

/** The wasm memory's views. Emscripten makes new ones when the memory grows, so ask each time. */
export interface WasmMemory {
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
}

export interface PresenterCounters {
  pictures: number;
  ticks: number;
  drawMs: number;
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
  private pictures = 0;
  private ticks = 0;
  private drawMs = 0;
  private scale: Scale = "sharp";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly memory: () => WasmMemory,
    /** the address of ra2_shared_t, from ra2_shared() */
    private readonly shared: number,
    private readonly backdrop?: HTMLCanvasElement | null,
    private readonly cursorOverlay?: HTMLImageElement | null,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("this browser gave no 2D canvas");
    this.context = context;
  }

  /** Running totals, for the frame-time overlay: pictures put on the canvas, animation frames, time spent drawing. */
  counters(): PresenterCounters {
    return { pictures: this.pictures, ticks: this.ticks, drawMs: this.drawMs };
  }

  gameSize(): { width: number; height: number } {
    const { HEAP32 } = this.memory();
    const at = this.shared >> 2;
    return {
      width: Atomics.load(HEAP32, at + Shared.gameW) || this.canvas.width,
      height: Atomics.load(HEAP32, at + Shared.gameH) || this.canvas.height,
    };
  }

  cursorWarp(): { seq: number; x: number; y: number } {
    const { HEAP32 } = this.memory();
    const at = this.shared >> 2;
    return {
      seq: Atomics.load(HEAP32, at + Shared.warpSeq),
      x: Atomics.load(HEAP32, at + Shared.warpX),
      y: Atomics.load(HEAP32, at + Shared.warpY),
    };
  }

  configure(scale: Scale): void {
    this.scale = scale;
    this.canvas.style.width = this.canvas.style.height = "100%";
    this.canvas.style.objectFit = "contain";
    this.frameSeq = -1;
  }

  start(): void {
    const tick = () => {
      const began = performance.now();
      this.draw();
      this.drawMs += performance.now() - began;
      this.ticks++;
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
        this.render(this.image, width, height);
        if (this.backdrop) {
          if (this.backdrop.width !== 64) this.backdrop.width = 64;
          if (this.backdrop.height !== 48) this.backdrop.height = 48;
          this.backdrop.getContext("2d")?.drawImage(this.canvas, 0, 0, 64, 48);
        }
        this.pictures++;
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
    this.drawCursorOverlay(word);
  }

  private drawCursorOverlay(word: (index: number) => number): void {
    const cursor = this.cursorOverlay;
    if (!cursor) return;
    if (word(Shared.cursorKind) !== CursorKind.Overlay) {
      cursor.style.display = "none";
      return;
    }
    const gameWidth = word(Shared.gameW) || this.canvas.width;
    const gameHeight = word(Shared.gameH) || this.canvas.height;
    const rect = this.canvas.getBoundingClientRect();
    if (gameWidth <= 0 || gameHeight <= 0 || rect.width <= 0 || rect.height <= 0) {
      cursor.style.display = "none";
      return;
    }
    const scale = Math.min(rect.width / gameWidth, rect.height / gameHeight);
    const left = rect.left + (rect.width - gameWidth * scale) / 2;
    const top = rect.top + (rect.height - gameHeight * scale) / 2;
    cursor.style.width = `${CURSOR_PX * scale}px`;
    cursor.style.height = `${CURSOR_PX * scale}px`;
    cursor.style.left = `${left + (word(Shared.pointerX) - word(Shared.cursorHotX)) * scale}px`;
    cursor.style.top = `${top + (word(Shared.pointerY) - word(Shared.cursorHotY)) * scale}px`;
    cursor.style.display = "block";
  }

  private render(image: ImageData, width: number, height: number): void {
    // Keep the backing bitmap at the game's published size. CSS object-fit
    // handles the one and only fit to the viewport, as in the known-good build.
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.canvas.style.objectFit = "contain";
    this.canvas.style.imageRendering =
      this.scale === "nearest" || this.scale === "integer" ? "pixelated" : "auto";
    this.context.putImageData(image, 0, 0);
    if (this.scale === "crt") {
      this.context.fillStyle = "rgba(0,0,0,0.22)";
      for (let y = 1; y < height; y += 3) this.context.fillRect(0, y, width, 1);
    }
  }

  private setCursor(kind: number, hotX: number, hotY: number, heap: Uint8Array): void {
    const style = this.canvas.style;
    if (this.cursorOverlay) this.cursorOverlay.style.display = "none";
    // Pointer Lock hides CSS cursors. Release it when a dialog asks for the
    // Windows cursor; pause draws a positioned image over the game/sidebar.
    if (kind !== CursorKind.None && kind !== CursorKind.Overlay && document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
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
      if (kind === CursorKind.Overlay && this.cursorOverlay) {
        this.cursorOverlay.src = stamp.toDataURL();
        style.cursor = "none";
      } else {
        style.cursor = `url(${stamp.toDataURL()}) ${hotX} ${hotY}, default`;
      }
    }
  }
}
