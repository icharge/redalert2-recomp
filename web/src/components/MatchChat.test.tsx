import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameStore, type MatchChatLine } from "../game/store";
import {
  MATCH_CHAT_FADE_MS,
  MatchChat,
  Target,
  gameText,
  lineTime,
  panelAnchor,
  playerColour,
} from "./MatchChat";

const line = (id: number, over: Partial<MatchChatLine> = {}): MatchChatLine => ({
  id,
  name: "alice",
  text: "hello",
  colour: 1,
  own: false,
  to: 0,
  at: 1000,
  ...over,
});

describe("gameText", () => {
  it("reads widened Windows-874 as Thai with the Thai font, and leaves it without", () => {
    const widened = "ÊÇÑÊ´Õ"; // สวัสดี as the game keeps it
    expect(gameText(`hi ${widened}`, true)).toBe("hi สวัสดี");
    expect(gameText(widened, false)).toBe(widened);
  });
});

describe("lineTime", () => {
  it("is the local hours and minutes, two digits each", () => {
    expect(lineTime(new Date(2026, 10, 22, 9, 5).getTime())).toBe("09:05");
    expect(lineTime(new Date(2026, 10, 22, 14, 30).getTime())).toBe("14:30");
  });
});

describe("playerColour", () => {
  it("has the eight multiplayer colours and a grey for anything else", () => {
    expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map(playerColour)).size).toBe(8);
    expect(playerColour(42)).toBe("#d8d8d8");
  });
});

describe("panelAnchor", () => {
  it("sits on the picture's bottom left corner, above the command bar", () => {
    // a 1280x748 picture at 1x at the top of a 1280x960 canvas that fills the stage
    const at = panelAnchor(
      { left: 0, top: 0, width: 1280, height: 960 },
      { left: 0, top: 0, height: 960 },
      { x: 0, y: 0, width: 1, height: 748 / 960 },
      { width: 1280, height: 748 },
    );
    expect(at.left).toBeCloseTo(8);
    expect(at.bottom).toBeCloseTo(960 - 748 + 24 + 4);
  });
});

describe("MatchChat", () => {
  it("shows each line with its sender in the player's colour", () => {
    render(
      <MatchChat
        chat={{ ready: true, lines: [line(1), line(2, { name: "bob", colour: 2, text: "gg" })] }}
        typing={false}
        onTyping={() => {}}
        thai={false}
        send={vi.fn()}
        now={() => 2000}
      />,
    );
    const bob = screen.getByText("bob:");
    expect(bob).toHaveStyle({ color: playerColour(2) });
    expect(screen.getByText("gg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /press Enter to chat/ })).toBeInTheDocument();
  });

  it("starts each line with its time, unless chat times are off", () => {
    const at = new Date(2026, 10, 22, 21, 7).getTime();
    const chat = {
      ready: false,
      lines: [line(1, { at }), line(2, { at, system: true, name: "", text: "Objective" })],
    };
    const props = {
      chat,
      typing: false,
      onTyping: () => {},
      thai: false,
      send: null,
      now: () => at,
    };
    const { unmount } = render(<MatchChat {...props} times />);
    expect(screen.getAllByText("21:07")).toHaveLength(2);
    unmount();
    render(<MatchChat {...props} times={false} />);
    expect(screen.queryByText("21:07")).toBeNull();
  });

  it("lets old lines fade while it is closed", () => {
    render(
      <MatchChat
        chat={{ ready: false, lines: [line(1)] }}
        typing={false}
        onTyping={() => {}}
        thai={false}
        send={vi.fn()}
        now={() => 1000 + MATCH_CHAT_FADE_MS + 1}
      />,
    );
    expect(screen.queryByText("hello")).toBeNull();
  });

  it("sends to everyone on Enter, to allies after Tab, and closes", () => {
    const send = vi.fn();
    const onTyping = vi.fn();
    const { rerender } = render(
      <MatchChat
        chat={{ ready: true, lines: [] }}
        typing
        onTyping={onTyping}
        thai={false}
        send={send}
      />,
    );
    let box = screen.getByRole("textbox", { name: "Message to all" });
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: " attack now " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).toHaveBeenLastCalledWith("attack now", Target.all);
    expect(onTyping).toHaveBeenLastCalledWith(false);

    rerender(
      <MatchChat
        chat={{ ready: true, lines: [] }}
        typing
        onTyping={onTyping}
        thai={false}
        send={send}
      />,
    );
    box = screen.getByRole("textbox", { name: "Message to all" });
    fireEvent.keyDown(box, { key: "Tab" });
    box = screen.getByRole("textbox", { name: "Message to allies" });
    fireEvent.change(box, { target: { value: "help" } });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
    fireEvent.compositionEnd(box);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).toHaveBeenLastCalledWith("help", Target.allies);
  });

  it("closes on Escape without sending", () => {
    const send = vi.fn();
    const onTyping = vi.fn();
    render(
      <MatchChat
        chat={{ ready: true, lines: [] }}
        typing
        onTyping={onTyping}
        thai={false}
        send={send}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Message to all" });
    fireEvent.change(box, { target: { value: "nope" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(send).not.toHaveBeenCalled();
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });

  it("shows the game's messages read-only outside a LAN or online match", () => {
    render(
      <MatchChat
        chat={{
          ready: false,
          lines: [line(1, { system: true, name: "", text: "Mission objective: hold the base" })],
        }}
        typing={false}
        onTyping={() => {}}
        thai={false}
        send={vi.fn()}
        now={() => 2000}
      />,
    );
    expect(screen.getByText("Mission objective: hold the base")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /press Enter to chat/ })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens the whole history from its tab, and keeps it open until clicked again", () => {
    render(
      <MatchChat
        chat={{ ready: false, lines: [line(1, { system: true, name: "", text: "old row" })] }}
        typing={false}
        onTyping={() => {}}
        thai={false}
        send={null}
        now={() => 1000 + MATCH_CHAT_FADE_MS + 1}
      />,
    );
    expect(screen.queryByText("old row")).toBeNull();
    const tab = screen.getByRole("button", { name: "Messages" });
    expect(tab).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(tab);
    expect(screen.getByText("old row")).toBeInTheDocument();
    expect(tab).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(tab);
    expect(screen.queryByText("old row")).toBeNull();
  });

  it("shows nothing outside a LAN or online match with no lines", () => {
    const { container } = render(
      <MatchChat
        chat={{ ready: false, lines: [] }}
        typing={false}
        onTyping={() => {}}
        thai={false}
        send={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("GameStore match chat", () => {
  it("keeps the lines across matches", () => {
    const store = new GameStore();
    store.apply({ e: "matchChatReady", on: true });
    store.apply({ e: "matchChat", name: "a", text: "one", colour: 0, own: false, to: 0 });
    store.apply({ e: "matchChat", name: "me", text: "two", colour: 3, own: true, to: 2 });
    expect(store.getSnapshot().matchChat.lines.map((l) => [l.id, l.text, l.to])).toEqual([
      [1, "one", 0],
      [2, "two", 2],
    ]);
    store.apply({ e: "matchMessage", text: "Player defeated", scheme: 5, style: 0x16 });
    expect(store.getSnapshot().matchChat.lines.at(-1)).toMatchObject({
      id: 3,
      system: true,
      text: "Player defeated",
    });
    store.apply({ e: "matchChatReady", on: false });
    expect(store.getSnapshot().matchChat).toMatchObject({ ready: false });
    expect(store.getSnapshot().matchChat.lines).toHaveLength(3);
    store.apply({ e: "matchChatReady", on: true });
    expect(store.getSnapshot().matchChat.ready).toBe(true);
    expect(store.getSnapshot().matchChat.lines).toHaveLength(3);
  });
});
