import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameStore, type MatchChatLine } from "../game/store";
import {
  MATCH_CHAT_FADE_MS,
  MATCH_CHAT_IDLE_MS,
  MatchChat,
  Target,
  gameText,
  lineTime,
  panelAnchor,
  playerColour,
  lineLimit,
  resolveTarget,
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

describe("resolveTarget", () => {
  it("opens Enter to the remembered target, and Backspace and backslash to theirs", () => {
    expect(resolveTarget(Target.chat, Target.all)).toBe(Target.all);
    expect(resolveTarget(Target.chat, Target.allies)).toBe(Target.allies);
    expect(resolveTarget(Target.allies, Target.all)).toBe(Target.allies);
    expect(resolveTarget(Target.all, Target.allies)).toBe(Target.all);
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
        typing={null}
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
      typing: null,
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
        typing={null}
        onTyping={() => {}}
        thai={false}
        send={vi.fn()}
        now={() => 1000 + MATCH_CHAT_FADE_MS + 1}
      />,
    );
    expect(screen.queryByText("hello")).toBeNull();
  });

  it("opens to the target the game's key chose; Tab switches All and Allies and is remembered", () => {
    const send = vi.fn();
    const onTyping = vi.fn();
    const onTarget = vi.fn();
    const props = { chat: { ready: true, lines: [] }, onTyping, onTarget, thai: false, send };
    const { rerender } = render(<MatchChat {...props} typing={Target.all} />);
    let box = screen.getByRole("textbox", { name: "Message to all" });
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: " attack now " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).toHaveBeenLastCalledWith("attack now", Target.all);
    expect(onTarget).toHaveBeenLastCalledWith(Target.all);
    expect(onTyping).toHaveBeenLastCalledWith(null);

    rerender(<MatchChat {...props} typing={Target.all} />);
    box = screen.getByRole("textbox", { name: "Message to all" });
    fireEvent.keyDown(box, { key: "Tab" });
    expect(onTarget).toHaveBeenLastCalledWith(Target.allies);
    box = screen.getByRole("textbox", { name: "Message to allies" });
    fireEvent.change(box, { target: { value: "help" } });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
    fireEvent.compositionEnd(box);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).toHaveBeenLastCalledWith("help", Target.allies);
    fireEvent.keyDown(box, { key: "Tab" });
    expect(screen.getByRole("textbox", { name: "Message to all" })).toBeInTheDocument();
  });

  it("shows the remembered target on its prompt and opens to it, as Enter does", () => {
    const onTyping = vi.fn();
    render(
      <MatchChat
        chat={{ ready: true, lines: [] }}
        typing={null}
        onTyping={onTyping}
        remembered={Target.allies}
        thai={false}
        send={vi.fn()}
      />,
    );
    const prompt = screen.getByRole("button", { name: /press Enter to chat/ });
    expect(prompt).toHaveTextContent("[Allies] (press Enter to chat)");
    fireEvent.click(prompt);
    expect(onTyping).toHaveBeenLastCalledWith(Target.allies);
  });

  it("answers /r to the last whisperer, or tells the player to use /pm", () => {
    const send = vi.fn();
    const onTyping = vi.fn();
    const onHint = vi.fn();
    const props = { chat: { ready: true, lines: [] }, onTyping, onHint, thai: false, send };
    const { rerender } = render(<MatchChat {...props} typing={Target.all} />);
    let box = screen.getByRole("textbox", { name: "Message to all" });
    fireEvent.change(box, { target: { value: "/r gg" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
    expect(onTyping).not.toHaveBeenCalled();
    expect(onHint).toHaveBeenCalledWith(expect.stringContaining("No one has messaged you yet"));
    expect(box).toHaveValue("/r gg");

    rerender(<MatchChat {...props} typing={Target.all} replyTo="Ann" />);
    box = screen.getByRole("textbox", { name: "Message to all" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).toHaveBeenCalledWith("/page Ann gg", Target.all);
  });

  it("closes on Escape without sending", () => {
    const send = vi.fn();
    const onTyping = vi.fn();
    render(
      <MatchChat
        chat={{ ready: true, lines: [] }}
        typing={Target.all}
        onTyping={onTyping}
        thai={false}
        send={send}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Message to all" });
    fireEvent.change(box, { target: { value: "nope" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(send).not.toHaveBeenCalled();
    expect(onTyping).toHaveBeenLastCalledWith(null);
  });

  it("shows the game's messages read-only outside a LAN or online match", () => {
    render(
      <MatchChat
        chat={{
          ready: false,
          lines: [line(1, { system: true, name: "", text: "Mission objective: hold the base" })],
        }}
        typing={null}
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
        typing={null}
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

  it("sorts the history into All, Allies, PM and System tabs, marking a tab with something new", () => {
    const lines = [
      line(1, { text: "to all", to: Target.all }),
      line(2, { text: "to allies", to: Target.allies }),
      line(3, { system: true, name: "", text: "(bob) psst", pm: true }),
      line(4, { system: true, name: "", text: "Objective" }),
    ];
    render(
      <MatchChat
        chat={{ ready: true, lines }}
        typing={null}
        onTyping={() => {}}
        thai={false}
        send={vi.fn()}
        now={() => 1000}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    const shown = () =>
      screen.getAllByRole("listitem").map((item) => item.textContent?.replace(/^\d\d:\d\d /, ""));
    // All is the players' talk and whispers; the game's rows are under System only
    expect(shown()).toEqual(["alice: to all", "[Allies] alice: to allies", "(bob) psst"]);
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    // nothing seen yet under the other tabs
    expect(screen.getByRole("tab", { name: "PM" })).toHaveAttribute("data-new");
    fireEvent.click(screen.getByRole("tab", { name: "Allies" }));
    expect(shown()).toEqual(["[Allies] alice: to allies"]);
    fireEvent.click(screen.getByRole("tab", { name: "PM" }));
    expect(shown()).toEqual(["(bob) psst"]);
    expect(screen.getByRole("tab", { name: "Allies" })).not.toHaveAttribute("data-new");
    fireEvent.click(screen.getByRole("tab", { name: "System" }));
    expect(shown()).toEqual(["Objective"]);
  });

  it("hides altogether a while after its last line went, until it is used again", () => {
    let at = 1000;
    const props = {
      chat: { ready: true, lines: [line(1)] },
      onTyping: () => {},
      thai: false,
      send: vi.fn(),
      now: () => at,
    };
    const { rerender } = render(<MatchChat {...props} typing={null} />);
    const panel = screen.getByRole("region", { name: "Match chat" });
    expect(panel).not.toHaveAttribute("data-idle");
    at = 1000 + MATCH_CHAT_FADE_MS + 1; // the line has gone; the row stays a while after it
    rerender(<MatchChat {...props} typing={null} />);
    expect(panel).not.toHaveAttribute("data-idle");
    at = 1000 + MATCH_CHAT_FADE_MS + MATCH_CHAT_IDLE_MS;
    rerender(<MatchChat {...props} typing={null} />);
    expect(panel).toHaveAttribute("data-idle");
    rerender(<MatchChat {...props} typing={Target.all} />);
    expect(screen.getByRole("region", { name: "Match chat" })).not.toHaveAttribute("data-idle");
  });

  it("whispers to the player /r or /p names, until Tab or the game's keys leave them", () => {
    const send = vi.fn();
    const onWhisper = vi.fn();
    const onTarget = vi.fn();
    const props = {
      chat: { ready: true, lines: [] },
      onTyping: () => {},
      onWhisper,
      onTarget,
      thai: false,
      send,
      whispers: true,
      replyTo: "Ann",
    };
    const { rerender } = render(<MatchChat {...props} typing={Target.all} />);
    let box = screen.getByRole("textbox", { name: "Message to all" });
    fireEvent.change(box, { target: { value: "/r " } });
    expect(onWhisper).toHaveBeenLastCalledWith("Ann");
    box = screen.getByRole("textbox", { name: "Message to Ann" });
    expect(box).toHaveValue("");
    expect(screen.getByRole("button", { name: "[Ann]" })).toHaveAttribute("data-pm");
    fireEvent.change(box, { target: { value: "on my way" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).toHaveBeenLastCalledWith("/page Ann on my way", Target.all);
    expect(onTarget).not.toHaveBeenCalled();

    // the caller keeps the whisper: the next line opens to Ann again
    rerender(<MatchChat {...props} typing={null} whisper="Ann" />);
    expect(screen.getByRole("button", { name: /press Enter to chat/ })).toHaveTextContent(
      "[Ann] (press Enter to chat)",
    );
    rerender(<MatchChat {...props} typing={Target.all} whisper="Ann" />);
    box = screen.getByRole("textbox", { name: "Message to Ann" });
    // a command still goes as typed
    fireEvent.change(box, { target: { value: "/p Bob hi there" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).toHaveBeenLastCalledWith("/page Bob hi there", Target.all);
    expect(onWhisper).toHaveBeenLastCalledWith("Bob");

    rerender(<MatchChat {...props} typing={null} whisper="Bob" />);
    rerender(<MatchChat {...props} typing={Target.all} whisper="Bob" />);
    box = screen.getByRole("textbox", { name: "Message to Bob" });
    expect(box).toHaveAttribute("maxLength", String(lineLimit("Bob")));
    // Tab: from the player back to All, then Allies, then the player again
    fireEvent.keyDown(box, { key: "Tab" });
    expect(onWhisper).toHaveBeenLastCalledWith(null);
    box = screen.getByRole("textbox", { name: "Message to all" });
    fireEvent.keyDown(box, { key: "Tab" });
    box = screen.getByRole("textbox", { name: "Message to allies" });
    fireEvent.keyDown(box, { key: "Tab" });
    expect(screen.getByRole("textbox", { name: "Message to Bob" })).toBeInTheDocument();
  });

  it("leaves /r and /p alone where pages reach nobody (a LAN match)", () => {
    const send = vi.fn();
    render(
      <MatchChat
        chat={{ ready: true, lines: [] }}
        typing={Target.all}
        onTyping={() => {}}
        thai={false}
        send={send}
        replyTo="Ann"
      />,
    );
    const box = screen.getByRole("textbox", { name: "Message to all" });
    fireEvent.change(box, { target: { value: "/p bob " } });
    expect(box).toHaveValue("/p bob ");
    expect(screen.getByRole("textbox", { name: "Message to all" })).toBeInTheDocument();
  });

  it("keeps a page's line inside the packet", () => {
    expect(lineLimit(null)).toBe(97);
    expect(lineLimit("Bob")).toBe(97);
    expect(lineLimit("LongName9")).toBe(95);
  });

  it("shows nothing outside a LAN or online match with no lines", () => {
    const { container } = render(
      <MatchChat
        chat={{ ready: false, lines: [] }}
        typing={null}
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
    store.apply({ e: "matchChatOpen", to: 2 });
    expect(store.getSnapshot().matchChat.open).toEqual({ seq: 1, to: 2 });
    store.apply({ e: "matchChatReady", on: false });
    expect(store.getSnapshot().matchChat).toMatchObject({ ready: false });
    expect(store.getSnapshot().matchChat.lines).toHaveLength(3);
    store.apply({ e: "matchChatReady", on: true });
    expect(store.getSnapshot().matchChat.ready).toBe(true);
    expect(store.getSnapshot().matchChat.lines).toHaveLength(3);
  });
});
