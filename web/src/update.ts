// The page's side of an update: the service worker finds a new build waiting, `updateOffered` hands the
// page a function that applies it, and `useUpdate` lets a component show "update available".
import { useSyncExternalStore } from "react";

let apply: (() => void) | null = null;
const listeners = new Set<() => void>();

export function updateOffered(applyUpdate: () => void): void {
  apply = applyUpdate;
  listeners.forEach((listener) => listener());
}

/** What asking for a new build found: one on its way, none, or no service worker to ask (the dev server). */
export type UpdateCheck = "found" | "current" | "none";

/** Ask the service worker for a newer build now; one it finds is offered through `updateOffered`. */
export async function checkForUpdate(
  container: Pick<ServiceWorkerContainer, "getRegistration"> | undefined = navigator.serviceWorker,
  base = import.meta.env.BASE_URL,
): Promise<UpdateCheck> {
  const registration = await container?.getRegistration(base);
  if (!registration) return "none";
  await registration.update();
  return registration.installing || registration.waiting ? "found" : "current";
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
