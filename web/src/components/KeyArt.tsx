import { useEffect, useState } from "react";
import { appPath } from "../paths";
import type { GameId } from "../storage/install";
import { EDITION_BRAND } from "./brand";
import styles from "./KeyArt.module.css";

/** The edition's background art, filling its positioned parent. `dim` (0–1) darkens it for busy screens. */
export function KeyArt({ edition, dim }: { edition: GameId | null; dim?: number }) {
  const id: GameId = edition ?? "ra2";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  return (
    <div className={styles.art} aria-hidden="true">
      {failed ? (
        <div className={styles.fill} data-fallback="gradient" data-edition={id} />
      ) : (
        <img
          className={styles.image}
          data-edition={id}
          src={appPath(EDITION_BRAND[id].background)}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
      <div className={styles.shadeLeft} />
      <div className={styles.shadeBottom} />
      {dim ? (
        <div className={styles.fill} style={{ background: `rgba(7, 8, 11, ${dim})` }} />
      ) : null}
    </div>
  );
}
