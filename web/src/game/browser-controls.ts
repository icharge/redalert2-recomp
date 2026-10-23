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

export async function lockPointer(canvas: HTMLCanvasElement): Promise<void> {
  canvas.focus();
  await canvas.requestPointerLock();
}

export function releaseBrowserControls(): void {
  keyboard()?.unlock();
  if (document.pointerLockElement) document.exitPointerLock();
}
