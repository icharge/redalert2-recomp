import { CursorKind, PixelFormat, PresentMode, Shared, type Scale } from "./protocol";
import { CURSOR_PX, CURSOR_RGBA_OFFSET } from "./protocol";
import { FRAGMENT_SOURCE, SCALE_MODE, VERTEX_SOURCE } from "./gl-shaders";
import type { GamePresenter, PresenterCounters, WasmMemory } from "./presenter";

type Fallback = (why: "format" | "context") => void;

/** WebGL2 uploads the game's raw shared-memory frame and converts it in one draw. */
export class GlPresenter implements GamePresenter {
  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private paletteTexture: WebGLTexture;
  private frameSeq = -1;
  private uploadedSeq = -1;
  private cursorSeq = -1;
  private raf = 0;
  private pictures = 0;
  private ticks = 0;
  private drawMs = 0;
  private scale: Scale = "sharp";
  private bars = true;
  private lost = false;
  private errorReported = false;
  private cssSize = { width: 1, height: 1 };
  private drawMemory: WasmMemory | null = null;
  private observer: ResizeObserver;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly memory: () => WasmMemory,
    private readonly shared: number,
    private readonly cursorOverlay?: HTMLImageElement | null,
    private readonly capturePointer?: (active: boolean) => void,
    private readonly onFallback: Fallback = () => {},
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      desynchronized: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      throw new Error("WebGL2 unavailable");
    }
    this.gl = gl;
    this.program = this.createProgram();
    this.texture = this.createTexture();
    this.paletteTexture = this.createTexture();
    this.canvas.style.width = this.canvas.style.height = "100%";
    this.canvas.style.objectFit = "fill";
    this.observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      this.cssSize = { width: entry.contentRect.width, height: entry.contentRect.height };
      this.resize();
    });
    this.observer.observe(canvas);
    canvas.addEventListener("webglcontextlost", this.contextLost);
    canvas.addEventListener("webglcontextrestored", this.contextRestored);
  }

  private word(index: number): number {
    return Atomics.load((this.drawMemory ?? this.memory()).HEAP32, (this.shared >> 2) + index);
  }
  private createTexture(): WebGLTexture {
    const texture = this.gl.createTexture();
    if (!texture) throw new Error("WebGL2 could not create a texture");
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    return texture;
  }
  private shader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error("WebGL2 could not create a shader");
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS))
      throw new Error(this.gl.getShaderInfoLog(shader) || "WebGL shader compilation failed");
    return shader;
  }
  private createProgram(): WebGLProgram {
    const program = this.gl.createProgram();
    if (!program) throw new Error("WebGL2 could not create a program");
    this.gl.attachShader(program, this.shader(this.gl.VERTEX_SHADER, VERTEX_SOURCE));
    this.gl.attachShader(program, this.shader(this.gl.FRAGMENT_SHADER, FRAGMENT_SOURCE));
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS))
      throw new Error(this.gl.getProgramInfoLog(program) || "WebGL program link failed");
    return program;
  }
  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(this.cssSize.width * dpr));
    this.canvas.height = Math.max(1, Math.round(this.cssSize.height * dpr));
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
  private contextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.stop();
    this.onFallback("context");
  };
  private contextRestored = (): void => {
    this.lost = false;
    this.program = this.createProgram();
    this.texture = this.createTexture();
    this.paletteTexture = this.createTexture();
    this.texW = this.texH = 0;
    this.texFormat = -1;
    Atomics.store(this.memory().HEAP32, (this.shared >> 2) + Shared.republish, 1);
    this.frameSeq = -1;
  };

  counters(): PresenterCounters {
    return { pictures: this.pictures, ticks: this.ticks, drawMs: this.drawMs };
  }
  gameSize(): { width: number; height: number } {
    return {
      width: this.word(Shared.gameW) || this.word(Shared.frameW),
      height: this.word(Shared.gameH) || this.word(Shared.frameH),
    };
  }
  cursorWarp(): { seq: number; x: number; y: number } {
    return {
      seq: this.word(Shared.warpSeq),
      x: this.word(Shared.warpX),
      y: this.word(Shared.warpY),
    };
  }
  configure(scale: Scale, bars = true): void {
    this.scale = scale;
    this.bars = bars;
    this.frameSeq = -1;
  }
  redraw(): void {
    this.frameSeq = -1;
  }
  start(): void {
    Atomics.store(this.memory().HEAP32, (this.shared >> 2) + Shared.presentMode, PresentMode.Raw);
    const tick = () => {
      const t = performance.now();
      this.draw();
      this.drawMs += performance.now() - t;
      this.ticks++;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop(): void {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.contextRestored);
  }
  textureBytes(): number {
    return (
      this.word(Shared.frameW) *
        this.word(Shared.frameH) *
        (this.word(Shared.format) === PixelFormat.Rgb565 ? 2 : 4) +
      1024
    );
  }

  draw(): void {
    const mem = this.memory();
    this.drawMemory = mem;
    const words = mem.HEAP32;
    const base = this.shared >> 2;
    const word = (i: number) => Atomics.load(words, base + i);
    const seq = word(Shared.frameSeq);
    if (!this.lost && seq >= 0 && !(seq & 1) && seq !== this.frameSeq) {
      const w = word(Shared.frameW),
        h = word(Shared.frameH),
        ptr = word(Shared.framePtr) >>> 0;
      const pitch = word(Shared.framePitch),
        fmt = word(Shared.format),
        index = word(Shared.frameIndex);
      if (w > 0 && h > 0 && ptr > 0 && [0, 1, 2, 3].includes(fmt)) {
        Atomics.store(words, base + Shared.readIndex, index);
        if (
          word(Shared.frameSeq) !== seq ||
          word(Shared.frameIndex) !== index ||
          word(Shared.framePtr) >>> 0 !== ptr
        ) {
          Atomics.store(words, base + Shared.readIndex, -1);
          this.drawMemory = null;
          return;
        }
        try {
          if (
            this.upload(
              ptr,
              w,
              h,
              pitch || w * (fmt === PixelFormat.Rgb565 ? 2 : fmt === PixelFormat.Pal8 ? 1 : 4),
              fmt,
            )
          ) {
            // readIndex keeps this buffer immutable through the upload. Even if the
            // game publishes another frame concurrently, the texture now contains
            // this sequence and capture() must report that sequence for its pixels.
            this.uploadedSeq = seq;
            if (word(Shared.frameSeq) === seq) {
              this.frameSeq = seq;
              this.paint(w, h, fmt);
              this.pictures++;
            }
          }
        } finally {
          Atomics.store(words, base + Shared.readIndex, -1);
        }
      } else if (![0, 1, 2, 3].includes(fmt)) {
        if (!this.errorReported) {
          this.errorReported = true;
          console.error(`Unsupported game pixel format ${fmt}`);
          this.onFallback("format");
        }
      }
    }
    const cursorSeq = word(Shared.cursorSeq);
    if (cursorSeq !== this.cursorSeq) {
      this.cursorSeq = cursorSeq;
      this.setCursor(
        word(Shared.cursorKind),
        word(Shared.cursorHotX),
        word(Shared.cursorHotY),
        mem.HEAPU8,
      );
    }
    this.drawCursorOverlay(word);
    this.capturePointer?.(word(Shared.frameW) > 0 && word(Shared.cursorKind) === CursorKind.None);
    this.drawMemory = null;
  }

  private upload(ptr: number, w: number, h: number, pitch: number, fmt: number): boolean {
    // A game-thread memory.grow() can publish a frame into the enlarged heap
    // before Emscripten refreshes the page thread's HEAP views. Re-fetch them at
    // the upload boundary; if that view is still stale, leave the frame for the
    // next animation tick instead of constructing an out-of-bounds typed array.
    const uploadMemory = this.memory();
    this.drawMemory = uploadMemory;
    const bytesPerPixel = fmt === PixelFormat.Rgb565 ? 2 : fmt === PixelFormat.Pal8 ? 1 : 4;
    const needed = pitch * h;
    if (
      !Number.isSafeInteger(ptr) ||
      !Number.isSafeInteger(needed) ||
      ptr < 0 ||
      needed < 0 ||
      ptr + needed > uploadMemory.HEAPU8.byteLength
    )
      return false;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const internal =
      fmt === PixelFormat.Pal8 ? gl.R8 : fmt === PixelFormat.Rgb565 ? gl.RGB : gl.RGBA8;
    const format =
      fmt === PixelFormat.Pal8 ? gl.RED : fmt === PixelFormat.Rgb565 ? gl.RGB : gl.RGBA;
    const type = fmt === PixelFormat.Rgb565 ? gl.UNSIGNED_SHORT_5_6_5 : gl.UNSIGNED_BYTE;
    if (this.texW !== w || this.texH !== h || this.texFormat !== fmt) {
      this.texW = w;
      this.texH = h;
      this.texFormat = fmt;
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, pitch / bytesPerPixel);
    const pixels =
      fmt === PixelFormat.Rgb565
        ? new Uint16Array(uploadMemory.HEAPU8.buffer, ptr, (pitch / 2) * h)
        : uploadMemory.HEAPU8.subarray(ptr, ptr + needed);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, format, type, pixels);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    if (fmt === PixelFormat.Pal8) {
      const palette = wordFrom(uploadMemory.HEAP32, this.shared, Shared.palettePtr) >>> 0;
      gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        256,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(uploadMemory.HEAPU8.buffer, palette, 256 * 4),
      );
    }
    return true;
  }
  private texW = 0;
  private texH = 0;
  private texFormat = -1;
  private paint(
    w: number,
    h: number,
    fmt: number,
    targetWidth = this.canvas.width,
    targetHeight = this.canvas.height,
    capture = false,
  ): void {
    const gl = this.gl;
    gl.viewport(0, 0, targetWidth, targetHeight);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, "picture"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "palette"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "format"), fmt);
    gl.uniform1i(gl.getUniformLocation(this.program, "scaleMode"), SCALE_MODE[this.scale]);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      this.scale === "smooth" ? gl.LINEAR : gl.NEAREST,
    );
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MAG_FILTER,
      this.scale === "smooth" ? gl.LINEAR : gl.NEAREST,
    );
    const box = capture ? { width: targetWidth, height: targetHeight } : this.cssSize;
    const factor = Math.min(box.width / w, box.height / h) || 1;
    const rw = capture || !this.bars ? 1 : (w * factor) / (box.width || 1);
    const rh = capture || !this.bars ? 1 : (h * factor) / (box.height || 1);
    gl.uniform4f(
      gl.getUniformLocation(this.program, "rect"),
      capture ? 0 : (1 - rw) / 2,
      capture ? 0 : (1 - rh) / 2,
      rw,
      rh,
    );
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  async capture(options?: {
    hd?: boolean;
  }): Promise<{ width: number; height: number; frameSeq: number; data: Uint8Array }> {
    // HD layer composition lands in Task 5, so capture is game-size for now.
    void options;
    // Align the texture with the newest stable shared frame before reading it.
    this.draw();
    const width = this.texW,
      height = this.texH,
      frameSeq = this.uploadedSeq;
    if (width <= 0 || height <= 0 || this.texFormat < 0 || frameSeq < 0)
      throw new Error("No uploaded frame to capture");
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    const target = gl.createTexture();
    if (!framebuffer || !target) throw new Error("Could not create capture framebuffer");
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, width, height);
    this.paint(width, height, this.texFormat, width, height, true);
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const data = new Uint8Array(raw.length);
    const stride = width * 4;
    for (let y = 0; y < height; y++)
      data.set(raw.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(target);
    return { width, height, frameSeq, data };
  }
  private drawCursorOverlay(word: (i: number) => number): void {
    const cursor = this.cursorOverlay;
    if (!cursor) return;
    if (word(Shared.cursorKind) !== CursorKind.Overlay) {
      cursor.style.display = "none";
      return;
    }
    const w = word(Shared.gameW) || this.word(Shared.frameW),
      h = word(Shared.gameH) || this.word(Shared.frameH);
    const rect = this.canvas.getBoundingClientRect();
    const s = Math.min(rect.width / w, rect.height / h);
    cursor.style.width = `${CURSOR_PX * s}px`;
    cursor.style.height = `${CURSOR_PX * s}px`;
    cursor.style.left = `${rect.left + (rect.width - w * s) / 2 + (word(Shared.pointerX) - word(Shared.cursorHotX)) * s}px`;
    cursor.style.top = `${rect.top + (rect.height - h * s) / 2 + (word(Shared.pointerY) - word(Shared.cursorHotY)) * s}px`;
    cursor.style.display = "block";
  }
  private setCursor(kind: number, hotX: number, hotY: number, heap: Uint8Array): void {
    if (this.cursorOverlay) this.cursorOverlay.style.display = "none";
    if (
      kind !== CursorKind.None &&
      kind !== CursorKind.Overlay &&
      document.pointerLockElement === this.canvas
    )
      document.exitPointerLock();
    if (kind === CursorKind.None) this.canvas.style.cursor = "none";
    else if (kind === CursorKind.Arrow) this.canvas.style.cursor = "default";
    else {
      const pixels = heap.slice(
        this.shared + CURSOR_RGBA_OFFSET,
        this.shared + CURSOR_RGBA_OFFSET + CURSOR_PX * CURSOR_PX * 4,
      );
      const c = document.createElement("canvas");
      c.width = c.height = CURSOR_PX;
      const ctx = c.getContext("2d");
      if (!ctx) {
        this.canvas.style.cursor = "default";
        return;
      }
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(pixels.buffer), CURSOR_PX, CURSOR_PX),
        0,
        0,
      );
      if (kind === CursorKind.Overlay && this.cursorOverlay) {
        this.cursorOverlay.src = c.toDataURL();
        this.canvas.style.cursor = "none";
      } else this.canvas.style.cursor = `url(${c.toDataURL()}) ${hotX} ${hotY}, default`;
    }
  }
}

function wordFrom(heap: Int32Array, shared: number, index: number): number {
  return Atomics.load(heap, (shared >> 2) + index);
}
