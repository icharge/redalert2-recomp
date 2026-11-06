import { useUpdate } from "../update";
import styles from "./UpdateStrip.module.css";

/** A new build of the page and the game is waiting: say so, and let the player choose when to reload. */
export function UpdateStrip() {
  const apply = useUpdate();
  if (!apply) return null;
  return (
    <div className={styles.strip} role="status">
      A new version is ready.
      <button type="button" className={styles.reload} onClick={apply}>
        RELOAD
      </button>
    </div>
  );
}
