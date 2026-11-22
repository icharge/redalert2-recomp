import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PmStore } from "../game/pm";
import { PmPanel, PmTrayButton } from "./PmPanel";

function online() {
  let clock = 1000;
  const pm = new PmStore(() => clock++);
  const sent: string[] = [];
  pm.setTransport((line) => sent.push(line));
  pm.setNick("Me");
  pm.setOnline(true);
  return { pm, sent };
}

describe("PmPanel", () => {
  it("has MESSAGES and FRIENDS tabs, and shows a conversation's player's profile until BACK", async () => {
    const { pm } = online();
    pm.handleIncoming(":Ann!a@h PRIVMSG Me :hi");
    render(<PmPanel pm={pm} onClose={() => {}} sku={18688} />);
    expect(screen.getByRole("tab", { name: "MESSAGES" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: "PROFILE" }));
    expect(screen.getByRole("region", { name: "Profile of Ann" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "← BACK" }));
    expect(screen.getByRole("log", { name: "Conversation with Ann" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "FRIENDS" }));
    expect(screen.getByRole("tab", { name: "FRIENDS" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("opens on FRIENDS when asked for the tab (the game's Page and Buddy List)", () => {
    const { pm } = online();
    render(<PmPanel pm={pm} onClose={() => {}} focus={{ seq: 1, tab: "friends" }} />);
    expect(screen.getByRole("tab", { name: "FRIENDS" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows an invitation with JOIN", async () => {
    const { pm } = online();
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :\u0001INVITE Bob's_game\u0001");
    const onJoin = vi.fn();
    render(<PmPanel pm={pm} onClose={() => {}} onJoin={onJoin} />);
    expect(screen.getByRole("log", { name: "Conversation with Bob" })).toHaveTextContent(
      "invites you to their game Bob's_game",
    );
    await userEvent.click(screen.getByRole("button", { name: "JOIN" }));
    expect(onJoin).toHaveBeenCalledWith("Bob's_game");
  });

  it("offers no profile without a ladder to read it from", () => {
    const { pm } = online();
    pm.handleIncoming(":Ann!a@h PRIVMSG Me :hi");
    render(<PmPanel pm={pm} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "PROFILE" })).toBeNull();
  });

  it("lists the conversations and shows the thread of the one with something new", () => {
    const { pm } = online();
    pm.handleIncoming(":Ann!a@h PRIVMSG Me :older");
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :สวัสดี");
    pm.markRead("ann");
    render(<PmPanel pm={pm} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /Ann/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bob/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("log", { name: "Conversation with Bob" })).toHaveTextContent("สวัสดี");
  });

  it("clears the unread count of what is on screen when it opens, and keeps the others", async () => {
    const { pm } = online();
    pm.handleIncoming(":Ann!a@h PRIVMSG Me :1");
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :2");
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :3");
    expect(pm.getSnapshot().unread).toBe(3);
    render(<PmPanel pm={pm} onClose={() => {}} />);
    // Bob is the latest: shown and read; Ann keeps hers and stays selected-by-choice only
    expect(pm.getSnapshot().unread).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: /Ann/ }));
    expect(pm.getSnapshot().unread).toBe(0);
  });

  it("shows a message that arrives while it is open, already read", () => {
    const { pm } = online();
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :first");
    render(<PmPanel pm={pm} onClose={() => {}} />);
    act(() => pm.handleIncoming(":Bob!b@h PRIVMSG Me :second"));
    expect(screen.getByRole("log")).toHaveTextContent("second");
    expect(pm.getSnapshot().unread).toBe(0);
  });

  it("sends with Enter and shows the line as ours", async () => {
    const { pm, sent } = online();
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :hi");
    render(<PmPanel pm={pm} onClose={() => {}} />);
    const field = screen.getByRole("textbox", { name: "Message to Bob" });
    expect(field).toHaveFocus();
    await userEvent.type(field, "hello Bob{Enter}");
    expect(sent).toEqual(["privmsg Bob :hello Bob"]);
    expect(field).toHaveValue("");
    expect(screen.getByRole("log")).toHaveTextContent("You");
    expect(screen.getByRole("log")).toHaveTextContent("hello Bob");
  });

  it("starts a conversation with a nick", async () => {
    const { pm, sent } = online();
    render(<PmPanel pm={pm} onClose={() => {}} />);
    await userEvent.type(screen.getByRole("textbox", { name: "New message to" }), "Zed");
    await userEvent.click(screen.getByRole("button", { name: "NEW" }));
    const field = screen.getByRole("textbox", { name: "Message to Zed" });
    await userEvent.type(field, "psst{Enter}");
    expect(sent).toEqual(["privmsg Zed :psst"]);
  });

  it("says why a message was refused", async () => {
    const { pm } = online();
    render(<PmPanel pm={pm} onClose={() => {}} />);
    await userEvent.type(screen.getByRole("textbox", { name: "New message to" }), "bad#nick");
    await userEvent.click(screen.getByRole("button", { name: "NEW" }));
    expect(screen.getByRole("alert")).toHaveTextContent("not a valid nick");
  });

  it("closes with Escape and with the close button, and keeps its keys from the game", async () => {
    const { pm } = online();
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :hi");
    const onClose = vi.fn();
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<PmPanel pm={pm} onClose={onClose} />);
    await userEvent.keyboard("abc");
    expect(onWindowKey).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Close messages" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    window.removeEventListener("keydown", onWindowKey);
  });

  it("cannot send while offline", () => {
    const { pm } = online();
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :hi");
    pm.setOnline(false);
    render(<PmPanel pm={pm} onClose={() => {}} />);
    expect(screen.getByText("NOT CONNECTED")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message to Bob" })).toBeDisabled();
  });
});

describe("PmTrayButton", () => {
  it("shows only while online, with the total unread", () => {
    const { pm } = online();
    pm.setOnline(false);
    const { container } = render(<PmTrayButton pm={pm} open={false} onToggle={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    act(() => pm.setOnline(true));
    expect(screen.getByRole("button", { name: "Messages" })).toBeInTheDocument();
    act(() => {
      pm.handleIncoming(":Bob!b@h PRIVMSG Me :1");
      pm.handleIncoming(":Ann!a@h PRIVMSG Me :2");
    });
    expect(screen.getByRole("button", { name: "Messages, 2 unread" })).toHaveTextContent("2");
    act(() => pm.markRead("bob"));
    expect(screen.getByRole("button", { name: "Messages, 1 unread" })).toBeInTheDocument();
  });

  it("toggles", async () => {
    const { pm } = online();
    const onToggle = vi.fn();
    render(<PmTrayButton pm={pm} open={true} onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: "Messages" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
