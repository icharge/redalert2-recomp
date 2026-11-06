import { useState, type CSSProperties, type ReactNode } from "react";
import styles from "./GameTray.module.css";

const KEY = "ra2-tray-open";

function remembered(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The page's controls over the game: a red star at the bottom right, just left of the game's
 * sidebar (`right`, in CSS pixels from the page's right edge), that opens a bar of them. Collapsed,
 * the bar stays mounted but hidden, so what it holds keeps running (the sound's start prompt shows
 * itself outside the bar). While a match plays (`quiet`) the bar slides away into the star and the
 * star goes faint; pointing at them, keyboard focus, an open pop-up or the game's pause menu brings
 * the bar back.
 */
export function GameTray({
  children,
  quiet = false,
  right = 0,
}: {
  children: ReactNode;
  quiet?: boolean;
  right?: number;
}) {
  const [open, setOpen] = useState(remembered);
  const toggle = () => {
    setOpen((now) => {
      try {
        localStorage.setItem(KEY, now ? "0" : "1");
      } catch {
        // then it is only remembered until the page closes
      }
      return !now;
    });
  };
  return (
    <div
      className={styles.tray}
      data-open={open || undefined}
      data-quiet={quiet || undefined}
      style={{ "--tray-right": `${Math.round(right)}px` } as CSSProperties}
    >
      <button
        type="button"
        className={styles.star}
        aria-label="Page controls"
        aria-expanded={open}
        onClick={toggle}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2.5l2.6 6.6 7.1.4-5.5 4.5 1.8 6.9L12 17.1 5.9 20.9l1.8-6.9L2.3 9.5l7.1-.4z" />
        </svg>
      </button>
      <div className={styles.clip}>
        <div
          className={styles.items}
          role={open ? "toolbar" : undefined}
          aria-label={open ? "Page controls" : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** The class for a button or link in the tray. */
export const trayItem = styles.item;
