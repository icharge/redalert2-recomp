import { useEffect, useState, type RefObject } from "react";
import type { MapSearchStatus as Status } from "../game/store";
import styles from "./MapSearchStatus.module.css";

interface Position {
  left: number;
  top: number;
}

/** A page-rendered no-match label over the game's native map list. */
export function MapSearchStatus({
  status,
  size,
  stage,
  canvas,
}: {
  status: Status;
  size: { w: number; h: number } | null;
  stage: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
}) {
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    if (!status.open || !status.noMatches) {
      setPosition(null);
      return;
    }

    const place = () => {
      const stageRect = stage.current?.getBoundingClientRect();
      const canvasRect = canvas.current?.getBoundingClientRect();
      if (!stageRect || !canvasRect) return;
      const picture = size ?? { w: 800, h: 600 };
      const scale = Math.min(canvasRect.width / picture.w, canvasRect.height / picture.h);
      const offsetX = canvasRect.left + (canvasRect.width - picture.w * scale) / 2 - stageRect.left;
      const offsetY = canvasRect.top + (canvasRect.height - picture.h * scale) / 2 - stageRect.top;
      setPosition({
        left: offsetX + (status.x + status.w) * scale - 4,
        top: offsetY + status.y * scale + 3,
      });
    };

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [status.open, status.noMatches, status.x, status.y, status.w, status.h, size, stage, canvas]);

  if (!status.open || !status.noMatches || !position) return null;
  return (
    <div className={styles.status} role="status" style={position}>
      No maps match
    </div>
  );
}
