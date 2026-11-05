/** Browser privileges must be requested from a user gesture. Unsupported optional
 * APIs do not prevent fullscreen or Pointer Lock from working on their own. */
type KeyboardLock = { lock(keys?: string[]): Promise<void>; unlock(): void };
const keyboard = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

export async function enterFullscreen(element: HTMLElement): Promise<void> {
  await element.requestFullscreen();
  // In fullscreen, capture the keys the browser would otherwise keep. Escape
  // included: a short press must reach the game (its pause menu), or the
  // browser leaves fullscreen and the game never sees the key. Chromium keeps
  // a two-second Escape hold as the way out (the Keyboard Lock spec requires
  // an escape hatch); F11 and the on-screen button toggle it too.
  await keyboard()
    ?.lock([
      "Escape",
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

/** `unadjustedMovement` asks for raw mouse input: no OS acceleration, and no
 * hidden OS cursor to recentre when it reaches a desktop edge. Without it, a
 * fast flick into an edge can arrive as one large delta - the cursor jumps. */
type PointerLockRequest = (options?: { unadjustedMovement?: boolean }) => Promise<void> | void;

export function lockPointer(canvas: HTMLCanvasElement): Promise<void> {
  canvas.focus();
  if (document.pointerLockElement === canvas) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error?: unknown) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("pointerlockchange", changed);
      document.removeEventListener("pointerlockerror", failed);
      if (error) reject(error);
      else resolve();
    };
    const changed = () => {
      if (document.pointerLockElement === canvas) done();
    };
    const failed = () => done(new Error("Click inside the game to capture the cursor."));
    const request = canvas.requestPointerLock as PointerLockRequest;
    // A browser that rejects the options object (or has no raw input) still
    // locks the old way; activation failures are left to the click retry.
    const rawDenied = (error: unknown) => {
      if (settled || document.pointerLockElement === canvas) return done();
      if (error instanceof DOMException && error.name === "NotAllowedError") return done(error);
      try {
        const fallback = request.call(canvas);
        fallback?.then?.(() => done(), done);
      } catch (cause) {
        done(cause);
      }
    };
    document.addEventListener("pointerlockchange", changed);
    document.addEventListener("pointerlockerror", failed);
    try {
      const result = request.call(canvas, { unadjustedMovement: true });
      // Older browsers return void and report the result through events.
      result?.then?.(() => done(), rawDenied);
    } catch (error) {
      rawDenied(error);
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
