import { useState } from "react";
import styles from "./InfoTip.module.css";

/** An ⓘ that holds an explanation: a tooltip on hover, and shown on click for touch screens. */
export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.tip}
        aria-label={text}
        title={text}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((now) => !now);
        }}
        onBlur={() => setOpen(false)}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7v4.5M8 4.6v.1" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <span className={styles.bubble} aria-hidden="true">
          {text}
        </span>
      )}
    </span>
  );
}
