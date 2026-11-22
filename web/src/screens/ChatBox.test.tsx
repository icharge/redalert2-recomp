import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChatBox, chatBoxPlace } from "./ChatBox";

const field = { open: true, x: 14, y: 516, w: 772, h: 28 };
const presenter = {
  pictureRect: () => ({ x: 0, y: 0, width: 1, height: 1 }),
  gameSize: () => ({ width: 800, height: 600 }),
};

describe("chatBoxPlace", () => {
  it("covers the game's chat line where the picture is drawn", () => {
    // an 800x600 picture drawn at 1x in the middle of a 1000x700 canvas
    const at = chatBoxPlace(
      { left: 10, top: 20, width: 1000, height: 700 },
      { left: 10, top: 0 },
      { x: 0.1, y: 50 / 700, width: 0.8, height: 600 / 700 },
      { width: 800, height: 600 },
      field,
    );
    expect(at.left).toBeCloseTo(100 + 14);
    expect(at.top).toBeCloseTo(20 + 50 + 516);
    expect(at.width).toBeCloseTo(772);
    expect(at.height).toBeCloseTo(28);
  });

  it("scales with the picture", () => {
    const at = chatBoxPlace(
      { left: 0, top: 0, width: 1600, height: 1200 },
      { left: 0, top: 0 },
      { x: 0, y: 0, width: 1, height: 1 },
      { width: 800, height: 600 },
      field,
    );
    expect(at.left).toBeCloseTo(28);
    expect(at.top).toBeCloseTo(1032);
    expect(at.width).toBeCloseTo(1544);
    expect(at.height).toBeCloseTo(56);
  });
});

function renderBox(send: ((text: string) => void) | null, open = true) {
  const stage = createRef<HTMLDivElement>();
  const canvas = createRef<HTMLCanvasElement>();
  return render(
    <div ref={stage}>
      <canvas ref={canvas} />
      <ChatBox
        field={{ ...field, open }}
        presenter={presenter}
        stage={stage}
        canvas={canvas}
        send={send}
      />
    </div>,
  );
}

describe("ChatBox", () => {
  it("sends the line on Enter and empties the box", () => {
    const send = vi.fn();
    renderBox(send);
    const box = screen.getByRole("textbox", { name: "Chat message" });
    fireEvent.change(box, { target: { value: "  สวัสดี ครับ  " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).toHaveBeenCalledWith("สวัสดี ครับ");
    expect(box).toHaveValue("");
  });

  it("does not send while an IME is composing, or an empty line", () => {
    const send = vi.fn();
    renderBox(send);
    const box = screen.getByRole("textbox", { name: "Chat message" });
    fireEvent.change(box, { target: { value: "にほん" } });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.compositionEnd(box);
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
  });

  it("shows nothing without a chat line, or without a game that takes one", () => {
    const { unmount } = renderBox(vi.fn(), false);
    expect(screen.queryByRole("textbox")).toBeNull();
    unmount();
    renderBox(null);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
