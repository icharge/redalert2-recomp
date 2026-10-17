import { describe, expect, it, vi } from "vitest";
import { attachInput, keyFor, toGamePixels } from "./input";
import { PointerKind } from "./protocol";

describe("keyFor", () => {
  it("gives the virtual key and scan code of letters, digits and function keys", () => {
    expect(keyFor("KeyA")).toEqual({ vk: 0x41, scan: 30 });
    expect(keyFor("KeyQ")).toEqual({ vk: 0x51, scan: 16 });
    expect(keyFor("KeyM")).toEqual({ vk: 0x4d, scan: 50 });
    expect(keyFor("Digit1")).toEqual({ vk: 0x31, scan: 2 });
    expect(keyFor("Digit0")).toEqual({ vk: 0x30, scan: 11 });
    expect(keyFor("F1")).toEqual({ vk: 0x70, scan: 59 });
    expect(keyFor("F10")).toEqual({ vk: 0x79, scan: 68 });
    expect(keyFor("F12")).toEqual({ vk: 0x7b, scan: 88 });
  });

  it("gives the game's keys: escape, enter, arrows, modifiers", () => {
    expect(keyFor("Escape")).toEqual({ vk: 0x1b, scan: 1 });
    expect(keyFor("Enter")).toEqual({ vk: 0x0d, scan: 28 });
    expect(keyFor("ArrowLeft")).toEqual({ vk: 0x25, scan: 75 });
    expect(keyFor("ShiftLeft")?.vk).toBe(0x10);
    expect(keyFor("ControlRight")?.vk).toBe(0x11);
    expect(keyFor("Numpad7")).toEqual({ vk: 0x67, scan: 71 });
    expect(keyFor("Numpad3")).toEqual({ vk: 0x63, scan: 81 });
  });

  it("has nothing for a key the game does not use", () => {
    expect(keyFor("MediaPlayPause")).toBeNull();
  });
});

describe("toGamePixels", () => {
  const picture = { width: 800, height: 600 };

  it("maps a window that is exactly the picture's shape", () => {
    const box = { left: 0, top: 0, width: 1600, height: 1200 };
    expect(toGamePixels(800, 600, box, picture)).toEqual({ x: 400, y: 300 });
    expect(toGamePixels(0, 0, box, picture)).toEqual({ x: 0, y: 0 });
  });

  it("allows for the bars of a wider window", () => {
    const box = { left: 100, top: 0, width: 1600, height: 600 }; // 800x600 centred: 400 px of bar each side
    expect(toGamePixels(100 + 400, 0, box, picture)).toEqual({ x: 0, y: 0 });
    expect(toGamePixels(100 + 1200 - 1, 599, box, picture)).toEqual({ x: 799, y: 599 });
  });

  it("allows for the bars of a taller window", () => {
    const box = { left: 0, top: 0, width: 800, height: 900 }; // 150 px of bar above and below
    expect(toGamePixels(10, 150, box, picture)).toEqual({ x: 10, y: 0 });
  });

  it("clamps a point in the bars to the picture", () => {
    const box = { left: 0, top: 0, width: 1600, height: 600 };
    expect(toGamePixels(5, 5, box, picture)).toEqual({ x: 0, y: 5 });
    expect(toGamePixels(1595, 5, box, picture)).toEqual({ x: 799, y: 5 });
  });

  it("has no answer before there is a picture", () => {
    expect(
      toGamePixels(1, 1, { left: 0, top: 0, width: 10, height: 10 }, { width: 0, height: 0 }),
    ).toBeNull();
  });
});

describe("attachInput", () => {
  function setup() {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    document.body.append(canvas);
    const game = { ra2_input_pointer: vi.fn(), ra2_input_key: vi.fn(), ra2_focus: vi.fn() };
    const detach = attachInput(canvas, game);
    return { canvas, game, detach };
  }

  it("sends the mouse in game pixels", () => {
    const { canvas, game, detach } = setup();
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: 120, clientY: 80 }));
    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 120, clientY: 80, button: 0 }));
    canvas.dispatchEvent(new MouseEvent("mouseup", { clientX: 121, clientY: 81, button: 2 }));
    expect(game.ra2_input_pointer.mock.calls).toEqual([
      [PointerKind.Move, 120, 80, 0],
      [PointerKind.Down, 120, 80, 0],
      [PointerKind.Up, 121, 81, 2],
    ]);
    detach();
  });

  it("sends keys, and keeps the browser's own shortcuts", () => {
    const { game, detach } = setup();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA", cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA", cancelable: true }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyR", ctrlKey: true, cancelable: true }),
    ); // reload
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit1", ctrlKey: true, cancelable: true }),
    ); // a control group
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "MediaPlayPause", cancelable: true }),
    );
    expect(game.ra2_input_key.mock.calls).toEqual([
      [1, 0x41, 30],
      [0, 0x41, 30],
      [1, 0x31, 2],
    ]);
    detach();
  });

  it("takes the right-click menu away, and stops when detached", () => {
    const { canvas, game, detach } = setup();
    const menu = new MouseEvent("contextmenu", { cancelable: true });
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    detach();
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    expect(game.ra2_input_pointer).not.toHaveBeenCalled();
    expect(game.ra2_input_key).not.toHaveBeenCalled();
  });

  it("tells the game about the window's focus", () => {
    const { game, detach } = setup();
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    expect(game.ra2_focus.mock.calls).toEqual([[0], [1]]);
    detach();
  });
});
