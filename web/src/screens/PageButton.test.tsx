import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { PageButton } from "./PageButton";

const presenter = {
  pictureRect: () => ({ x: 0, y: 0, width: 1, height: 1 }),
  gameSize: () => ({ width: 800, height: 600 }),
};
const page = { x: 680, y: 476, w: 162, h: 34 };

function renderButton(rect: typeof page, onOpen = vi.fn()) {
  const stage = createRef<HTMLDivElement>();
  const canvas = createRef<HTMLCanvasElement>();
  const moves = vi.fn();
  const result = render(
    <div ref={stage}>
      <canvas ref={canvas} onMouseMove={moves} />
      <PageButton
        rect={rect}
        label="Page (opens friends)"
        presenter={presenter}
        stage={stage}
        canvas={canvas}
        onOpen={onOpen}
      />
    </div>,
  );
  return { ...result, onOpen, moves };
}

describe("PageButton", () => {
  it("opens FRIENDS from over the game's button, and passes the mouse on to the game", () => {
    const { onOpen, moves } = renderButton(page);
    const button = screen.getByRole("button", { name: "Page (opens friends)" });
    fireEvent.mouseMove(button, { clientX: 700, clientY: 490 });
    expect(moves).toHaveBeenCalled();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("shows nothing on a screen without the button", () => {
    renderButton({ ...page, w: 0, h: 0 });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
