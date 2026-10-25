import { useEffect, useState } from "react";

/** The player is looking at the game: its tab is showing and the window has the focus. */
export const hasAttention = (): boolean =>
  document.visibilityState !== "hidden" && document.hasFocus();

/** `hasAttention`, kept up to date. The Settings view is part of the page, so it does not take it away. */
export function useAttention(): boolean {
  const [attention, setAttention] = useState(hasAttention);
  useEffect(() => {
    const update = () => setAttention(hasAttention());
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return attention;
}
