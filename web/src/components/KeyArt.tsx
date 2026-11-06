import { useEffect, useState, type CSSProperties } from "react";
import { appPath } from "../paths";
import type { GameId } from "../storage/install";
import { EDITION_BRAND } from "./brand";
import styles from "./KeyArt.module.css";

/** Only the first background of the page fades in; a tab change must not dip it to black. */
let shown = false;

/** The edition's background art, filling its positioned parent. `dim` (0–1) darkens it for busy screens. */
export function KeyArt({ edition, dim }: { edition: GameId | null; dim?: number }) {
  const id: GameId = edition ?? "ra2";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  const [arrive] = useState(() => !shown);
  useEffect(() => {
    shown = true;
  }, []);
  // Every background drifts on the page's own clock, so a new screen carries on from where the last was.
  const [phase] = useState(() => `-${(performance.now() / 1000).toFixed(2)}s`);
  return (
    <div
      className={styles.art}
      data-edition={id}
      style={{ "--phase": phase } as CSSProperties}
      aria-hidden="true"
    >
      {failed ? (
        <div className={styles.fill} data-fallback="gradient" data-edition={id} />
      ) : (
        <img
          className={arrive ? `${styles.image} ${styles.arrive}` : styles.image}
          data-edition={id}
          data-arrive={arrive || undefined}
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
