import { useEffect, useRef, useState, type RefObject } from "react";
import type { GamePresenter, PictureRect } from "../game/presenter";
import type { ChatField } from "../game/store";
import { NO_REPLY_HINT, expandChatCommand, replyWithoutTarget } from "../game/chat-commands";
import styles from "./ChatBox.module.css";

interface Place {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A line the game's chat takes; longer text is cut (the game's own line holds less). */
export const CHAT_MAX_LENGTH = 200;

/**
 * Where the box goes in the stage: over the game's chat line (game pixels), mapped through
 * where the presenter draws the picture in the canvas.
 */
export function chatBoxPlace(
  canvas: { left: number; top: number; width: number; height: number },
  stage: { left: number; top: number },
  picture: PictureRect,
  game: { width: number; height: number },
  field: { x: number; y: number; w: number; h: number },
): Place {
  const left = picture.x + (picture.width * field.x) / game.width;
  const top = picture.y + (picture.height * field.y) / game.height;
  const right = picture.x + (picture.width * (field.x + field.w)) / game.width;
  const bottom = picture.y + (picture.height * (field.y + field.h)) / game.height;
  return {
    left: canvas.left - stage.left + canvas.width * left,
    top: canvas.top - stage.top + canvas.height * top,
    width: canvas.width * (right - left),
    height: canvas.height * (bottom - top),
  };
}

/**
 * A text box over the game's chat line in its lobbies and game rooms (src/web/chat_box.c), so the
 * browser's keyboard and IME type into something visible. Enter sends the line to the game, which
 * sends it as its own chat. The game draws Thai; other scripts reach it as "?".
 */
export function ChatBox({
  field,
  presenter,
  stage,
  canvas,
  send,
  replyTo = null,
  onHint,
}: {
  field: ChatField;
  presenter: Pick<GamePresenter, "pictureRect" | "gameSize"> | null;
  stage: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  send: ((text: string) => void) | null;
  /** the last player who whispered: where /r goes (PmStore's lastFrom) */
  replyTo?: string | null;
  /** a line for the player only (the game's chat log): /r with nobody to answer */
  onHint?: (text: string) => void;
}) {
  const [place, setPlace] = useState<Place | null>(null);
  const [text, setText] = useState("");
  const composing = useRef(false);
  const showing = field.open && !!send;

  useEffect(() => {
    if (!showing || !presenter) {
      setPlace(null);
      return;
    }
    // The picture moves with the window, the canvas and the scale setting; follow it each frame.
    let frame = 0;
    const follow = () => {
      const stageRect = stage.current?.getBoundingClientRect();
      const canvasRect = canvas.current?.getBoundingClientRect();
      const game = presenter.gameSize();
      if (stageRect && canvasRect && game.width > 0 && game.height > 0) {
        const next = chatBoxPlace(canvasRect, stageRect, presenter.pictureRect(), game, field);
        setPlace((last) =>
          last &&
          last.left === next.left &&
          last.top === next.top &&
          last.width === next.width &&
          last.height === next.height
            ? last
            : next,
        );
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [showing, presenter, field, stage, canvas]);

  if (!showing || !place) return null;
  const fontSize = Math.max(12, Math.min(20, Math.round(place.height * 0.8)));
  return (
    <>
      <input
        data-game-text
        data-chat-box
        data-page-overlay
        className={styles.box}
        style={{ ...place, fontSize }}
        aria-label="Chat message"
        placeholder="Type a message, Enter to send"
        value={text}
        maxLength={CHAT_MAX_LENGTH}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="send"
        onChange={(event) => {
          setText(event.target.value);
        }}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        onKeyDown={(event) => {
          // Enter confirms an IME candidate first; only a plain Enter sends.
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") {
            event.preventDefault();
            const line = text.trim();
            if (replyWithoutTarget(line, replyTo)) {
              onHint?.(NO_REPLY_HINT); // keep the line: the player can make it a /pm
              return;
            }
            if (line) send?.(expandChatCommand(line, replyTo));
            setText("");
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.blur();
            canvas.current?.focus();
          }
        }}
      />
    </>
  );
}
