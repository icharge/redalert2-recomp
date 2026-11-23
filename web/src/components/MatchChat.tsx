import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { GamePresenter, PictureRect } from "../game/presenter";
import {
  NO_REPLY_HINT,
  expandChatCommand,
  pageOf,
  replyWithoutTarget,
  whisperTarget,
} from "../game/chat-commands";
import type { MatchChat as MatchChatState, MatchChatLine } from "../game/store";
import { readChatTimePreference } from "../storage/chat-time-preferences";
import styles from "./MatchChat.module.css";

/** The game's own line takes 97 typed characters; the packet holds 111 (docs/web/match-chat.md). */
export const MATCH_CHAT_MAX_LENGTH = 97;
/** How long a line stays on the battlefield while the panel is not in use. */
export const MATCH_CHAT_FADE_MS = 20_000;
/** How long the closed panel's bottom row stays after its last line went or it was last used. */
export const MATCH_CHAT_IDLE_MS = 6_000;
/** The packet's text holds 111 units (docs/web/match-chat.md): a page's "/page name " counts too. */
const PACKET_UNITS = 111;

/** How much a line to type may hold: less to a player, whose "/page name " goes with it. */
export function lineLimit(whisper: string | null): number {
  return whisper
    ? Math.min(MATCH_CHAT_MAX_LENGTH, PACKET_UNITS - 7 - whisper.length)
    : MATCH_CHAT_MAX_LENGTH;
}

/**
 * Who a line goes to: the game's chat targets. Its keys pick them: Enter the players ticked under
 * Chat in Diplomacy (everyone at first), Backspace allies, \ everyone.
 */
export const Target = { chat: 1, allies: 2, all: 3 } as const;
export type Target = (typeof Target)[keyof typeof Target];

/**
 * The multiplayer colours by the game's colour index (the setup screen's order: gold, red, blue,
 * green, orange, sky, purple, pink), lightened a little to read on the dark panel.
 */
const PLAYER_COLOURS = [
  "#f4dc4c",
  "#ff5a50",
  "#6a9cff",
  "#5fd35a",
  "#ffa64d",
  "#5ed6e0",
  "#b47cff",
  "#ff8fd2",
];

export function playerColour(index: number): string {
  return PLAYER_COLOURS[index] ?? "#d8d8d8";
}

/** The game's command bar along the picture's bottom edge, in game pixels: the panel sits above it. */
const COMMAND_BAR = 24;

interface Anchor {
  left: number;
  bottom: number;
}

/**
 * Where the panel's bottom left corner goes in the stage: over the picture's bottom left corner,
 * above the game's command bar.
 */
export function panelAnchor(
  canvas: { left: number; top: number; width: number; height: number },
  stage: { left: number; top: number; height: number },
  picture: PictureRect,
  game: { width: number; height: number },
): Anchor {
  const scale = (canvas.height * picture.height) / game.height;
  const pictureBottom = canvas.top - stage.top + canvas.height * (picture.y + picture.height);
  return {
    left: canvas.left - stage.left + canvas.width * picture.x + 8,
    bottom: stage.height - pictureBottom + COMMAND_BAR * scale + 4,
  };
}

/** Follows the picture each frame while the panel shows. */
function useAnchor(
  presenter: Pick<GamePresenter, "pictureRect" | "gameSize"> | undefined,
  stage: RefObject<HTMLElement | null> | undefined,
  canvas: RefObject<HTMLCanvasElement | null> | undefined,
): Anchor | null {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  useEffect(() => {
    if (!presenter || !stage || !canvas) return;
    let frame = 0;
    const follow = () => {
      const stageRect = stage.current?.getBoundingClientRect();
      const canvasRect = canvas.current?.getBoundingClientRect();
      const game = presenter.gameSize();
      if (stageRect && canvasRect && game.width > 0 && game.height > 0 && canvasRect.height > 0) {
        const next = panelAnchor(canvasRect, stageRect, presenter.pictureRect(), game);
        setAnchor((last) =>
          last && last.left === next.left && last.bottom === next.bottom ? last : next,
        );
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [presenter, stage, canvas]);
  return anchor;
}

function targetLabel(target: Target): string {
  return target === Target.allies ? "Allies" : target === Target.all ? "All" : "Chat";
}

/** Tab switches between everyone and allies. */
function nextTarget(target: Target): Target {
  return target === Target.all ? Target.allies : Target.all;
}

/** What the prompt says the line goes to: a player's name when it whispers. */
function toLabel(target: Target, whisper: string | null): string {
  return whisper ?? targetLabel(target);
}

/**
 * Where a line the game's key asked for goes: Enter (the game's "Chat" target) opens to the one the
 * player used last in this match, everyone at first; Backspace and \ open to allies and to everyone.
 */
export function resolveTarget(requested: number, remembered: Target): Target {
  return requested === Target.allies || requested === Target.all ? requested : remembered;
}

/** The local time of a line, as the lobby's chat shows it: "14:05". */
export function lineTime(at: number): string {
  const time = new Date(at);
  return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
}

/** The panel's log tabs: the players' lines and whispers, lines to allies, whispers, the game's rows. */
export const LOG_TABS = ["all", "allies", "pm", "system"] as const;
export type LogTab = (typeof LOG_TABS)[number];
const TAB_LABELS: Record<LogTab, string> = {
  all: "All",
  allies: "Allies",
  pm: "PM",
  system: "System",
};

/**
 * Whether a line shows under a tab. A player's line to allies is known for the player's own lines
 * and for lines from players on this build (match_chat.c tags them); others count as to everyone.
 * All is the players' talk (the game's rows are under System), except where nobody talks: outside
 * a LAN or online match the game's rows are all there is.
 */
export function inTab(line: MatchChatLine, tab: LogTab, talk = true): boolean {
  switch (tab) {
    case "all":
      return !talk || !line.system || !!line.pm;
    case "allies":
      return !line.system && line.to === Target.allies;
    case "pm":
      return !!line.pm;
    case "system":
      return !!line.system && !line.pm;
  }
}

function Time({ at, on }: { at: number; on: boolean }) {
  return on ? <span className={styles.time}>{lineTime(at)} </span> : null;
}

function Line({ line, times }: { line: MatchChatLine; times: boolean }) {
  if (line.system)
    return (
      <li className={styles.line}>
        <Time at={line.at} on={times} />
        <span className={line.pm ? styles.pm : styles.system}>{line.text}</span>
      </li>
    );
  return (
    <li className={styles.line}>
      <Time at={line.at} on={times} />
      {line.to === Target.allies && <span className={styles.to}>[Allies] </span>}
      <span className={styles.name} style={{ color: playerColour(line.colour) }}>
        {line.name}:
      </span>{" "}
      <span className={styles.text}>{line.text}</span>
    </li>
  );
}

/**
 * The page's message panel for a match (src/web/match_chat.c): the game's own messages (mission
 * text, a player defeated, pages) in every match, and in a LAN or online match the players' lines
 * with their colours and a line to type into that the game sends as its own chat. Enter (from the
 * game) opens that line, Enter sends, Escape closes, Tab switches between everyone and allies.
 * Closed, only its tab takes the mouse and lines fade after a while; pointing at it (or clicking its
 * tab, which keeps it open) shows the whole history.
 */
export function MatchChat({
  chat,
  typing,
  onTyping,
  remembered = Target.all,
  onTarget,
  replyTo = null,
  whisper: whisperProp = null,
  onWhisper,
  whispers = false,
  onHint,
  send,
  now = Date.now,
  times = readChatTimePreference(),
  presenter,
  stage,
  canvas,
}: {
  chat: MatchChatState;
  /** the line to type into is open, to that target (the key the game took: MatchChatOpen) */
  typing: Target | null;
  onTyping: (typing: Target | null) => void;
  /** the target Enter opens to (the last one used in this match), shown on the prompt */
  remembered?: Target;
  /** the player switched the target (Tab, or the label) or sent a line to it */
  onTarget?: (target: Target) => void;
  /** the last player who whispered: where /r goes (PmStore's lastFrom) */
  replyTo?: string | null;
  /** the player the line whispers to (after a /r or /p), kept by the caller for the next Enter */
  whisper?: string | null;
  onWhisper?: (name: string | null) => void;
  /** pages reach someone (online, not LAN): /r and /p make the line whisper to that player */
  whispers?: boolean;
  /** a line for the player only (the chat log): /r with nobody to answer */
  onHint?: (text: string) => void;
  send: ((text: string, target: Target) => void) | null;
  now?: () => number;
  /** each line starts with its local time (Settings › Launcher › ONLINE › Chat times) */
  times?: boolean;
  /** with these, the panel sits on the game's picture rather than the stage's corner */
  presenter?: Pick<GamePresenter, "pictureRect" | "gameSize">;
  stage?: RefObject<HTMLElement | null>;
  canvas?: RefObject<HTMLCanvasElement | null>;
}) {
  const anchor = useAnchor(presenter, stage, canvas);
  const [text, setText] = useState("");
  const [target, setTargetState] = useState<Target>(typing ?? remembered);
  const setTarget = (next: Target) => {
    setTargetState(next);
    onTarget?.(next);
  };
  const [whisper, setWhisperState] = useState<string | null>(whispers ? whisperProp : null);
  /** the last player whispered to: Tab goes to them after All and Allies */
  const lastWhisper = useRef<string | null>(whisperProp);
  const setWhisper = (name: string | null) => {
    if (name) lastWhisper.current = name;
    setWhisperState(name);
    onWhisper?.(name);
  };
  const [hover, setHover] = useState(false);
  const [tab, setTab] = useState<LogTab>("all");
  /** the newest line id seen under each tab: a tab with newer lines is marked */
  const [seen, setSeen] = useState<Record<LogTab, number>>({ all: 0, allies: 0, pm: 0, system: 0 });
  const [pinned, setPinned] = useState(false);
  const [, setTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const panel = useRef<HTMLElement>(null);
  const composing = useRef(false);
  const open = typing !== null || hover || pinned;
  /** when the panel was last in use: it hides a while after that, and after its last line went */
  const [active, setActive] = useState(now);
  // an open line stays open if the match's chat goes quiet a moment (what is typed is not lost)
  const canSend = (chat.ready || typing !== null) && !!send;

  useEffect(() => {
    if (typing === null) return;
    setTargetState(typing);
    input.current?.focus();
  }, [typing]);
  // the caller's whisper: where a new line goes (while a line is open the panel keeps its own)
  useEffect(() => {
    setWhisperState(whispers ? whisperProp : null);
  }, [typing === null, whisperProp, whispers]); // eslint-disable-line react-hooks/exhaustive-deps

  // In a match the pointer is locked: the game's cursor over the panel stands for the pointer
  // (input.ts, data-page-overlay).
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const over = (event: Event) => setHover((event as CustomEvent<boolean>).detail);
    el.addEventListener("pageoverlay", over);
    return () => el.removeEventListener("pageoverlay", over);
  });

  useEffect(() => {
    if (!open) setActive(now());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.lines, open, tab]);

  const newest = (under: LogTab) => chat.lines.findLast((l) => inTab(l, under, canSend))?.id ?? 0;
  const newestHere = newest(tab);
  // what the open panel shows under its tab is read
  useEffect(() => {
    if (open && seen[tab] < newestHere) setSeen((s) => ({ ...s, [tab]: newestHere }));
  }, [open, tab, newestHere, seen]);

  const inThisTab = chat.lines.filter((l) => inTab(l, tab, canSend));
  const shown = open ? inThisTab : inThisTab.filter((l) => now() - l.at < MATCH_CHAT_FADE_MS);
  // closed, with no line left on show and nothing done for a while, the panel hides altogether
  // and lets the mouse through (the game's chat keys open it again)
  const lastGone = (inThisTab.at(-1)?.at ?? 0) + MATCH_CHAT_FADE_MS;
  const idle =
    !open && shown.length === 0 && now() - Math.max(active, lastGone) >= MATCH_CHAT_IDLE_MS;

  // fade and hide: look again each second while there is something to fade or hide
  useEffect(() => {
    if (open || idle) return;
    const timer = window.setTimeout(() => setTick((t) => t + 1), 1000);
    return () => window.clearTimeout(timer);
  });

  if (!canSend && chat.lines.length === 0) return null;

  const close = () => {
    setText("");
    onTyping(null);
  };
  /** Tab: All, Allies, then (online) the player last whispered to, or who whispered last */
  const cycle = () => {
    const next = whispers ? (lastWhisper.current ?? replyTo) : null;
    if (whisper) {
      setWhisper(null);
      setTarget(Target.all);
    } else if (target === Target.allies && next) setWhisper(next);
    else setTarget(nextTarget(target));
  };

  return (
    <section
      ref={panel}
      data-page-overlay
      className={styles.panel}
      data-open={open || undefined}
      data-idle={idle || undefined}
      aria-label="Match chat"
      style={anchor ?? undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {open && (
        <div className={styles.tabs} role="tablist" aria-label="Messages to show">
          {LOG_TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              className={styles.logTab}
              aria-selected={tab === name}
              data-new={(name !== tab && newest(name) > seen[name]) || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setTab(name)}
            >
              {TAB_LABELS[name]}
            </button>
          ))}
        </div>
      )}
      <ol ref={list} data-page-scroll className={styles.lines} aria-live="polite">
        {shown.map((line) => (
          <Line key={line.id} line={line} times={times} />
        ))}
      </ol>
      <div className={styles.bar}>
        <button
          type="button"
          className={styles.tab}
          aria-expanded={open}
          title={pinned ? "Let the panel close" : "Keep the panel open"}
          onClick={() => setPinned((p) => !p)}
        >
          {canSend ? "Chat" : "Messages"}
        </button>
        {canSend &&
          (typing !== null ? (
            <div className={styles.compose}>
              <button
                type="button"
                className={styles.target}
                data-pm={whisper !== null || undefined}
                title={
                  whispers
                    ? "Tab switches between everyone, allies and the player you whisper to"
                    : "Tab switches between everyone and allies"
                }
                onMouseDown={(event) => event.preventDefault()}
                onClick={cycle}
              >
                [{toLabel(target, whisper)}]
              </button>
              <input
                ref={input}
                data-game-text
                className={styles.input}
                aria-label={
                  whisper
                    ? `Message to ${whisper}`
                    : `Message to ${targetLabel(target).toLowerCase()}`
                }
                value={text}
                maxLength={lineLimit(whisper)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="send"
                onChange={(event) => {
                  const value = event.target.value;
                  // "/r " or "/p bob " makes the line whisper to that player; what follows is the page
                  const to = whispers ? whisperTarget(value, replyTo) : null;
                  if (to) {
                    setWhisper(to);
                    setText("");
                  } else setText(value);
                }}
                onCompositionStart={() => (composing.current = true)}
                onCompositionEnd={() => (composing.current = false)}
                onBlur={close}
                onKeyDown={(event) => {
                  if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
                    return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const line = text.trim();
                    if (replyWithoutTarget(line, replyTo)) {
                      onHint?.(NO_REPLY_HINT); // keep the line: the player can make it a /pm
                      return;
                    }
                    if (line) {
                      const out =
                        whisper && !line.startsWith("/")
                          ? `/page ${whisper} ${line}`
                          : expandChatCommand(line, replyTo);
                      send?.(out, target);
                      const page = whispers ? pageOf(out) : null;
                      // a page typed out in full ("/p bob hi") whispers to bob from then on too
                      if (page) setWhisper(page.to);
                      else onTarget?.(target);
                    }
                    close();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    close();
                  } else if (event.key === "Tab") {
                    event.preventDefault();
                    cycle();
                  }
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className={styles.prompt}
              title="Enter: the last you used in this match. Backspace: Allies. \: All."
              onClick={() => onTyping(remembered)}
            >
              <span className={styles.target} data-pm={whisper !== null || undefined}>
                [{toLabel(remembered, whisper)}]
              </span>{" "}
              (press Enter to chat)
            </button>
          ))}
      </div>
    </section>
  );
}
