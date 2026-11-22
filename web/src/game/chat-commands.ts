/**
 * Short forms of the game's chat commands, typed into the page's chat boxes (ChatBox, MatchChat).
 * The game itself reads the long form (`/page <name> <text>`, YR 0x0078A6B0, RA2 0x00746480), so a
 * line is rewritten before it is handed over. `/r` and `/reply` become `/page <the last player who
 * whispered>` when the page knows one (PmStore's lastFrom).
 */
const ALIASES: Record<string, string> = {
  p: "page",
  m: "page",
  msg: "page",
  pm: "page",
};

/**
 * The line with a short command written out: "/p bob hi", "/m bob hi", "/msg bob hi" and "/pm bob hi"
 * are all "/page bob hi", a private message to bob. Anything else as it is.
 */
export function expandChatCommand(line: string, replyTo: string | null = null): string {
  const match = /^\/(\S+)(\s|$)/.exec(line);
  const command = match?.[1]?.toLowerCase();
  const rest = match ? line.slice(1 + match[1]!.length) : "";
  // /r and /reply answer the last player who whispered: "/page <them> text", so it does not depend on
  // the game's own reply name. With nobody to answer the line goes to the game as typed.
  if ((command === "r" || command === "reply") && replyTo) return `/page ${replyTo}${rest}`;
  const long = command ? ALIASES[command] : undefined;
  return long ? `/${long}${rest}` : line;
}

/** What the chat boxes say when /r has nobody to answer, instead of sending the line. */
export const NO_REPLY_HINT = "No one has messaged you yet. Use /pm name message.";

/** /r or /reply with nobody to answer: the boxes keep the line and show NO_REPLY_HINT. */
export function replyWithoutTarget(line: string, replyTo: string | null): boolean {
  return !replyTo && /^\/(r|reply)(\s|$)/i.test(line);
}
