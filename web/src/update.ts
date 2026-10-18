// The page's side of an update: the service worker finds a new build waiting, `updateOffered` hands the
// page a function that applies it, and `useUpdate` lets a component show "update available".
import { useSyncExternalStore } from "react";

let apply: (() => void) | null = null;
const listeners = new Set<() => void>();

export function updateOffered(applyUpdate: () => void): void {
  apply = applyUpdate;
  listeners.forEach((listener) => listener());
}

/** The function that applies the waiting update, or null when there is none. */
export function useUpdate(): (() => void) | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => apply,
  );
}
