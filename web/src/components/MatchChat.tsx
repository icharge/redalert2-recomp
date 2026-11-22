import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { GamePresenter, PictureRect } from "../game/presenter";
import type { MatchChat as MatchChatState, MatchChatLine } from "../game/store";
import { readChatTimePreference } from "../storage/chat-time-preferences";
import styles from "./MatchChat.module.css";

/** The game's own line takes 97 typed characters; the packet holds 111 (docs/web/match-chat.md). */
export const MATCH_CHAT_MAX_LENGTH = 97;
/** How long a line stays on the battlefield while the panel is not in use. */
export const MATCH_CHAT_FADE_MS = 20_000;

/** Who a line goes to: the game's chat targets. */
export const Target = { allies: 2, all: 3 } as const;
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

/**
 * The game's text as the player reads it: with the Thai font, Windows-874 bytes widened to
 * U+00A1..U+00FB are Thai (U+0E01..U+0E5B); without it they are the Latin-1 the game draws.
 */
export function gameText(text: string, thai: boolean): string {
  if (!thai) return text;
  return text.replace(/[¡-û]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xa0 + 0x0e00));
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
  return target === Target.allies ? "Allies" : "All";
}

/** The local time of a line, as the lobby's chat shows it: "14:05". */
export function lineTime(at: number): string {
  const time = new Date(at);
  return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
}

function Time({ at, on }: { at: number; on: boolean }) {
  return on ? <span className={styles.time}>{lineTime(at)} </span> : null;
}

function Line({ line, thai, times }: { line: MatchChatLine; thai: boolean; times: boolean }) {
  if (line.system)
    return (
      <li className={styles.line}>
        <Time at={line.at} on={times} />
        <span className={styles.system}>{gameText(line.text, thai)}</span>
      </li>
    );
  return (
    <li className={styles.line}>
      <Time at={line.at} on={times} />
      {line.own && line.to === Target.allies && <span className={styles.to}>[Allies] </span>}
      <span className={styles.name} style={{ color: playerColour(line.colour) }}>
        {gameText(line.name, thai)}:
      </span>{" "}
      <span className={styles.text}>{gameText(line.text, thai)}</span>
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
  thai,
  send,
  now = Date.now,
  times = readChatTimePreference(),
  presenter,
  stage,
  canvas,
}: {
  chat: MatchChatState;
  /** the line to type into is open */
  typing: boolean;
  onTyping: (typing: boolean) => void;
  thai: boolean;
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
  const [target, setTarget] = useState<Target>(Target.all);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [, setTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const panel = useRef<HTMLElement>(null);
  const composing = useRef(false);
  const open = typing || hover || pinned;
  // an open line stays open if the match's chat goes quiet a moment (what is typed is not lost)
  const canSend = (chat.ready || typing) && !!send;

  useEffect(() => {
    if (typing) input.current?.focus();
  }, [typing]);

  // In a match the pointer is locked: the game's cursor over the panel stands for the pointer
  // (input.ts, data-page-overlay).
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const over = (event: Event) => setHover((event as CustomEvent<boolean>).detail);
    el.addEventListener("pageoverlay", over);
    return () => el.removeEventListener("pageoverlay", over);
  });

  // fade: look again a little after the newest line would go
  useEffect(() => {
    if (open || chat.lines.length === 0) return;
    const timer = window.setTimeout(() => setTick((t) => t + 1), 1000);
    return () => window.clearTimeout(timer);
  });

  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.lines, open]);

  const shown = open ? chat.lines : chat.lines.filter((l) => now() - l.at < MATCH_CHAT_FADE_MS);
  if (!canSend && chat.lines.length === 0) return null;

  const close = () => {
    setText("");
    onTyping(false);
  };

  return (
    <section
      ref={panel}
      data-page-overlay
      className={styles.panel}
      data-open={open || undefined}
      aria-label="Match chat"
      style={anchor ?? undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <ol ref={list} data-page-scroll className={styles.lines} aria-live="polite">
        {shown.map((line) => (
          <Line key={line.id} line={line} thai={thai} times={times} />
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
          (typing ? (
            <div className={styles.compose}>
              <button
                type="button"
                className={styles.target}
                title="Tab switches between everyone and allies"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setTarget((t) => (t === Target.all ? Target.allies : Target.all))}
              >
                [{targetLabel(target)}]
              </button>
              <input
                ref={input}
                data-game-text
                className={styles.input}
                aria-label={`Message to ${targetLabel(target).toLowerCase()}`}
                value={text}
                maxLength={MATCH_CHAT_MAX_LENGTH}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="send"
                onChange={(event) => setText(event.target.value)}
                onCompositionStart={() => (composing.current = true)}
                onCompositionEnd={() => (composing.current = false)}
                onBlur={close}
                onKeyDown={(event) => {
                  if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
                    return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const line = text.trim();
                    if (line) send?.(line, target);
                    close();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    close();
                  } else if (event.key === "Tab") {
                    event.preventDefault();
                    setTarget((t) => (t === Target.all ? Target.allies : Target.all));
                  }
                }}
              />
            </div>
          ) : (
            <button type="button" className={styles.prompt} onClick={() => onTyping(true)}>
              <span className={styles.target}>[{targetLabel(target)}]</span> (press Enter to chat)
            </button>
          ))}
      </div>
    </section>
  );
}
