import { afterEach, describe, expect, it, vi } from "vitest";
import { GlPresenter } from "./gl-presenter";
import { PixelFormat, PresentMode, Shared } from "./protocol";
import type { WasmMemory } from "./presenter";

const SHARED = 256;
const FRAME = 4096;

function setup() {
  const buffer = new ArrayBuffer(1 << 17);
  let memory: WasmMemory = { HEAPU8: new Uint8Array(buffer), HEAP32: new Int32Array(buffer) };
  const words = new Int32Array(buffer);
  const word = (index: number, value: number) => (words[(SHARED >> 2) + index] = value);
  const calls: [string, ...unknown[]][] = [];
  const fallback = vi.fn();
  let id = 0;
  const gl = new Proxy(
    {
      TEXTURE_2D: 0x0de1,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_MAG_FILTER: 0x2800,
      NEAREST: 0x2600,
      LINEAR: 0x2601,
      CLAMP_TO_EDGE: 0x812f,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      RGB: 0x1907,
      RGBA: 0x1908,
      RGBA8: 0x8058,
      R8: 0x8229,
      RED: 0x1903,
      UNSIGNED_BYTE: 0x1401,
      UNSIGNED_SHORT_5_6_5: 0x8363,
      TRIANGLES: 4,
      COLOR_BUFFER_BIT: 0x4000,
      UNPACK_ALIGNMENT: 0x0cf5,
      UNPACK_ROW_LENGTH: 0x0cf2,
      ARRAY_BUFFER: 0x8892,
      STATIC_DRAW: 0x88e4,
      VERTEX_SHADER: 0x8b31,
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      LINK_STATUS: 0x8b82,
      createTexture: () => ({ texture: ++id }),
      createShader: () => ({ shader: ++id }),
      createProgram: () => ({ program: ++id }),
      createBuffer: () => ({ buffer: ++id }),
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      getUniformLocation: (_p: unknown, name: string) => name,
      getAttribLocation: () => 0,
    } as Record<string, unknown>,
    {
      get(target, key) {
        const v = Reflect.get(target, key);
        if (typeof v === "function")
          return (...args: unknown[]) => {
            calls.push([String(key), ...args]);
            return v(...args);
          };
        if (typeof v === "number") return v;
        return (...args: unknown[]) => calls.push([String(key), ...args]);
      },
    },
  ) as unknown as WebGL2RenderingContext;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((kind) =>
    kind === "webgl2" ? gl : null,
  );
  const canvas = document.createElement("canvas");
  const presenter = new GlPresenter(canvas, () => memory, SHARED, null, undefined, fallback);
  const frame = (format: number, width: number, height: number, pitch: number) => {
    word(Shared.format, format);
    word(Shared.frameW, width);
    word(Shared.frameH, height);
    word(Shared.framePitch, pitch);
    word(Shared.framePtr, FRAME);
    word(Shared.frameIndex, 1);
    word(Shared.frameSeq, (words[(SHARED >> 2) + Shared.frameSeq] ?? 0) + 2 || 2);
  };
  return {
    calls,
    canvas,
    fallback,
    frame,
    memory: () => memory,
    replaceMemory: (m: WasmMemory) => {
      memory = m;
    },
    presenter,
    word,
    words,
  };
}

afterEach(() => vi.restoreAllMocks());
class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void {
    this.callback(
      [{ contentRect: { width: 400, height: 300 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", FakeResizeObserver);

describe("GlPresenter", () => {
  it("uploads RGB565 pixels directly from shared wasm memory", () => {
    const { calls, frame, presenter } = setup();
    frame(PixelFormat.Rgb565, 4, 2, 8);
    presenter.draw();
    const upload = calls.find((c) => c[0] === "texSubImage2D");
    expect(upload).toBeDefined();
    expect(upload).toContain(4);
    expect(upload).toContain(2);
    expect(upload).toContain(0x8363);
    expect(upload?.at(-1)).toBeInstanceOf(Uint16Array);
    expect((upload?.at(-1) as Uint16Array).byteOffset).toBe(FRAME);
  });

  it("uploads PAL8 as R8 and a 256x1 palette", () => {
    const { calls, frame, presenter } = setup();
    frame(PixelFormat.Pal8, 4, 2, 4);
    presenter.draw();
    expect(calls.some((c) => c[0] === "texImage2D" && c.includes(256) && c.includes(1))).toBe(true);
    expect(calls.some((c) => c[0] === "texImage2D" && c.includes(0x8229))).toBe(true);
    expect(calls.some((c) => c[0] === "texSubImage2D" && c.includes(0x1903))).toBe(true);
  });

  it("does not upload an unchanged frame and brackets reads with readIndex", () => {
    const { calls, frame, presenter, words } = setup();
    frame(PixelFormat.Rgb565, 4, 2, 8);
    presenter.draw();
    presenter.draw();
    expect(calls.filter((c) => c[0] === "texSubImage2D")).toHaveLength(1);
    expect(words[(SHARED >> 2) + Shared.readIndex]).toBe(-1);
  });

  it("writes presentMode 1 when started", () => {
    const { presenter, words } = setup();
    presenter.start();
    expect(words[(SHARED >> 2) + Shared.presentMode]).toBe(PresentMode.Raw);
    presenter.stop();
  });

  it("reallocates the texture after a frame size change", () => {
    const { calls, frame, presenter } = setup();
    frame(PixelFormat.Rgb565, 4, 2, 8);
    presenter.draw();
    frame(PixelFormat.Rgb565, 8, 4, 16);
    presenter.draw();
    expect(
      calls.filter((c) => c[0] === "texImage2D" && c.includes(8) && c.includes(4)),
    ).toHaveLength(1);
  });

  it("takes fresh memory views each frame", () => {
    const first = setup();
    first.frame(PixelFormat.Rgb565, 4, 2, 8);
    const nextBuffer = new ArrayBuffer(1 << 17);
    const next: WasmMemory = {
      HEAPU8: new Uint8Array(nextBuffer),
      HEAP32: new Int32Array(nextBuffer),
    };
    next.HEAP32[(SHARED >> 2) + Shared.format] = PixelFormat.Rgb565;
    next.HEAP32[(SHARED >> 2) + Shared.frameW] = 4;
    next.HEAP32[(SHARED >> 2) + Shared.frameH] = 2;
    next.HEAP32[(SHARED >> 2) + Shared.framePitch] = 8;
    next.HEAP32[(SHARED >> 2) + Shared.framePtr] = FRAME;
    next.HEAP32[(SHARED >> 2) + Shared.frameIndex] = 0;
    next.HEAP32[(SHARED >> 2) + Shared.frameSeq] = 4;
    first.presenter.draw();
    first.replaceMemory(next);
    first.presenter.draw();
    expect(first.calls.filter((c) => c[0] === "texSubImage2D")).toHaveLength(2);
  });

  it("asks the game to republish after context restoration", () => {
    const { canvas, calls, frame, presenter, words } = setup();
    frame(PixelFormat.Rgb565, 4, 2, 8);
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    presenter.draw();
    expect(calls.filter((c) => c[0] === "texSubImage2D")).toHaveLength(0);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(words[(SHARED >> 2) + Shared.republish]).toBe(1);
  });

  it("falls back once on a pixel format the shader does not support", () => {
    const { fallback, frame, presenter, word } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    frame(PixelFormat.Rgb565, 4, 2, 8);
    word(Shared.format, 9);
    presenter.draw();
    presenter.draw();
    expect(fallback).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith("format");
    expect(error).toHaveBeenCalledOnce();
  });

  it("uses a fresh 2D canvas when a WebGL2 context cannot be created", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const fallback = vi.fn();
    expect(
      () =>
        new GlPresenter(
          document.createElement("canvas"),
          () => {
            const buffer = new ArrayBuffer(1 << 16);
            return { HEAPU8: new Uint8Array(buffer), HEAP32: new Int32Array(buffer) };
          },
          SHARED,
          null,
          undefined,
          fallback,
        ),
    ).toThrow("WebGL2 unavailable");
    expect(fallback).toHaveBeenCalledWith("context");
  });
});
