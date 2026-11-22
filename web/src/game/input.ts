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
  game: Pick<Ra2Exports, "ra2_input_pointer" | "ra2_input_key" | "ra2_focus" | "ra2_input_wheel">,
  options: {
    picture?: () => Size;
    enabled?: () => boolean;
    shortcut?: (event: KeyboardEvent) => boolean;
    warp?: () => { seq: number; x: number; y: number };
    textInput?: HTMLTextAreaElement;
    sendText?: (text: string) => void;
    /** a right-button press on the game (not under Pointer Lock), at that game pixel: Play asks the
     * game whose name is there (the player menu); the game gets the press as well */
    onSecondaryDown?: (point: { x: number; y: number }) => void;
    /** the page's chat box over the game's chat line, while it shows (ChatBox.tsx): typing keys
     * focus it and type there, so the game's own line under it gets none */
    chatBox?: () => HTMLElement | null;
  } = {},
): () => void {
  const picture = options.picture ?? (() => ({ width: canvas.width, height: canvas.height }));
  let virtual = { x: picture().width / 2, y: picture().height / 2 };
  /** The last point the pointer was at while unlocked: where the player's cursor really is. */
  let anchored: { x: number; y: number } | null = null;
  let anchoredSize = picture();
  let warpSeq = -1;
  /** The browser can report a delta across a lock it has just taken; ignore that one. */
  let skipMove = false;
  /** Where the virtual cursor is on screen, for carrying it across a picture change. */
  const virtualClient = (box: DOMRect, size: Size) => {
    const scale = Math.min(box.width / size.width, box.height / size.height) || 1;
    return {
      x: box.left + (box.width - size.width * scale) / 2 + virtual.x * scale,
      y: box.top + (box.height - size.height * scale) / 2 + virtual.y * scale,
    };
  };
  /**
   * The page's own parts over the game (marked data-page-overlay: the match panel) under the game's
   * cursor while the pointer is locked, when the real pointer reaches nothing on the page. The
   * root is told with a "pageoverlay" event (detail: true over it, false off it); a click there is
   * the element's, not the game's, and the wheel scrolls its [data-page-scroll] part.
   */
  let overlayRoot: HTMLElement | null = null;
  const swallowed = new Set<number>();
  const overlayAt = (): HTMLElement | null => {
    if (document.pointerLockElement !== canvas || typeof document.elementFromPoint !== "function")
      return null;
    const at = virtualClient(canvas.getBoundingClientRect(), picture());
    const element = document.elementFromPoint(at.x, at.y);
    return element instanceof HTMLElement && element.closest("[data-page-overlay]")
      ? element
      : null;
  };
  const hoverOverlay = (element: HTMLElement | null) => {
    const root = element?.closest<HTMLElement>("[data-page-overlay]") ?? null;
    if (root === overlayRoot) return;
    overlayRoot?.dispatchEvent(new CustomEvent("pageoverlay", { detail: false }));
    overlayRoot = root;
    root?.dispatchEvent(new CustomEvent("pageoverlay", { detail: true }));
  };
  const held = new Map<string, KeyPair>();
  const buttons = new Set<number>();
  let composing = false;
  let compositionText = "";
  const point = (event: MouseEvent, moving = false) => {
    const size = picture();
    const box = canvas.getBoundingClientRect();
    if (document.pointerLockElement === canvas) {
      if (size.width !== anchoredSize.width || size.height !== anchoredSize.height) {
        // A match changes the picture from the menus' 800x600 to its own size. The
        // virtual cursor was in the old picture's pixels; keep it on the same screen
        // pixel, under the player's pointer, instead of letting the first movement
        // fling it at an edge of the new picture.
        const at = virtualClient(box, anchoredSize);
        const p = toGamePixels(at.x, at.y, box, size);
        if (p) virtual = p;
        anchoredSize = size;
      }
      const warp = options.warp?.();
      if (warp && warp.seq > 0 && warp.seq !== warpSeq) {
        virtual = { x: warp.x, y: warp.y };
        warpSeq = warp.seq;
        anchored = null; // the game chose this place: do not override it later
      }
      const scale = Math.min(box.width / size.width, box.height / size.height) || 1;
      if (moving) {
        if (skipMove) skipMove = false;
        else {
          virtual.x += event.movementX / scale;
          virtual.y += event.movementY / scale;
        }
      }
      virtual.x = Math.max(0, Math.min(size.width - 1, virtual.x));
      virtual.y = Math.max(0, Math.min(size.height - 1, virtual.y));
      return { x: Math.floor(virtual.x), y: Math.floor(virtual.y) };
    }
    const p = toGamePixels(event.clientX, event.clientY, box, size);
    if (p) {
      virtual = p;
      anchored = { x: event.clientX, y: event.clientY };
      anchoredSize = size;
    }
    return p;
  };

  const onMove = (event: MouseEvent) => {
    if (options.enabled?.() === false) return;
    const p = point(event, true);
    if (p) game.ra2_input_pointer(PointerKind.Move, p.x, p.y, 0);
    hoverOverlay(overlayAt());
  };
  const onButton = (kind: number) => (event: MouseEvent) => {
    if (options.enabled?.() === false) return;
    const p = point(event);
    if (!p) return;
    event.preventDefault();
    const over = kind === PointerKind.Down ? overlayAt() : null;
    if (over) {
      // a press on the page's panel: its button, not an order on the battlefield
      swallowed.add(event.button);
      if (event.button === 0) {
        const field = over.closest<HTMLElement>("input, textarea");
        if (field) field.focus();
        else (over.closest<HTMLElement>("button, [role='button']") ?? over).click();
      }
      return;
    }
    if (kind === PointerKind.Up && swallowed.delete(event.button)) return;
    if (kind === PointerKind.Down && document.activeElement !== options.textInput) canvas.focus();
    if (kind === PointerKind.Down && event.button === 2 && document.pointerLockElement !== canvas)
      options.onSecondaryDown?.(p);
    if (kind === PointerKind.Down) buttons.add(event.button);
    else buttons.delete(event.button);
    game.ra2_input_pointer(kind, p.x, p.y, event.button);
  };
  const onDown = onButton(PointerKind.Down);
  const onUp = onButton(PointerKind.Up);
  const onContextMenu = (event: Event) => event.preventDefault();
  /** The wheel, in notches of 120 as Windows counts them: a mouse gives one an event, a
   * touchpad's small steps add up to one first. Pixels: 100 a notch; lines: 3. */
  let wheelRest = 0;
  const onWheel = (event: WheelEvent) => {
    const send = game.ra2_input_wheel;
    if (typeof send !== "function" || options.enabled?.() === false) return;
    const p = point(event);
    if (!p) return;
    event.preventDefault();
    const over = overlayAt();
    if (over) {
      over
        .closest("[data-page-overlay]")
        ?.querySelector("[data-page-scroll]")
        ?.scrollBy({ top: event.deltaY });
      return;
    }
    wheelRest +=
      event.deltaMode === 1
        ? event.deltaY / 3
        : event.deltaMode === 2
          ? event.deltaY
          : event.deltaY / 100;
    const notches = Math.trunc(wheelRest);
    if (notches === 0) return;
    wheelRest -= notches;
    send(-120 * notches, p.x, p.y);
  };

  const onKey = (down: boolean) => (event: KeyboardEvent) => {
    if (options.enabled?.() === false) return;
    // The game listens at window level, so let ordinary web controls handle their
    // own keys. In particular, preventing Ctrl+V here blocks paste in the LAN dialog.
    const target = event.target;
    const editingControl =
      target instanceof HTMLElement &&
      target !== options.textInput &&
      (target.isContentEditable ||
        target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
    if (editingControl) {
      // A key may have gone down in the game just before focus moved into a field.
      // Release it without suppressing the field's own keyup behavior.
      if (!down) {
        const key = held.get(event.code);
        if (key) {
          held.delete(event.code);
          game.ra2_input_key(0, key.vk, key.scan);
        }
      }
      return;
    }
    // Typing on a chat screen goes to the page's box, not the game's own line under it: the box
    // takes focus and, as the key is left alone, the key's text (or the IME) lands in it.
    if (down && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const box = options.chatBox?.();
      const typing =
        event.key.length === 1 || /^(Backspace|Delete|Enter|Process|Dead)$/.test(event.key);
      if (box && typing && document.activeElement !== options.textInput) {
        box.focus();
        return;
      }
    }
    if (down && options.shortcut?.(event)) {
      event.preventDefault();
      return;
    }
    const textFocused = !!options.textInput && document.activeElement === options.textInput;
    // Keep browser-owned shortcuts even while the hidden text sink has focus.
    if (
      event.ctrlKey &&
      !event.altKey &&
      /^(KeyR|KeyW|KeyT|KeyN|KeyL|F5|F12|Minus|Equal)$/.test(event.code)
    )
      return;
    // Let the browser's IME and virtual keyboard edit the focused text sink.
    // Physical controls remain key events; printable text comes from input.
    if (
      textFocused &&
      (event.isComposing || composing || event.key === "Process" || event.key === "Dead")
    )
      return;
    if (textFocused && event.key.length === 1) return;
    const key = keyFor(event.code);
    if (!key) return;
    // the browser keeps its own shortcuts (reload, dev tools, zoom, tabs): the game gets
    // the rest, which includes F1 to F12 and Tab
    event.preventDefault();
    if (event.repeat && !down) return;
    if (down) held.set(event.code, key);
    else held.delete(event.code);
    game.ra2_input_key(down ? 1 : 0, key.vk, key.scan);
  };
  const onKeyDown = onKey(true);
  const onKeyUp = onKey(false);
  const onCompositionStart = () => {
    composing = true;
    compositionText = "";
  };
  const onCompositionEnd = (event: CompositionEvent) => {
    composing = false;
    const committed = event.data || options.textInput?.value || compositionText;
    if (committed) {
      options.sendText?.(committed);
      compositionText = committed;
      // Some engines dispatch the final input event after compositionend.
      // Clear it after the event sequence so the same text is only sent once.
      window.setTimeout(() => {
        if (compositionText === committed) compositionText = "";
      }, 0);
    }
    if (options.textInput) options.textInput.value = "";
  };
  const onTextInput = (event: Event) => {
    if (
      !options.textInput ||
      document.activeElement !== options.textInput ||
      options.enabled?.() === false
    )
      return;
    const input = event as InputEvent;
    const value = options.textInput.value;
    if (composing || input.isComposing) {
      compositionText = value;
      return;
    }
    if (compositionText && (input.data === compositionText || value === compositionText)) {
      compositionText = "";
      options.textInput.value = "";
      return;
    }
    if (input.inputType === "deleteContentBackward") options.sendText?.("\b");
    else if (input.inputType === "insertLineBreak" || input.inputType === "insertParagraph")
      options.sendText?.("\r");
    else if (value) options.sendText?.(value);
    options.textInput.value = "";
  };
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
  // Focus leaving the game area for the page's own controls: the game pauses, as when the window blurs
  // (the text box for typing and the page's chat boxes, marked data-game-text, type for the game, so
  // going there is not leaving it)
  const onCanvasBlur = (event: FocusEvent) => {
    release();
    const to = event.relatedTarget;
    const typing =
      to === options.textInput || (to instanceof HTMLElement && "gameText" in to.dataset);
    if (!typing) game.ra2_focus(0);
  };
  const onLock = () => {
    if (document.pointerLockElement !== canvas) {
      release();
      return;
    }
    // Taking the lock hides the real pointer; carry the relative cursor over to
    // where the player's pointer was, and drop the delta the browser reports for
    // the lock itself (it can be the distance to its own lock anchor).
    const size = picture();
    if (anchored) {
      const p = toGamePixels(anchored.x, anchored.y, canvas.getBoundingClientRect(), size);
      if (p) virtual = p;
    }
    anchoredSize = size;
    skipMove = true;
  };

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mouseup", onUp);
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  options.textInput?.addEventListener("compositionstart", onCompositionStart);
  options.textInput?.addEventListener("compositionend", onCompositionEnd);
  options.textInput?.addEventListener("input", onTextInput);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("blur", onCanvasBlur);
  document.addEventListener("pointerlockchange", onLock);
  return () => {
    canvas.removeEventListener("mousemove", onMove);
    canvas.removeEventListener("mousedown", onDown);
    canvas.removeEventListener("mouseup", onUp);
    canvas.removeEventListener("contextmenu", onContextMenu);
    canvas.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    options.textInput?.removeEventListener("compositionstart", onCompositionStart);
    options.textInput?.removeEventListener("compositionend", onCompositionEnd);
    options.textInput?.removeEventListener("input", onTextInput);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    canvas.removeEventListener("blur", onCanvasBlur);
    document.removeEventListener("pointerlockchange", onLock);
    release();
  };
}
