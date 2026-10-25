/** Browser privileges must be requested from a user gesture. Unsupported optional
 * APIs do not prevent fullscreen or Pointer Lock from working on their own. */
type KeyboardLock = { lock(keys?: string[]): Promise<void>; unlock(): void };
const keyboard = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

export async function enterFullscreen(element: HTMLElement): Promise<void> {
  await element.requestFullscreen();
  // Escape remains the browser's way out; lock the function keys the game uses.
  await keyboard()
    ?.lock([
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
      "F6",
      "F7",
      "F8",
      "F9",
      "F10",
      "F11",
      "F12",
      "Tab",
      "AltLeft",
      "AltRight",
    ])
    .catch(() => {});
}

export async function leaveFullscreen(): Promise<void> {
  keyboard()?.unlock();
  if (document.fullscreenElement) await document.exitFullscreen();
}

export function lockPointer(canvas: HTMLCanvasElement): Promise<void> {
  canvas.focus();
  if (document.pointerLockElement === canvas) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (error?: unknown) => {
      document.removeEventListener("pointerlockchange", changed);
      document.removeEventListener("pointerlockerror", failed);
      if (error) reject(error);
      else resolve();
    };
    const changed = () => {
      if (document.pointerLockElement === canvas) done();
    };
    const failed = () => done(new Error("Click inside the game to capture the cursor."));
    document.addEventListener("pointerlockchange", changed);
    document.addEventListener("pointerlockerror", failed);
    try {
      // Older browsers return void and report the result through events.
      const result = canvas.requestPointerLock();
      result?.then(() => done(), done);
    } catch (error) {
      done(error);
    }
  });
}

/** Try once on entering gameplay, then retry from a canvas click when browser
 * activation is required. Losing lock (Escape) never starts a recapture loop. */
export function autoLockPointer(canvas: HTMLCanvasElement) {
  let active = false;
  let requesting = false;
  let disposed = false;
  let escaped = false;
  const release = () => {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
  const request = () => {
    if (
      disposed ||
      !active ||
      escaped ||
      requesting ||
      document.pointerLockElement ||
      document.visibilityState === "hidden" ||
      !canvas.requestPointerLock
    )
      return;
    requesting = true;
    void lockPointer(canvas)
      .then(() => {
        if (disposed || !active || escaped) release();
      })
      .catch(() => {
        // A transition after loading may lack user activation. The next click retries.
      })
      .finally(() => {
        requesting = false;
      });
  };
  const clicked = () => {
    escaped = false;
    request();
  };
  const onEscape = (event: KeyboardEvent) => {
    if (event.code !== "Escape" && event.key !== "Escape") return;
    escaped = true;
    release(); // Do not consume the key: the game still needs to open its pause menu.
  };
  canvas.addEventListener("click", clicked);
  window.addEventListener("keydown", onEscape, true);
  return {
    update(next: boolean) {
      if (disposed || next === active) return;
      active = next;
      if (active) {
        escaped = false;
        request();
      } else release();
    },
    dispose() {
      disposed = true;
      active = false;
      canvas.removeEventListener("click", clicked);
      window.removeEventListener("keydown", onEscape, true);
      release();
    },
  };
}

export function releaseBrowserControls(): void {
  keyboard()?.unlock();
  if (document.pointerLockElement) document.exitPointerLock();
}
