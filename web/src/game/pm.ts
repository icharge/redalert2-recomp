/* eslint-disable no-control-regex */
/**
 * Private messages for the page's panel (PmPanel). The game and the page share one WOL
 * connection: every server line reaches both (loader.ts), and what the game sends
 * (`privmsg <nick> :text`, from a whisper, `/r` or the Page dialog) is seen here too, so
 * both sides show the same conversations. Memory only: a reload starts empty.
 */

export interface PmMessage {
  from: "me" | "them";
  text: string;
  /** milliseconds since the epoch */
  at: number;
}

export interface PmConversation {
  /** the nick as last seen (the key is its lower case) */
  nick: string;
  messages: readonly PmMessage[];
  unread: number;
}

export interface PmSnapshot {
  /** logged in to WOL: the panel can send */
  online: boolean;
  /** the own nick, once known */
  nick: string | null;
  /** most recent activity first */
  conversations: readonly PmConversation[];
  /** the sum of every conversation's unread */
  unread: number;
}

export type PmSendResult = { ok: true } | { ok: false; reason: string };

/** A line the server accepts holds 512 bytes with its prefix and command; keep well under. */
export const PM_MAX_BYTES = 400;
const MAX_MESSAGES = 500;
const MAX_CONVERSATIONS = 50;
const NICK = /^[^\s#&:,!@\u0000-\u001f]{1,32}$/;

/** IRC colour (0x03 + 1-2 digits, optionally ",NN") and the bold/underline/reverse/reset codes. */
export function stripIrcFormatting(text: string): string {
  return text
    .replace(/\u0003(?:\d{1,2}(?:,\d{1,2})?)?/g, "")
    .replace(/[\u0002\u000f\u0016\u001d\u001f]/g, "");
}

/** Splits `text` into pieces of at most `max` UTF-8 bytes, never inside a character, preferring a space. */
export function splitText(text: string, max = PM_MAX_BYTES): string[] {
  const encoder = new TextEncoder();
  const pieces: string[] = [];
  let rest = Array.from(text);
  while (rest.length > 0) {
    let bytes = 0;
    let take = 0;
    let lastSpace = -1;
    while (take < rest.length) {
      const size = encoder.encode(rest[take]).length;
      if (bytes + size > max) break;
      bytes += size;
      if (rest[take] === " ") lastSpace = take;
      take++;
    }
    // a break at a space, when it keeps at least half the piece
    if (take < rest.length && lastSpace >= take / 2) take = lastSpace + 1;
    const piece = rest.slice(0, take).join("").trim();
    if (piece) pieces.push(piece);
    rest = rest.slice(take);
  }
  return pieces;
}

const INCOMING = /^:([^\s!@]+)(?:!([^\s@]*))?(?:@(\S*))? (PRIVMSG|NOTICE|PAGE) (\S+) :(.*)$/i;
/** A NAMES reply (353): `:server 353 me = #chan :@bot,0,0,0 nick,0,1,0 ...`. */
const NAMES = /^:\S+ 353 \S+ \S+ \S+ :(.*)$/;
const OUTGOING = /^privmsg\s+(\S+)\s+:(.*)$/i;

/** The text of a CTCP ACTION (`/me`) as a line, or the text itself, without formatting codes. */
function plain(text: string): string {
  const action = /^\u0001ACTION (.*?)\u0001?$/.exec(text);
  return stripIrcFormatting(action ? `* ${action[1]}` : text.replace(/\u0001/g, "")).trim();
}

interface Conversation {
  nick: string;
  messages: PmMessage[];
  unread: number;
  last: number;
}

export class PmStore {
  private readonly now: () => number;
  private readonly conversations = new Map<string, Conversation>();
  private readonly listeners = new Set<() => void>();
  private nick: string | null = null;
  private online = false;
  /** Operators seen in a NAMES reply (`@name`): the lobby bot. Their lines stay in the game's chat. */
  private readonly operators = new Set<string>();
  private transport: ((line: string) => void) | null = null;
  /** true while send() hands its own line to the transport, which the loader also reports */
  private sending = false;
  private snapshot: PmSnapshot = { online: false, nick: null, conversations: [], unread: 0 };

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): PmSnapshot => this.snapshot;

  /** Where `send` puts its lines (the game's own send path). */
  setTransport(send: ((line: string) => void) | null): void {
    this.transport = send;
  }

  setNick(nick: string | null): void {
    if (nick === this.nick) return;
    this.nick = nick;
    this.emit();
  }

  setOnline(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    this.emit();
  }

  /** A line from the server. Only a private line to the own nick counts. */
  handleIncoming(line: string): void {
    const names = NAMES.exec(line);
    if (names) {
      for (const entry of (names[1] ?? "").split(" "))
        if (entry.startsWith("@")) this.operators.add(entry.slice(1).split(",")[0]!.toLowerCase());
      return;
    }
    const match = INCOMING.exec(line);
    if (!match || !this.nick) return;
    const [, from = "", user, host, command = "", target = "", raw = ""] = match;
    if (target.toLowerCase() !== this.nick.toLowerCase()) return;
    // Announcements (NOTICE, PAGE) and the bot's whispers (greetings, command answers) are the
    // server's, not a conversation: they stay in the game's chat and do not count as unread.
    if (command.toUpperCase() !== "PRIVMSG" || this.operators.has(from.toLowerCase())) return;
    // a bare server name (no user part) is not someone to answer
    if (user === undefined && host === undefined) return;
    if (from.toLowerCase() === this.nick.toLowerCase()) return;
    const text = plain(raw);
    if (!text) return;
    this.add(from, { from: "them", text, at: this.now() }, true);
    this.emit();
  }

  /** A line the game sent. `privmsg <nick> :text` to a person is a message of ours. */
  observeOutgoing(line: string): void {
    if (this.sending) return;
    const match = OUTGOING.exec(line.trim());
    if (!match) return;
    const [, target = "", raw = ""] = match;
    if (/^[#&]/.test(target)) return;
    const text = plain(raw);
    if (!text) return;
    this.add(target, { from: "me", text, at: this.now() }, false);
    this.emit();
  }

  /** Sends `text` to `nick` (as several lines when it is long). */
  send(nick: string, text: string): PmSendResult {
    const target = nick.trim();
    if (!NICK.test(target)) return { ok: false, reason: "That is not a valid nick." };
    if (this.nick && target.toLowerCase() === this.nick.toLowerCase())
      return { ok: false, reason: "You cannot message yourself." };
    if (/[\r\n\u0000]/.test(text)) return { ok: false, reason: "A message is a single line." };
    const body = text.trim();
    if (!body) return { ok: false, reason: "Write something first." };
    if (!this.online || !this.transport) return { ok: false, reason: "Not connected." };
    const at = this.now();
    this.sending = true;
    try {
      for (const piece of splitText(body)) {
        this.transport(`privmsg ${target} :${piece}`);
        this.add(target, { from: "me", text: piece, at }, false);
      }
    } finally {
      this.sending = false;
    }
    this.emit();
    return { ok: true };
  }

  /** Starts an empty conversation (a nick typed into the panel's new-message box). */
  open(nick: string): PmSendResult {
    const target = nick.trim();
    if (!NICK.test(target)) return { ok: false, reason: "That is not a valid nick." };
    const key = target.toLowerCase();
    if (!this.conversations.has(key)) {
      this.conversations.set(key, { nick: target, messages: [], unread: 0, last: this.now() });
      this.trim();
      this.emit();
    }
    return { ok: true };
  }

  markRead(nick: string): void {
    const conversation = this.conversations.get(nick.toLowerCase());
    if (!conversation || conversation.unread === 0) return;
    conversation.unread = 0;
    this.emit();
  }

  private add(nick: string, message: PmMessage, unread: boolean): void {
    const key = nick.toLowerCase();
    let conversation = this.conversations.get(key);
    if (!conversation) {
      conversation = { nick, messages: [], unread: 0, last: 0 };
      this.conversations.set(key, conversation);
    }
    conversation.nick = nick;
    conversation.messages.push(message);
    if (conversation.messages.length > MAX_MESSAGES)
      conversation.messages.splice(0, conversation.messages.length - MAX_MESSAGES);
    conversation.last = message.at;
    if (unread) conversation.unread++;
    this.trim();
  }

  private trim(): void {
    while (this.conversations.size > MAX_CONVERSATIONS) {
      let oldest: string | null = null;
      for (const [key, conversation] of this.conversations)
        if (oldest === null || conversation.last < this.conversations.get(oldest)!.last)
          oldest = key;
      this.conversations.delete(oldest!);
    }
  }

  private emit(): void {
    const conversations = [...this.conversations.values()]
      .sort((a, b) => b.last - a.last)
      .map((c) => ({ nick: c.nick, messages: [...c.messages], unread: c.unread }));
    this.snapshot = {
      online: this.online,
      nick: this.nick,
      conversations,
      unread: conversations.reduce((sum, c) => sum + c.unread, 0),
    };
    this.listeners.forEach((listener) => listener());
  }
}
