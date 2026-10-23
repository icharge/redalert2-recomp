import { PointerKind, type Ra2Exports } from "./protocol";

// A key as the game wants it: a Windows virtual key and the set-1 scan code
// (src/web/presenter.c ra2_input_key; the same pairs as pcrecomp's screen.c).
export interface KeyPair {
  vk: number;
  scan: number;
}

function buildKeyTable(): ReadonlyMap<string, KeyPair> {
  const table = new Map<string, KeyPair>();
  const add = (code: string, vk: number, scan: number) => table.set(code, { vk, scan });

  const letters = "QWERTYUIOP";
  const row2 = "ASDFGHJKL";
  const row3 = "ZXCVBNM";
  [...letters].forEach((c, i) => add(`Key${c}`, c.charCodeAt(0), 16 + i));
  [...row2].forEach((c, i) => add(`Key${c}`, c.charCodeAt(0), 30 + i));
  [...row3].forEach((c, i) => add(`Key${c}`, c.charCodeAt(0), 44 + i));
  for (let i = 1; i <= 9; i++) add(`Digit${i}`, 0x30 + i, 1 + i);
  add("Digit0", 0x30, 11);
  for (let i = 1; i <= 12; i++) add(`F${i}`, 0x6f + i, i <= 10 ? 58 + i : i === 11 ? 87 : 88);

  add("Escape", 0x1b, 1);
  add("Minus", 0xbd, 12);
  add("Equal", 0xbb, 13);
  add("Backspace", 0x08, 14);
  add("Tab", 0x09, 15);
  add("BracketLeft", 0xdb, 26);
  add("BracketRight", 0xdd, 27);
  add("Enter", 0x0d, 28);
  add("NumpadEnter", 0x0d, 28);
  add("ControlLeft", 0x11, 29);
  add("ControlRight", 0x11, 29);
  add("Semicolon", 0xba, 39);
  add("Quote", 0xde, 40);
  add("Backquote", 0xc0, 41);
  add("ShiftLeft", 0x10, 42);
  add("Backslash", 0xdc, 43);
  add("Comma", 0xbc, 51);
  add("Period", 0xbe, 52);
  add("Slash", 0xbf, 53);
  add("ShiftRight", 0x10, 54);
  add("AltLeft", 0x12, 56);
  add("AltRight", 0x12, 56);
  add("Space", 0x20, 57);
  add("CapsLock", 0x14, 58);
  add("Pause", 0x13, 0);
  add("Home", 0x24, 71);
  add("ArrowUp", 0x26, 72);
  add("PageUp", 0x21, 73);
  add("ArrowLeft", 0x25, 75);
  add("ArrowRight", 0x27, 77);
  add("End", 0x23, 79);
  add("ArrowDown", 0x28, 80);
  add("PageDown", 0x22, 81);
  add("Insert", 0x2d, 82);
  add("Delete", 0x2e, 83);
  add("Numpad0", 0x60, 82);
  const numpadScan = [82, 79, 80, 81, 75, 76, 77, 71, 72, 73]; // 0 to 9
  for (let i = 1; i <= 9; i++) add(`Numpad${i}`, 0x60 + i, numpadScan[i] ?? 0);
  add("NumpadMultiply", 0x6a, 55);
  add("NumpadAdd", 0x6b, 78);
  add("NumpadSubtract", 0x6d, 74);
  add("NumpadDecimal", 0x6e, 83);
  add("NumpadDivide", 0x6f, 53);
  return table;
}

const KEYS = buildKeyTable();

/** The virtual key and scan code for a KeyboardEvent.code, or null for a key the game has no use for. */
export function keyFor(code: string): KeyPair | null {
  return KEYS.get(code) ?? null;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * A pointer position over a canvas that shows the picture letterboxed (CSS object-fit:
 * contain), in the picture's own pixels, clamped to it. Null if there is no picture yet.
 */
export function toGamePixels(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  picture: Size,
): { x: number; y: number } | null {
  if (picture.width <= 0 || picture.height <= 0 || box.width <= 0 || box.height <= 0) return null;
  const scale = Math.min(box.width / picture.width, box.height / picture.height);
  const offsetX = (box.width - picture.width * scale) / 2;
  const offsetY = (box.height - picture.height * scale) / 2;
  const x = Math.floor((clientX - box.left - offsetX) / scale);
  const y = Math.floor((clientY - box.top - offsetY) / scale);
  return {
    x: Math.min(Math.max(x, 0), picture.width - 1),
    y: Math.min(Math.max(y, 0), picture.height - 1),
  };
}

/**
 * Sends the canvas's mouse and the page's keys to the game. The game's thread reads
 * them from a ring in its own time (src/web/presenter.c). Returns what to call to stop.
 */
export function attachInput(
  canvas: HTMLCanvasElement,
  game: Pick<Ra2Exports, "ra2_input_pointer" | "ra2_input_key" | "ra2_focus">,
  options: {
    picture?: () => Size;
    enabled?: () => boolean;
    shortcut?: (event: KeyboardEvent) => boolean;
    warp?: () => { seq: number; x: number; y: number };
  } = {},
): () => void {
  const picture = options.picture ?? (() => ({ width: canvas.width, height: canvas.height }));
  let virtual = { x: picture().width / 2, y: picture().height / 2 };
  let warpSeq = -1;
  const held = new Map<string, KeyPair>();
  const buttons = new Set<number>();
  const point = (event: MouseEvent, moving = false) => {
    const size = picture();
    const box = canvas.getBoundingClientRect();
    if (document.pointerLockElement === canvas) {
      const warp = options.warp?.();
      if (warp && warp.seq > 0 && warp.seq !== warpSeq) {
        virtual = { x: warp.x, y: warp.y };
        warpSeq = warp.seq;
      }
      const scale = Math.min(box.width / size.width, box.height / size.height) || 1;
      if (moving) {
        virtual.x += event.movementX / scale;
        virtual.y += event.movementY / scale;
      }
      virtual.x = Math.max(0, Math.min(size.width - 1, virtual.x));
      virtual.y = Math.max(0, Math.min(size.height - 1, virtual.y));
      return { x: Math.floor(virtual.x), y: Math.floor(virtual.y) };
    }
    const p = toGamePixels(event.clientX, event.clientY, box, size);
    if (p) virtual = p;
    return p;
  };

  const onMove = (event: MouseEvent) => {
    if (options.enabled?.() === false) return;
    const p = point(event, true);
    if (p) game.ra2_input_pointer(PointerKind.Move, p.x, p.y, 0);
  };
  const onButton = (kind: number) => (event: MouseEvent) => {
    if (options.enabled?.() === false) return;
    const p = point(event);
    if (!p) return;
    event.preventDefault();
    if (kind === PointerKind.Down) canvas.focus();
    if (kind === PointerKind.Down) buttons.add(event.button);
    else buttons.delete(event.button);
    game.ra2_input_pointer(kind, p.x, p.y, event.button);
  };
  const onDown = onButton(PointerKind.Down);
  const onUp = onButton(PointerKind.Up);
  const onContextMenu = (event: Event) => event.preventDefault();

  const onKey = (down: boolean) => (event: KeyboardEvent) => {
    if (options.enabled?.() === false) return;
    if (down && options.shortcut?.(event)) {
      event.preventDefault();
      return;
    }
    const key = keyFor(event.code);
    if (!key) return;
    // the browser keeps its own shortcuts (reload, dev tools, zoom, tabs): the game gets
    // the rest, which includes F1 to F12 and Tab
    if (
      event.ctrlKey &&
      !event.altKey &&
      /^(KeyR|KeyW|KeyT|KeyN|KeyL|F5|F12|Minus|Equal)$/.test(event.code)
    )
      return;
    event.preventDefault();
    if (event.repeat && !down) return;
    if (down) held.set(event.code, key);
    else held.delete(event.code);
    game.ra2_input_key(down ? 1 : 0, key.vk, key.scan);
  };
  const onKeyDown = onKey(true);
  const onKeyUp = onKey(false);
  const onFocus = () => game.ra2_focus(1);
  const release = () => {
    for (const key of held.values()) game.ra2_input_key(0, key.vk, key.scan);
    for (const button of buttons)
      game.ra2_input_pointer(PointerKind.Up, Math.floor(virtual.x), Math.floor(virtual.y), button);
    held.clear();
    buttons.clear();
  };
  const onBlur = () => {
    release();
    game.ra2_focus(0);
  };
  const onLock = () => {
    if (document.pointerLockElement !== canvas) release();
  };

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mouseup", onUp);
  canvas.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("blur", release);
  document.addEventListener("pointerlockchange", onLock);
  return () => {
    canvas.removeEventListener("mousemove", onMove);
    canvas.removeEventListener("mousedown", onDown);
    canvas.removeEventListener("mouseup", onUp);
    canvas.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    canvas.removeEventListener("blur", release);
    document.removeEventListener("pointerlockchange", onLock);
    release();
  };
}
