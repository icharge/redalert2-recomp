import {
  CURSOR_PX,
  CURSOR_RGBA_OFFSET,
  CursorKind,
  PAGE_CURSOR_INDICES_OFFSET,
  PAGE_CURSOR_PALETTE_OFFSET,
  PageCursorKind,
  PALETTE_BYTES,
  Shared,
} from "./protocol";

// The game's cursor, drawn on the page (docs/web/cursor-layer.md).
//
// In a match the game blits its software cursor into its own picture, so the
// cursor moves at the game's frame rate plus presentation latency. The page
// already sends the pointer's position the moment the mouse moves
// (`Shared.pointerX/Y`); this class draws the frame the game captured — the
// game's own MOUSE.SHA art, palette indices through MOUSEPAL.PAL (published by
// src/runtime/page_cursor.c and src/web/presenter.c) — at that position, in its
// own animation frame.
//
// The menus and the pause overlay use a Win32 cursor instead of a software one
// (the game's 32x32 arrow, published as CursorKind.Image/Overlay). The same
// canvas draws that one too, from the mouse's own screen position while the
// pointer is free, so every screen of the game has one cursor drawn one way at
// the display's rate. The presenters keep their CSS cursor as the fallback for
// the frames before this layer has a sprite (onActive tells them when to hide).
//
// The art is the game's own, so a mod that replaces the cursor is covered; and
// nothing here touches input: the position is the one already sent to the game,
// including Pointer Lock's virtual movement and the game's own warps.

export interface CursorMemory {
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
}

export interface CursorBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CursorPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PageCursorOptions {
  /**
   * Whether the layer is drawing the cursor: the presenter hides its own CSS
   * cursor (and the pause overlay image) while it is, and puts the game's back
   * when it stops. Called every frame; the presenter ignores repeats.
   */
  onActive?: (active: boolean) => void;
}

/**
 * Where the sprite's top-left goes: the game point is mapped through the same
 * letterbox the picture uses (object-fit: contain), and the hot spot is what
 * the game itself would subtract.
 */
export function placeCursor(options: {
  gameWidth: number;
  gameHeight: number;
  box: CursorBox;
  x: number;
  y: number;
  hotX: number;
  hotY: number;
  spriteWidth: number;
  spriteHeight: number;
}): CursorPlacement | null {
  const { gameWidth, gameHeight, box, x, y, hotX, hotY, spriteWidth, spriteHeight } = options;
  if (
    !(gameWidth > 0) ||
    !(gameHeight > 0) ||
    !(box.width > 0) ||
    !(box.height > 0) ||
    !(spriteWidth > 0) ||
    !(spriteHeight > 0)
  )
    return null;
  const scale = Math.min(box.width / gameWidth, box.height / gameHeight);
  return {
    left: box.left + (box.width - gameWidth * scale) / 2 + (x - hotX) * scale,
    top: box.top + (box.height - gameHeight * scale) / 2 + (y - hotY) * scale,
    width: spriteWidth * scale,
    height: spriteHeight * scale,
  };
}

/**
 * Draws the game's cursor frame over the picture once per animation frame. It
 * also sets `Shared.pageCursorRequest` while it draws, which is what makes the
 * game skip its own blit: one cursor, never two.
 */
export class PageCursor {
  private readonly context: CanvasRenderingContext2D | null;
  private raf = 0;
  private seq = 0; // the frame sequence already read
  private paletteSeq = 0;
  private palette: Uint8Array | null = null;
  private frame: Uint8Array | null = null; // indices, w*h
  private image: ImageData | null = null;
  private requested = false;
  private width = 0; // the sheet's size: where the frame is placed
  private height = 0;
  private fx = 0; // the frame's place in the sheet
  private fy = 0;
  private frameWidth = 0;
  private frameHeight = 0;
  /** the hot spot that came with the frame: never read apart from it */
  private hotX = 0;
  private hotY = 0;
  /** the Win32 cursor: the last sequence read, and whether it is painted */
  private windowsSeq = -1;
  private windowsPixels: Uint8Array | null = null;
  /** the mouse's screen position while the pointer is free (the menus) */
  private pointer: { x: number; y: number } | null = null;
  private listening = false;
  private readonly onActive?: (active: boolean) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** the game's canvas: the picture's letterbox is measured from it */
    private readonly picture: () => HTMLElement | null,
    private readonly memory: () => CursorMemory,
    /** the address of ra2_shared_t, from ra2_shared() */
    private readonly shared: number,
    options: PageCursorOptions = {},
  ) {
    this.context = canvas.getContext("2d");
    this.onActive = options.onActive;
  }

  /** The mouse's screen position: the menus draw the cursor where it really is. */
  private readonly onMove = (event: MouseEvent): void => {
    // Under Pointer Lock the event's coordinates are frozen (or zero): the
    // shared pointer is the truthful one there, and must not be poisoned.
    if (document.pointerLockElement) return;
    this.pointer = { x: event.clientX, y: event.clientY };
  };

  start(): void {
    this.canvas.style.display = "block";
    if (!this.listening) {
      window.addEventListener("mousemove", this.onMove, true);
      this.listening = true;
    }
    if (this.raf) return;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frameStep();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.listening) {
      window.removeEventListener("mousemove", this.onMove, true);
      this.listening = false;
    }
    this.hideAll();
    this.canvas.style.display = "none";
    this.seq = this.paletteSeq = 0;
    this.windowsSeq = -1;
    this.windowsPixels = null;
    this.pointer = null;
    this.frame = this.palette = this.image = null;
    this.hotX = this.hotY = 0;
  }

  /** Called when the tab goes away: the game must draw its own cursor again. */
  release(): void {
    this.hideAll();
  }

  /** One animation frame: repaint the cursor, or hide it. */
  frameStep(): void {
    let memory: CursorMemory;
    try {
      memory = this.memory();
    } catch {
      return; // the module is shutting down
    }
    const { HEAP32, HEAPU8 } = memory;
    const at = this.shared >> 2;
    if (Atomics.load(HEAP32, at + Shared.protocol) < 10) {
      // a game build from before the page cursor: it draws its own, as before
      this.hideAll();
      return;
    }
    if (Atomics.load(HEAP32, at + Shared.pageCursorKind) === PageCursorKind.Image) {
      this.drawMatch(HEAP32, HEAPU8, at);
      return;
    }
    const kind = Atomics.load(HEAP32, at + Shared.cursorKind);
    if (kind === CursorKind.Image || kind === CursorKind.Overlay) {
      // the menus and the pause overlay: the game's Win32 arrow, drawn here too
      this.drawWindowsCursor(HEAP32, HEAPU8, at);
      return;
    }
    // None: the game draws its own (a match, before the page has a sprite).
    // Arrow: the plain system arrow, which the presenter's CSS cursor keeps.
    this.hideAll();
  }

  /** The in-match sprite: MOUSE.SHA frames through MOUSEPAL.PAL. */
  private drawMatch(words: Int32Array, heap: Uint8Array, at: number): void {
    const paletteSeq = Atomics.load(words, at + Shared.pageCursorPaletteSeq);
    if (paletteSeq !== this.paletteSeq && (paletteSeq & 1) === 0)
      this.readPalette(heap, words, at, paletteSeq);
    const seq = Atomics.load(words, at + Shared.pageCursorSeq);
    if (seq & 1) return; // the game is publishing: keep the last frame
    if (seq !== this.seq) this.readFrame(heap, words, at, seq);
    if (!this.frame || !this.palette) {
      this.hideAll();
      return;
    }
    const placement = placeCursor({
      gameWidth: Atomics.load(words, at + Shared.gameW),
      gameHeight: Atomics.load(words, at + Shared.gameH),
      box: this.box(),
      x: Atomics.load(words, at + Shared.pointerX),
      y: Atomics.load(words, at + Shared.pointerY),
      hotX: this.hotX,
      hotY: this.hotY,
      spriteWidth: this.width,
      spriteHeight: this.height,
    });
    if (!placement) {
      this.hideAll();
      return;
    }
    this.show(placement);
    this.onActive?.(true);
    this.request(true); // the game skips its own blit: one cursor, never two
  }

  /**
   * The game's Win32 cursor (the menus, the pause overlay): 32x32 RGBA with its
   * hot spot. While the pointer is free it is drawn where the mouse really is,
   * not at `Shared.pointerX/Y` -- in the shell the game pins that to its own
   * SetCursorPos, place. Under Pointer Lock (the pause overlay) the shared
   * pointer is the only truthful one.
   */
  private drawWindowsCursor(words: Int32Array, heap: Uint8Array, at: number): void {
    const seq = Atomics.load(words, at + Shared.cursorSeq);
    if (seq !== this.windowsSeq) {
      this.windowsSeq = seq;
      const from = this.shared + CURSOR_RGBA_OFFSET;
      const size = CURSOR_PX * CURSOR_PX * 4;
      this.windowsPixels = from + size <= heap.length ? heap.slice(from, from + size) : null;
      const context = this.context;
      if (this.windowsPixels) {
        if (this.canvas.width !== CURSOR_PX || this.canvas.height !== CURSOR_PX) {
          this.canvas.width = CURSOR_PX;
          this.canvas.height = CURSOR_PX;
        }
        if (context) {
          const image = context.createImageData(CURSOR_PX, CURSOR_PX);
          image.data.set(this.windowsPixels);
          context.putImageData(image, 0, 0);
        }
      }
    }
    if (!this.windowsPixels) {
      this.hideAll();
      return;
    }
    const box = this.box();
    const gameWidth = Atomics.load(words, at + Shared.gameW);
    const gameHeight = Atomics.load(words, at + Shared.gameH);
    const scale = Math.min(box.width / gameWidth, box.height / gameHeight);
    const kind = Atomics.load(words, at + Shared.cursorKind);
    let x: number;
    let y: number;
    if (document.pointerLockElement || kind === CursorKind.Overlay) {
      // A match (locked), and the pause dialog the game shows over one: the
      // shared pointer is where the player last aimed, warps included.
      x = Atomics.load(words, at + Shared.pointerX);
      y = Atomics.load(words, at + Shared.pointerY);
    } else {
      const pointer = this.pointer;
      if (!pointer || !(scale > 0) || !(box.width > 0) || !(box.height > 0)) {
        this.hideAll();
        return;
      }
      x = (pointer.x - (box.left + (box.width - gameWidth * scale) / 2)) / scale;
      y = (pointer.y - (box.top + (box.height - gameHeight * scale) / 2)) / scale;
    }
    const placement = placeCursor({
      gameWidth,
      gameHeight,
      box,
      x,
      y,
      hotX: Atomics.load(words, at + Shared.cursorHotX),
      hotY: Atomics.load(words, at + Shared.cursorHotY),
      spriteWidth: CURSOR_PX,
      spriteHeight: CURSOR_PX,
    });
    if (!placement) {
      this.hideAll();
      return;
    }
    this.show(placement);
    this.onActive?.(true);
    this.request(false); // no blit to skip: the game is not drawing a cursor
  }

  private box(): CursorBox {
    return this.picture()?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };
  }

  private show(placement: CursorPlacement): void {
    const style = this.canvas.style;
    style.visibility = "visible";
    style.transform = `translate(${placement.left}px, ${placement.top}px)`;
    style.width = `${placement.width}px`;
    style.height = `${placement.height}px`;
  }

  /** MOUSEPAL.PAL: 768 bytes of r, g, b at 0..63 (the game scales by 4). */
  private readPalette(heap: Uint8Array, words: Int32Array, at: number, seq: number): void {
    const from = this.shared + PAGE_CURSOR_PALETTE_OFFSET;
    if (from + PALETTE_BYTES > heap.length) return;
    const palette = heap.slice(from, from + PALETTE_BYTES);
    if (Atomics.load(words, at + Shared.pageCursorPaletteSeq) !== seq) return; // retry next frame
    this.palette = palette;
    this.paletteSeq = seq;
    this.paint();
  }

  /** The published frame: w*h palette indices, placed at (x, y) in the sheet. */
  private readFrame(heap: Uint8Array, words: Int32Array, at: number, seq: number): void {
    const kind = Atomics.load(words, at + Shared.pageCursorKind);
    const width = Atomics.load(words, at + Shared.pageCursorW);
    const height = Atomics.load(words, at + Shared.pageCursorH);
    const from = this.shared + PAGE_CURSOR_INDICES_OFFSET;
    const sheetWidth = Atomics.load(words, at + Shared.pageCursorSheetW);
    const sheetHeight = Atomics.load(words, at + Shared.pageCursorSheetH);
    const fx = Atomics.load(words, at + Shared.pageCursorX);
    const fy = Atomics.load(words, at + Shared.pageCursorY);
    const hotX = Atomics.load(words, at + Shared.pageCursorHotX);
    const hotY = Atomics.load(words, at + Shared.pageCursorHotY);
    if (
      kind !== PageCursorKind.Image ||
      width <= 0 ||
      height <= 0 ||
      sheetWidth <= 0 ||
      sheetHeight <= 0 ||
      width > sheetWidth ||
      height > sheetHeight ||
      from + width * height > heap.length
    ) {
      this.frame = null;
      this.image = null;
      this.width = this.height = 0;
      this.hotX = this.hotY = 0;
      this.seq = seq;
      return;
    }
    const pixels = heap.slice(from, from + width * height);
    if (Atomics.load(words, at + Shared.pageCursorSeq) !== seq) return; // retry next frame
    if (this.canvas.width !== sheetWidth || this.canvas.height !== sheetHeight) {
      this.canvas.width = sheetWidth;
      this.canvas.height = sheetHeight;
      this.image = null;
    }
    this.frame = pixels;
    this.fx = fx;
    this.fy = fy;
    this.frameWidth = width;
    this.frameHeight = height;
    this.hotX = hotX;
    this.hotY = hotY;
    this.width = sheetWidth;
    this.height = sheetHeight;
    this.seq = seq;
    this.paint();
  }

  /** Colour the frame's indices through the palette into the sheet canvas. */
  private paint(): void {
    const context = this.context;
    if (!context || !this.frame || !this.palette || !this.width || !this.height) return;
    const image = (this.image ??= context.createImageData(this.width, this.height));
    image.data.fill(0);
    const x = this.fx;
    const y = this.fy;
    const palette = this.palette;
    const frame = this.frame;
    const w = Math.min(this.frameWidth, this.width - x);
    const h = Math.min(this.frameHeight, this.height - y);
    for (let row = 0; row < h; row++) {
      const to = (y + row) * this.width + x;
      for (let column = 0; column < w; column++) {
        const index = frame[row * this.frameWidth + column] ?? 0;
        if (!index) continue; // index 0 is transparent
        const from = index * 3;
        const to4 = (to + column) * 4;
        image.data[to4] = (palette[from] ?? 0) << 2;
        image.data[to4 + 1] = (palette[from + 1] ?? 0) << 2;
        image.data[to4 + 2] = (palette[from + 2] ?? 0) << 2;
        image.data[to4 + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }

  private hideAll(): void {
    this.hide();
    this.request(false);
    this.onActive?.(false);
  }

  private hide(): void {
    if (this.canvas.style.visibility !== "hidden") this.canvas.style.visibility = "hidden";
  }

  private request(on: boolean): void {
    if (this.requested === on) return;
    this.requested = on;
    try {
      Atomics.store(
        this.memory().HEAP32,
        (this.shared >> 2) + Shared.pageCursorRequest,
        on ? 1 : 0,
      );
    } catch {
      // the module is shutting down: the game keeps drawing its own cursor
    }
  }
}
