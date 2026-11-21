import { describe, expect, it, vi } from "vitest";
import { PM_MAX_BYTES, PmStore, splitText, stripIrcFormatting } from "./pm";

function store(nick: string | null = "Me") {
  let clock = 1000;
  const pm = new PmStore(() => clock++);
  const sent: string[] = [];
  pm.setTransport((line) => sent.push(line));
  pm.setNick(nick);
  pm.setOnline(true);
  return { pm, sent };
}

describe("incoming lines", () => {
  it("keeps a private line to the own nick from a player", () => {
    const { pm } = store();
    pm.handleIncoming(":Bob!bob@host PRIVMSG Me :hello");
    const snapshot = pm.getSnapshot();
    expect(snapshot.conversations.map((c) => c.nick)).toEqual(["Bob"]);
    expect(snapshot.conversations[0]?.messages).toEqual([
      { from: "them", text: "hello", at: expect.any(Number) },
    ]);
    expect(snapshot.unread).toBe(1);
  });

  it("leaves the server's lines to the game: NOTICE, PAGE and an operator's whispers", () => {
    const { pm } = store();
    pm.handleIncoming(":YuriBOT!bot@host NOTICE me :welcome");
    pm.handleIncoming(":YuriBOT!bot@host PAGE Me :announcement");
    // the lobby's NAMES marks the bot as an operator; its greeting and answers are not conversations
    pm.handleIncoming(":wol-ra2web 353 Me = #Lob_41_0 :@YuriBOT,0,0,0 Me,0,1,0 Bob,0,1,0");
    pm.handleIncoming(":YuriBOT!YuriBOT@local PRIVMSG Me :Welcome, Me!");
    expect(pm.getSnapshot().conversations).toEqual([]);
    expect(pm.getSnapshot().unread).toBe(0);
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :still here");
    expect(pm.getSnapshot().conversations.map((c) => c.nick)).toEqual(["Bob"]);
  });

  it("takes Thai text", () => {
    const { pm } = store();
    pm.handleIncoming(":Bob!bob@host PRIVMSG Me :สวัสดี 😀");
    expect(pm.getSnapshot().conversations[0]?.messages[0]?.text).toBe("สวัสดี 😀");
  });

  it("ignores channel lines, other nicks, the server's own notices and the own echo", () => {
    const { pm } = store();
    pm.handleIncoming(":Bob!bob@host PRIVMSG #lobby :hi all");
    pm.handleIncoming(":Bob!bob@host PRIVMSG Someone :not for me");
    pm.handleIncoming(":irc.server NOTICE Me :server text");
    pm.handleIncoming(":Me!me@host PRIVMSG Me :echo");
    pm.handleIncoming("PING :server");
    expect(pm.getSnapshot().conversations).toEqual([]);
  });

  it("matches nicks without regard to case and keeps one conversation", () => {
    const { pm } = store("MeNick");
    pm.handleIncoming(":Bob!b@h PRIVMSG menick :one");
    pm.handleIncoming(":BOB!b@h PRIVMSG MENICK :two");
    const { conversations } = pm.getSnapshot();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.messages.map((m) => m.text)).toEqual(["one", "two"]);
    expect(conversations[0]?.nick).toBe("BOB");
  });

  it("ignores everything while the own nick is unknown", () => {
    const { pm } = store(null);
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :hello");
    expect(pm.getSnapshot().conversations).toEqual([]);
  });

  it("strips colour codes and formatting", () => {
    expect(stripIrcFormatting("\u000304,01red\u0003 plain \u0002bold\u000f")).toBe(
      "red plain bold",
    );
    expect(stripIrcFormatting("\u00033green")).toBe("green");
    const { pm } = store();
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :\u000304Welcome\u0003 back");
    expect(pm.getSnapshot().conversations[0]?.messages[0]?.text).toBe("Welcome back");
  });

  it("shows an ACTION as a line", () => {
    const { pm } = store();
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :\u0001ACTION waves\u0001");
    expect(pm.getSnapshot().conversations[0]?.messages[0]?.text).toBe("* waves");
  });
});

describe("outgoing lines", () => {
  it("records a private line the game sent, and not a channel line", () => {
    const { pm } = store();
    pm.observeOutgoing("privmsg Bob :hi there");
    pm.observeOutgoing("PRIVMSG #lobby :to everyone");
    pm.observeOutgoing("join #lobby");
    const { conversations, unread } = pm.getSnapshot();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      nick: "Bob",
      unread: 0,
      messages: [{ from: "me", text: "hi there" }],
    });
    expect(unread).toBe(0);
  });

  it("does not count the panel's own line twice", () => {
    const { pm, sent } = store();
    // the loader reports each line the transport carries
    pm.setTransport((line) => {
      sent.push(line);
      pm.observeOutgoing(line);
    });
    expect(pm.send("Bob", "hello")).toEqual({ ok: true });
    expect(sent).toEqual(["privmsg Bob :hello"]);
    expect(pm.getSnapshot().conversations[0]?.messages).toHaveLength(1);
    // and a later line from the game counts again
    pm.observeOutgoing("privmsg Bob :again");
    expect(pm.getSnapshot().conversations[0]?.messages).toHaveLength(2);
  });
});

describe("send", () => {
  it("trims, builds the line and records it", () => {
    const { pm, sent } = store();
    expect(pm.send(" Bob ", "  hi  ")).toEqual({ ok: true });
    expect(sent).toEqual(["privmsg Bob :hi"]);
    expect(pm.getSnapshot().conversations[0]?.messages[0]).toMatchObject({
      from: "me",
      text: "hi",
    });
  });

  it.each([
    ["Bob", "", "Write something first."],
    ["Bob", "   ", "Write something first."],
    ["Bob", "a\nb", "A message is a single line."],
    ["Bob", "a\rb", "A message is a single line."],
    ["", "hi", "That is not a valid nick."],
    ["#lobby", "hi", "That is not a valid nick."],
    ["two words", "hi", "That is not a valid nick."],
    ["me", "hi", "You cannot message yourself."],
  ])("rejects %j / %j", (nick, text, reason) => {
    const { pm, sent } = store();
    expect(pm.send(nick, text)).toEqual({ ok: false, reason });
    expect(sent).toEqual([]);
    expect(pm.getSnapshot().conversations).toEqual([]);
  });

  it("rejects while offline", () => {
    const { pm, sent } = store();
    pm.setOnline(false);
    expect(pm.send("Bob", "hi")).toEqual({ ok: false, reason: "Not connected." });
    expect(sent).toEqual([]);
  });

  it("splits a long text over several lines of at most 400 bytes, never inside a character", () => {
    const { pm, sent } = store();
    const text = "สวัสดี ".repeat(120).trim();
    expect(pm.send("Bob", text)).toEqual({ ok: true });
    expect(sent.length).toBeGreaterThan(1);
    const encoder = new TextEncoder();
    for (const line of sent) {
      expect(line.startsWith("privmsg Bob :")).toBe(true);
      expect(encoder.encode(line.slice("privmsg Bob :".length)).length).toBeLessThanOrEqual(
        PM_MAX_BYTES,
      );
      expect(line).not.toContain("�");
    }
    expect(sent.map((line) => line.slice("privmsg Bob :".length)).join(" ")).toBe(text);
  });
});

describe("splitText", () => {
  it("leaves a short text alone and breaks at a space when it can", () => {
    expect(splitText("short")).toEqual(["short"]);
    expect(splitText("aaa bbb ccc", 8)).toEqual(["aaa bbb", "ccc"]);
  });

  it("cuts a word with no space and keeps an emoji whole", () => {
    expect(splitText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(splitText("😀😀😀", 8)).toEqual(["😀😀", "😀"]);
  });
});

describe("unread and the store", () => {
  it("counts incoming lines, clears on markRead and when we answer is not needed", () => {
    const { pm } = store();
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :1");
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :2");
    pm.handleIncoming(":Ann!a@h PRIVMSG Me :3");
    expect(pm.getSnapshot().unread).toBe(3);
    pm.markRead("bob");
    expect(pm.getSnapshot().unread).toBe(1);
    expect(pm.getSnapshot().conversations.find((c) => c.nick === "Bob")?.unread).toBe(0);
  });

  it("orders by latest activity and notifies subscribers, with a stable snapshot between changes", () => {
    const { pm } = store();
    const listener = vi.fn();
    const unsubscribe = pm.subscribe(listener);
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :1");
    pm.handleIncoming(":Ann!a@h PRIVMSG Me :2");
    expect(pm.getSnapshot().conversations.map((c) => c.nick)).toEqual(["Ann", "Bob"]);
    expect(listener).toHaveBeenCalledTimes(2);
    const before = pm.getSnapshot();
    expect(pm.getSnapshot()).toBe(before);
    pm.markRead("nobody");
    expect(pm.getSnapshot()).toBe(before);
    unsubscribe();
    pm.handleIncoming(":Cy!c@h PRIVMSG Me :3");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("opens an empty conversation for a nick", () => {
    const { pm } = store();
    expect(pm.open("Zed")).toEqual({ ok: true });
    expect(pm.open("bad nick")).toEqual({ ok: false, reason: "That is not a valid nick." });
    expect(pm.getSnapshot().conversations).toMatchObject([
      { nick: "Zed", messages: [], unread: 0 },
    ]);
  });

  it("keeps the conversations when the connection drops and returns", () => {
    const { pm } = store();
    pm.handleIncoming(":Bob!b@h PRIVMSG Me :1");
    pm.setOnline(false);
    expect(pm.getSnapshot().online).toBe(false);
    expect(pm.getSnapshot().conversations).toHaveLength(1);
  });
});
