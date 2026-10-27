import {
  CURSOR_PX,
  CURSOR_RGBA_OFFSET,
  CursorKind,
  PresentMode,
  PixelFormat,
  Shared,
  type Scale,
} from "./protocol";

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

export interface GamePresenter {
  start(): void;
  stop(): void;
  draw(): void;
  configure(scale: Scale, bars: boolean): void;
  redraw(): void;
  counters(): PresenterCounters;
  gameSize(): { width: number; height: number };
  cursorWarp(): { seq: number; x: number; y: number };
  capture(options?: { hd?: boolean }): Promise<{
    width: number;
    height: number;
    frameSeq: number;
    data: Uint8Array;
  }>;
  textureBytes(): number;
}

/**
 * Draws what the game thread publishes (src/web/presenter.c) on the canvas, once per
 * animation frame: the picture, and the cursor the game sets in its menus. The canvas
 * is the picture's own size and CSS scales it (object-fit: contain), so a resize costs
 * the game nothing.
 */
export class Presenter2d implements GamePresenter {
  private readonly backdrop: HTMLCanvasElement | null;
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
    backdrop?: HTMLCanvasElement | null,
    private readonly cursorOverlay?: HTMLImageElement | null,
    private readonly capturePointer?: (active: boolean) => void,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("this browser gave no 2D canvas");
    this.context = context;
    this.backdrop = backdrop ?? this.createBackdrop();
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

  configure(scale: Scale, bars = true): void {
    this.scale = scale;
    if (this.backdrop) this.backdrop.style.display = bars ? "block" : "none";
    this.canvas.style.width = this.canvas.style.height = "100%";
    this.canvas.style.objectFit = "contain";
    this.frameSeq = -1;
  }

  private createBackdrop(): HTMLCanvasElement | null {
    const parent = this.canvas.parentElement;
    if (!parent) return null;
    const backdrop = document.createElement("canvas");
    Object.assign(backdrop.style, {
      position: "absolute",
      inset: "-5%",
      width: "110%",
      height: "110%",
      objectFit: "cover",
      filter: "blur(24px) brightness(0.25)",
      pointerEvents: "none",
      zIndex: "0",
    });
    parent.insertBefore(backdrop, this.canvas);
    return backdrop;
  }

  /** The next animation frame puts the game's current picture on the canvas again. */
  redraw(): void {
    this.frameSeq = -1;
  }

  start(): void {
    Atomics.store(this.memory().HEAP32, (this.shared >> 2) + Shared.presentMode, PresentMode.Rgba);
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

    // frame_seq is a seqlock: an odd value means the game is publishing, so only even values are pictures
    const seq = word(Shared.frameSeq);
    if ((seq & 1) === 0 && seq !== this.frameSeq) {
      const width = word(Shared.frameW);
      const height = word(Shared.frameH);
      const pointer = word(Shared.framePtr) >>> 0;
      const frameIndex = word(Shared.frameIndex);
      if (width > 0 && height > 0 && pointer > 0) {
        Atomics.store(HEAP32, base + Shared.readIndex, frameIndex);
        if (
          word(Shared.frameSeq) !== seq ||
          word(Shared.frameIndex) !== frameIndex ||
          word(Shared.framePtr) >>> 0 !== pointer
        ) {
          Atomics.store(HEAP32, base + Shared.readIndex, -1);
          return;
        }
        if (this.canvas.width !== width || this.canvas.height !== height) {
          this.canvas.width = width;
          this.canvas.height = height;
          this.image = null;
        }
        this.image ??= this.context.createImageData(width, height);
        const format = word(Shared.format);
        if (format === PixelFormat.Rgba) {
          // a view on shared memory cannot back an ImageData, so the pixels are copied
          this.image.data.set(HEAPU8.subarray(pointer, pointer + width * height * 4));
        } else {
          const pitch = word(Shared.framePitch);
          const palette = word(Shared.palettePtr) >>> 0;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const to = (y * width + x) * 4;
              const from = pointer + y * pitch;
              if (format === PixelFormat.Rgb565) {
                const value = (HEAPU8[from + x * 2] ?? 0) | ((HEAPU8[from + x * 2 + 1] ?? 0) << 8);
                const r = (value >>> 11) & 31;
                const g = (value >>> 5) & 63;
                const b = value & 31;
                this.image.data[to] = (r << 3) | (r >>> 2);
                this.image.data[to + 1] = (g << 2) | (g >>> 4);
                this.image.data[to + 2] = (b << 3) | (b >>> 2);
              } else if (format === PixelFormat.Pal8) {
                const fromPalette = palette + (HEAPU8[from + x] ?? 0) * 4;
                this.image.data[to] = HEAPU8[fromPalette] ?? 0;
                this.image.data[to + 1] = HEAPU8[fromPalette + 1] ?? 0;
                this.image.data[to + 2] = HEAPU8[fromPalette + 2] ?? 0;
              } else {
                const pixel = from + x * 4;
                this.image.data[to] = HEAPU8[pixel + 2] ?? 0;
                this.image.data[to + 1] = HEAPU8[pixel + 1] ?? 0;
                this.image.data[to + 2] = HEAPU8[pixel] ?? 0;
              }
              this.image.data[to + 3] = 255;
            }
          }
        }
        if (word(Shared.frameSeq) === seq) {
          this.frameSeq = seq;
          this.render(this.image, width, height);
          if (this.backdrop) {
            if (this.backdrop.width !== 64) this.backdrop.width = 64;
            if (this.backdrop.height !== 48) this.backdrop.height = 48;
            this.backdrop.getContext("2d")?.drawImage(this.canvas, 0, 0, 64, 48);
          }
          this.pictures++;
        } else {
          this.image = null;
        }
        Atomics.store(HEAP32, base + Shared.readIndex, -1);
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
    this.capturePointer?.(word(Shared.frameW) > 0 && word(Shared.cursorKind) === CursorKind.None);
  }

  async capture(): Promise<{ width: number; height: number; frameSeq: number; data: Uint8Array }> {
    const { HEAPU8, HEAP32 } = this.memory();
    const base = this.shared >> 2;
    for (let attempt = 0; attempt < 10; attempt++) {
      const seq = Atomics.load(HEAP32, base + Shared.frameSeq);
      if (seq < 0 || seq & 1) {
        if (attempt < 9) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        continue;
      }
      const width = Atomics.load(HEAP32, base + Shared.frameW);
      const height = Atomics.load(HEAP32, base + Shared.frameH);
      const pointer = Atomics.load(HEAP32, base + Shared.framePtr) >>> 0;
      const frameIndex = Atomics.load(HEAP32, base + Shared.frameIndex);
      const bytes = width * height * 4;
      if (width <= 0 || height <= 0 || pointer <= 0 || pointer + bytes > HEAPU8.length)
        throw new Error("No published frame to capture");

      Atomics.store(HEAP32, base + Shared.readIndex, frameIndex);
      try {
        if (
          Atomics.load(HEAP32, base + Shared.frameSeq) !== seq ||
          Atomics.load(HEAP32, base + Shared.frameIndex) !== frameIndex ||
          Atomics.load(HEAP32, base + Shared.framePtr) >>> 0 !== pointer
        )
          continue;
        const data = HEAPU8.slice(pointer, pointer + bytes);
        if (
          Atomics.load(HEAP32, base + Shared.frameSeq) === seq &&
          Atomics.load(HEAP32, base + Shared.frameIndex) === frameIndex &&
          Atomics.load(HEAP32, base + Shared.framePtr) >>> 0 === pointer
        )
          return { width, height, frameSeq: seq, data };
      } finally {
        Atomics.store(HEAP32, base + Shared.readIndex, -1);
      }
      if (attempt < 9) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("The game kept publishing while the frame was captured");
  }

  textureBytes(): number {
    return 0;
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
    if (
      kind !== CursorKind.None &&
      kind !== CursorKind.Overlay &&
      document.pointerLockElement === this.canvas
    ) {
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
