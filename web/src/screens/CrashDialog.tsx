import { useId, useState } from "react";
import styles from "./CrashDialog.module.css";

/** The game's thread died: what it said, and on request the end of its log. */
export function CrashDialog({
  message,
  log,
  onReload,
  onReturn,
}: {
  message: string;
  /** the game's log; the last 80 lines are shown */
  log: readonly string[];
  onReload(): void;
  onReturn(): void;
}) {
  const [showLog, setShowLog] = useState(false);
  const titleId = useId();
  const logId = useId();
  const tail = log.slice(-80).join("\n");
  return (
    <div className={styles.overlay}>
      <section role="alertdialog" aria-labelledby={titleId} className={styles.card}>
        <h1 id={titleId} className={styles.title}>
          THE GAME STOPPED
        </h1>
        <p className={styles.message}>{message}</p>
        {showLog && tail && (
          <pre id={logId} className={styles.log}>
            {tail}
          </pre>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={onReload}>
            RELOAD
          </button>
          <button type="button" className={styles.secondary} onClick={onReturn}>
            LAUNCHER
          </button>
          {tail && (
            <button
              type="button"
              className={styles.secondary}
              aria-expanded={showLog}
              aria-controls={logId}
              onClick={() => setShowLog((now) => !now)}
            >
              LOG
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
