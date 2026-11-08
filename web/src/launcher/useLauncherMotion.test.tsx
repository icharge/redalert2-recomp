import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LauncherTheme } from "../storage/launcher-theme";
import { useLauncherMotion } from "./useLauncherMotion";

function Harness({ theme }: { theme: LauncherTheme }) {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useLauncherMotion(ref, theme);
  return (
    <div ref={ref}>
      <div className="launcher-art" />
      <h1 className="launch-title">Game</h1>
      <button className="launch-primary" onClick={motion.preview}>
        Test
      </button>
      <p role="status">{motion.feedback}</p>
    </div>
  );
}
let reduced: MediaQueryList;
let animations: { cancel: ReturnType<typeof vi.fn>; finished: Promise<unknown> }[];
let pending: Map<number, FrameRequestCallback>;
let animateDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  const target = new EventTarget();
  reduced = Object.assign(target, { matches: false }) as MediaQueryList;
  vi.stubGlobal("matchMedia", () => reduced);
  pending = new Map();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  animations = [];
  animateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: () => {
      const animation = { cancel: vi.fn(), finished: new Promise(() => {}) };
      animations.push(animation);
      return animation;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect() {},
    fillRect() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (animateDescriptor) Object.defineProperty(HTMLElement.prototype, "animate", animateDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

describe("launcher motion lifetime", () => {
  it("removes atmosphere frames and canvas when changing theme or unmounting", () => {
    const view = render(<Harness theme="atmosphere" />);
    expect(pending.size).toBe(1);
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
    view.rerender(<Harness theme="retro" />);
    expect(pending.size).toBe(0);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    view.rerender(<Harness theme="atmosphere" />);
    view.unmount();
    expect(pending.size).toBe(0);
  });
  it("stops hidden atmosphere and restarts one frame when visible", () => {
    render(<Harness theme="atmosphere" />);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(pending.size).toBe(0);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    fireEvent(document, new Event("visibilitychange"));
    expect(pending.size).toBe(1);
  });
  it("cancels entrance animations on first interaction and honors reduced motion live", () => {
    const view = render(<Harness theme="animation" />);
    expect(animations.length).toBeGreaterThan(0);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Tab" });
    expect(animations.every((a) => a.cancel.mock.calls.length)).toBe(true);
    view.rerender(<Harness theme="retro" />);
    animations.length = 0;
    Object.assign(reduced, { matches: true });
    view.rerender(<Harness theme="atmosphere" />);
    expect(pending.size).toBe(0);
    view.rerender(<Harness theme="animation" />);
    expect(animations).toHaveLength(0);
  });
  it("returns to a fresh feedback state after leaving and reselecting the theme", () => {
    const view = render(<Harness theme="game-feel" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("status")).toHaveTextContent("Command acknowledged");
    view.rerender(<Harness theme="retro" />);
    view.rerender(<Harness theme="game-feel" />);
    expect(screen.getByRole("status")).toHaveTextContent("Ready for your command.");
  });
  it("cancels running effects when motion preference changes", () => {
    render(<Harness theme="animation" />);
    act(() => {
      Object.assign(reduced, { matches: true });
      reduced.dispatchEvent(new Event("change"));
    });
    expect(animations.every((a) => a.cancel.mock.calls.length)).toBe(true);
  });
});
