// Registers the service worker (src/sw.ts) and tells the page about two things it must act on: a new
// build waiting ("update available"), and, on a host that sent no isolation headers, a reload once the
// worker is in charge (threads need the headers, and the worker is what adds them).
import { clearIsolationReload, isolationReloadAllowed, markIsolationReload } from "./swlogic";

const RELOADED = "ra2-isolation-reload";

/** The attempt is per deployment base: another app on this origin must not suppress this one's reload. */
const attemptKey = (base: string) => `${RELOADED}:${base}`;

/**
 * `onUpdate` is given a function that applies the update (the new worker takes over, and the page reloads).
 * Nothing happens in a browser without service workers, or on the dev server, which has none.
 */
export async function registerServiceWorker(
  onUpdate: (apply: () => void) => void,
  base = import.meta.env.BASE_URL,
): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const key = attemptKey(base);
  // This page is already isolated: forget earlier attempts, so a later load may reload again.
  if (window.crossOriginIsolated) clearIsolationReload(window.sessionStorage, key);

  const reloadForIsolation = () => {
    if (window.crossOriginIsolated) return false;
    if (!isolationReloadAllowed(window.sessionStorage, key)) return false;
    markIsolationReload(window.sessionStorage, key);
    window.location.reload();
    return true;
  };

  const registration = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  let applying = false;

  const offerUpdate = () => {
    if (!registration.waiting || !navigator.serviceWorker.controller) return;
    onUpdate(() => {
      applying = true;
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    });
  };
  offerUpdate();
  registration.addEventListener("updatefound", () => {
    const next = registration.installing;
    next?.addEventListener("statechange", () => {
      if (next.state === "installed") offerUpdate();
    });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (applying) {
      window.location.reload();
      return;
    }
    reloadForIsolation();
  });
  // the worker was already in charge when this page loaded, but the host sent no headers (a cached page)
  if (navigator.serviceWorker.controller) reloadForIsolation();
}
