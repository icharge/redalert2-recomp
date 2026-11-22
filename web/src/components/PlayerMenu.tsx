import { useEffect, useRef } from "react";
import styles from "./PlayerMenu.module.css";

/**
 * The menu a right-click on a lobby player opens (src/web/chat_box.c's playerPick): Add friend,
 * Message and Profile for that player. It closes on a choice, Escape, or a click elsewhere.
 */
export function PlayerMenu({
  name,
  left,
  top,
  self,
  onAddFriend,
  onMessage,
  onProfile,
  onClose,
}: {
  name: string;
  /** where it opens, in the stage's pixels */
  left: number;
  top: number;
  /** the player's own name: only Profile */
  self: boolean;
  onAddFriend: () => void;
  onMessage: () => void;
  onProfile: () => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector("button")?.focus();
    const away = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [onClose]);
  const item = (label: string, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      className={styles.item}
      onClick={() => {
        run();
        onClose();
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={`Player ${name}`}
      className={styles.menu}
      style={{ left, top }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className={styles.name} dir="auto">
        {name}
      </div>
      {!self && item("Add friend", onAddFriend)}
      {!self && item("Message", onMessage)}
      {item("Profile", onProfile)}
    </div>
  );
}
