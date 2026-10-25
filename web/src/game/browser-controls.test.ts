import { afterEach, expect, it, vi } from "vitest";
import { autoLockPointer } from "./browser-controls";

function setup() {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  let locked: Element | null = null;
  const grant = () => {
    locked = canvas;
    document.dispatchEvent(new Event("pointerlockchange"));
  };
  Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => locked });
  const exit = vi.fn(() => {
    locked = null;
    document.dispatchEvent(new Event("pointerlockchange"));
  });
  Object.defineProperty(document, "exitPointerLock", { configurable: true, value: exit });
  const request = vi.fn(() => {
    grant();
    return Promise.resolve();
  });
  Object.defineProperty(canvas, "requestPointerLock", { configurable: true, value: request });
  return { canvas, grant, request, exit, control: autoLockPointer(canvas) };
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "pointerLockElement");
  Reflect.deleteProperty(document, "exitPointerLock");
});

it("captures once on gameplay entry, releases for settings/menus, and recaptures on return", async () => {
  const { canvas, request, exit, control } = setup();
  control.update(false);
  canvas.click();
  expect(request).not.toHaveBeenCalled();
  control.update(true);
  await settle();
  for (let i = 0; i < 60; i++) control.update(true);
  expect(request).toHaveBeenCalledOnce();
  expect(document.pointerLockElement).toBe(canvas);
  control.update(false);
  expect(exit).toHaveBeenCalledOnce();
  canvas.click();
  expect(request).toHaveBeenCalledOnce();
  control.update(true);
  await settle();
  expect(request).toHaveBeenCalledTimes(2);
  control.dispose();
});

it("retries an activation-denied request on the next game click", async () => {
  const { canvas, request, control } = setup();
  request.mockRejectedValueOnce(new DOMException("User activation required", "NotAllowedError"));
  control.update(true);
  await settle();
  control.update(true);
  expect(request).toHaveBeenCalledOnce();
  canvas.click();
  await settle();
  expect(request).toHaveBeenCalledTimes(2);
  expect(document.pointerLockElement).toBe(canvas);
  control.dispose();
});

it("releases on Escape immediately and still lets the key reach the game", async () => {
  const { canvas, request, control } = setup();
  control.update(true);
  await settle();
  const gameKey = vi.fn();
  window.addEventListener("keydown", gameKey);
  const escape = new KeyboardEvent("keydown", { code: "Escape", cancelable: true });
  window.dispatchEvent(escape);
  expect(gameKey).toHaveBeenCalledOnce();
  expect(escape.defaultPrevented).toBe(false);
  window.removeEventListener("keydown", gameKey);
  for (let i = 0; i < 60; i++) control.update(true);
  expect(document.pointerLockElement).toBeNull();
  expect(request).toHaveBeenCalledOnce();
  canvas.click();
  await settle();
  expect(request).toHaveBeenCalledTimes(2);
  control.dispose();
});

it("keeps pause-menu clicks unlocked and recaptures after Resume", async () => {
  const { canvas, request, control } = setup();
  control.update(true);
  await settle();
  control.update(false); // Pause is visible, including when opened by a sidebar button.
  for (let i = 0; i < 5; i++) canvas.click();
  await settle();
  expect(document.pointerLockElement).toBeNull();
  expect(request).toHaveBeenCalledOnce();
  control.update(true);
  await settle();
  expect(document.pointerLockElement).toBe(canvas);
  expect(request).toHaveBeenCalledTimes(2);
  control.dispose();
});

it("releases a pending capture that arrives after Escape", async () => {
  const { canvas, grant, exit, control } = setup();
  Object.defineProperty(canvas, "requestPointerLock", { value: vi.fn(() => undefined) });
  control.update(true);
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
  grant();
  await settle();
  expect(exit).toHaveBeenCalledOnce();
  expect(document.pointerLockElement).toBeNull();
  control.dispose();
});

it("handles legacy browsers that report failure through pointerlockerror", async () => {
  const { canvas, grant, request, control } = setup();
  Object.defineProperty(canvas, "requestPointerLock", { value: vi.fn(() => undefined) });
  control.update(true);
  document.dispatchEvent(new Event("pointerlockerror"));
  await settle();
  Object.defineProperty(canvas, "requestPointerLock", { value: request });
  canvas.click();
  grant();
  await settle();
  expect(request).toHaveBeenCalledOnce();
  expect(document.pointerLockElement).toBe(canvas);
  control.dispose();
});

it("releases a delayed grant when settings have already opened", async () => {
  const { canvas, grant, exit, control } = setup();
  Object.defineProperty(canvas, "requestPointerLock", { value: vi.fn(() => undefined) });
  control.update(true);
  control.update(false);
  grant();
  await settle();
  expect(exit).toHaveBeenCalledOnce();
  expect(document.pointerLockElement).toBeNull();
  control.dispose();
});

it("removes click capture and releases the cursor when disposed", async () => {
  const { canvas, request, exit, control } = setup();
  control.update(true);
  await settle();
  control.dispose();
  canvas.click();
  control.update(true);
  expect(request).toHaveBeenCalledOnce();
  expect(exit).toHaveBeenCalledOnce();
});
