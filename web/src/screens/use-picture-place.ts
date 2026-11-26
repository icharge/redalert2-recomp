import { useEffect, useRef, useState, type RefObject } from "react";
import type { GamePresenter, PictureRect } from "../game/presenter";

type Box = Pick<DOMRect, "left" | "top" | "width" | "height">;
type Game = { width: number; height: number };

/**
 * A place over the game's picture (a chat box, a label, a see-through button) that follows the
 * picture as the window, the canvas and the game's size change, while `active`.
 *
 * Each animation frame reads only the presenter's game size and picture rectangle. The stage's
 * and the canvas's boxes are read again only when a ResizeObserver or the window says they
 * changed. Reading them every frame forces a layout after the cursor layer has moved, which cost
 * about 12 ms a second in a match with the match panel alone (docs/web/testing.md, Performance).
 * Without ResizeObserver (jsdom), the boxes are read every frame.
 *
 * `compute` and `same` may be new functions each render: the next frame uses the latest ones.
 */
export function usePicturePlace<T>(
  presenter: Pick<GamePresenter, "pictureRect" | "gameSize"> | null | undefined,
  stage: RefObject<HTMLElement | null> | undefined,
  canvas: RefObject<HTMLCanvasElement | null> | undefined,
  active: boolean,
  compute: (canvasRect: Box, stageRect: Box, picture: PictureRect, game: Game) => T | null,
  same: (last: T, next: T) => boolean,
): T | null {
  const [place, setPlace] = useState<T | null>(null);
  const latest = useRef({ compute, same });
  latest.current = { compute, same };

  useEffect(() => {
    if (!active || !presenter || !stage || !canvas) {
      setPlace(null);
      return;
    }
    let boxes: { stage: Box; canvas: Box } | null = null;
    let stale = true;
    const invalidate = () => {
      stale = true;
    };
    const observed = typeof ResizeObserver === "function";
    const observer = observed ? new ResizeObserver(invalidate) : null;
    const observe = () => {
      if (!observer) return;
      observer.disconnect();
      if (stage.current) observer.observe(stage.current);
      if (canvas.current) observer.observe(canvas.current);
    };
    observe();
    window.addEventListener("resize", invalidate);

    let frame = 0;
    let last: T | null = null;
    let watched = [stage.current, canvas.current];
    const follow = () => {
      if (watched[0] !== stage.current || watched[1] !== canvas.current) {
        watched = [stage.current, canvas.current];
        observe();
        stale = true;
      }
      if (stale || !observed) {
        const stageRect = stage.current?.getBoundingClientRect();
        const canvasRect = canvas.current?.getBoundingClientRect();
        boxes = stageRect && canvasRect ? { stage: stageRect, canvas: canvasRect } : null;
        stale = !boxes;
      }
      const game = presenter.gameSize();
      if (boxes && game.width > 0 && game.height > 0) {
        const next = latest.current.compute(
          boxes.canvas,
          boxes.stage,
          presenter.pictureRect(),
          game,
        );
        if (next !== null && !(last !== null && latest.current.same(last, next))) {
          last = next;
          setPlace(next);
        }
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", invalidate);
    };
  }, [active, presenter, stage, canvas]);

  return active ? place : null;
}
