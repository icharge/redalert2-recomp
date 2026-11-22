import { useEffect, useState, type RefObject } from "react";
import type { GamePresenter } from "../game/presenter";
import { chatBoxPlace } from "./ChatBox";
import styles from "./PageButton.module.css";

interface Place {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A see-through button over one of the game's own buttons the page's FRIENDS opens from (the
 * chatField event's rectangles, src/web/chat_box.c): Yuri's Revenge's Page button and the lobby's
 * Buddy List. The game never gets the click, so its old Page dialog and Buddy List never open. Mouse
 * movement over it goes on to the game's canvas, so the game's cursor and the button's tip follow.
 */
export function PageButton({
  rect,
  label,
  presenter,
  stage,
  canvas,
  onOpen,
}: {
  /** the game's button, in game pixels (w 0: none on this screen) */
  rect: { x: number; y: number; w: number; h: number };
  /** what the button is for, for assistive technology */
  label: string;
  presenter: Pick<GamePresenter, "pictureRect" | "gameSize"> | null;
  stage: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  onOpen: () => void;
}) {
  const [place, setPlace] = useState<Place | null>(null);
  const showing = rect.w > 0 && rect.h > 0;
  const { x, y, w, h } = rect;

  useEffect(() => {
    if (!showing || !presenter) {
      setPlace(null);
      return;
    }
    let frame = 0;
    const follow = () => {
      const stageRect = stage.current?.getBoundingClientRect();
      const canvasRect = canvas.current?.getBoundingClientRect();
      const game = presenter.gameSize();
      if (stageRect && canvasRect && game.width > 0 && game.height > 0) {
        const next = chatBoxPlace(canvasRect, stageRect, presenter.pictureRect(), game, {
          x,
          y,
          w,
          h,
        });
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
  }, [showing, presenter, x, y, w, h, stage, canvas]);

  if (!showing || !place) return null;
  return (
    <button
      type="button"
      className={styles.button}
      style={place}
      aria-label={label}
      title="Friends"
      onMouseMove={(event) =>
        canvas.current?.dispatchEvent(
          new MouseEvent("mousemove", {
            clientX: event.clientX,
            clientY: event.clientY,
            movementX: event.movementX,
            movementY: event.movementY,
            bubbles: true,
          }),
        )
      }
      onClick={onOpen}
    />
  );
}
