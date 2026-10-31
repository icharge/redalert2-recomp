import { PAGE_CURSOR_RGBA_OFFSET, PageCursorKind, Shared } from "./protocol";

// The game's in-match cursor, drawn on the page (docs/web/cursor-layer.md).
//
// In a match the game blits its software cursor into its own picture, so the
// cursor moves at the game's frame rate plus presentation latency. The page
// already sends the pointer's position the moment the mouse moves
// (`Shared.pointerX/Y`); this class draws the sprite the game captured
// (`pageCursor*`, published by src/web/presenter.c) at that position, in its
// own animation frame, so it moves like the native pointer.
//
// Nothing here touches input: the position is the one already sent to the game,
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
 * Draws the game's captured cursor over the picture once per animation frame.
 * It also sets `Shared.pageCursorRequest` while it draws, which is what makes
 * the game skip its own blit: one cursor, never two.
 */
export class PageCursor {
  private readonly context: CanvasRenderingContext2D | null;
  private raf = 0;
  private seq = 0; // the sprite sequence already drawn
  private requested = false;
  private sprite: Uint8ClampedArray | null = null;
  private image: ImageData | null = null;
  private width = 0;
  private height = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** the game's canvas: the picture's letterbox is measured from it */
    private readonly picture: () => HTMLElement | null,
    private readonly memory: () => CursorMemory,
    /** the address of ra2_shared_t, from ra2_shared() */
    private readonly shared: number,
  ) {
    this.context = canvas.getContext("2d");
  }

  start(): void {
    this.canvas.style.display = "block";
    if (this.raf) return;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.hide();
    this.request(false);
    this.canvas.style.display = "none";
    this.seq = 0;
  }

  /** Called when the tab goes away: the game must draw its own cursor again. */
  release(): void {
    this.request(false);
    this.hide();
  }

  /** One animation frame: repaint the sprite, or hide it. */
  frame(): void {
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
      this.hide();
      this.request(false);
      return;
    }
    const seq = Atomics.load(HEAP32, at + Shared.pageCursorSeq);
    if (seq & 1) return; // the game is publishing the sprite: keep the last one
    if (seq !== this.seq) this.read(HEAPU8, HEAP32, at, seq);
    if (!this.sprite) {
      this.hide();
      this.request(false);
      return;
    }
    const box = this.picture()?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };
    const placement = placeCursor({
      gameWidth: Atomics.load(HEAP32, at + Shared.gameW),
      gameHeight: Atomics.load(HEAP32, at + Shared.gameH),
      box,
      x: Atomics.load(HEAP32, at + Shared.pointerX),
      y: Atomics.load(HEAP32, at + Shared.pointerY),
      hotX: Atomics.load(HEAP32, at + Shared.pageCursorHotX),
      hotY: Atomics.load(HEAP32, at + Shared.pageCursorHotY),
      spriteWidth: this.width,
      spriteHeight: this.height,
    });
    if (!placement) {
      this.hide();
      this.request(false);
      return;
    }
    const style = this.canvas.style;
    style.visibility = "visible";
    style.transform = `translate(${placement.left}px, ${placement.top}px)`;
    style.width = `${placement.width}px`;
    style.height = `${placement.height}px`;
    this.request(true);
  }

  /** Copy the published sprite; a sequence that moved while reading means the next frame retries. */
  private read(heap: Uint8Array, words: Int32Array, at: number, seq: number): void {
    const kind = Atomics.load(words, at + Shared.pageCursorKind);
    const width = Atomics.load(words, at + Shared.pageCursorW);
    const height = Atomics.load(words, at + Shared.pageCursorH);
    if (
      kind !== PageCursorKind.Image ||
      width <= 0 ||
      height <= 0 ||
      width * height * 4 > heap.length - (this.shared + PAGE_CURSOR_RGBA_OFFSET)
    ) {
      this.sprite = null;
      this.image = null;
      this.width = this.height = 0;
      this.seq = seq;
      return;
    }
    const from = this.shared + PAGE_CURSOR_RGBA_OFFSET;
    const pixels = heap.slice(from, from + width * height * 4);
    if (Atomics.load(words, at + Shared.pageCursorSeq) !== seq) return; // retry next frame
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.image = null;
    }
    this.sprite = new Uint8ClampedArray(pixels.buffer);
    this.width = width;
    this.height = height;
    this.seq = seq;
    // The canvas' own ImageData keeps its pixels in browser memory; it is made
    // from the game's canvas context, so a jsdom test without 2D drawing still
    // knows the sprite is there (and the game must keep its blit off).
    if (this.context) {
      this.image ??= this.context.createImageData(width, height);
      this.image.data.set(this.sprite);
      this.context.putImageData(this.image, 0, 0);
    }
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
