import { useEffect, useState, type RefObject } from "react";
import type { GamePresenter, PictureRect } from "../game/presenter";
import type { MapSearchStatus as Status } from "../game/store";
import styles from "./MapSearchStatus.module.css";

interface Position {
  left: number;
  top: number;
}

/** How far inside the list's top right corner the label sits, in CSS pixels: clear of its frame. */
const INSET_X = 4;
const INSET_Y = 3;

/**
 * Where the label goes in the stage: at the list's top right corner (game pixels), mapped
 * through where the presenter draws the picture in the canvas.
 */
export function labelPosition(
  canvas: { left: number; top: number; width: number; height: number },
  stage: { left: number; top: number },
  picture: PictureRect,
  game: { width: number; height: number },
  list: { x: number; y: number; w: number },
): Position {
  const x = picture.x + (picture.width * (list.x + list.w)) / game.width;
  const y = picture.y + (picture.height * list.y) / game.height;
  return {
    left: canvas.left - stage.left + canvas.width * x - INSET_X,
    top: canvas.top - stage.top + canvas.height * y + INSET_Y,
  };
}

/**
 * "No maps match" over the game's map list, when its search box hides every map
 * (src/web/map_search.c). The game's list is then empty.
 */
export function MapSearchStatus({
  status,
  presenter,
  stage,
  canvas,
}: {
  status: Status;
  presenter: Pick<GamePresenter, "pictureRect" | "gameSize"> | null;
  stage: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const showing = status.open && status.noMatches;

  useEffect(() => {
    if (!showing || !presenter) {
      setPosition(null);
      return;
    }
    // The picture moves with the window, the canvas and the scale setting; follow it each frame
    // while the label shows.
    let frame = 0;
    const place = () => {
      const stageRect = stage.current?.getBoundingClientRect();
      const canvasRect = canvas.current?.getBoundingClientRect();
      const game = presenter.gameSize();
      if (stageRect && canvasRect && game.width > 0 && game.height > 0) {
        const next = labelPosition(canvasRect, stageRect, presenter.pictureRect(), game, status);
        setPosition((last) =>
          last && last.left === next.left && last.top === next.top ? last : next,
        );
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [showing, presenter, status, stage, canvas]);

  if (!showing || !position) return null;
  return (
    <div className={styles.status} role="status" style={position}>
      No maps match
    </div>
  );
}
