import "@radix-ui/themes/styles.css";
import "./styles/global.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { gameStore } from "./game/store";
import { registerServiceWorker } from "./pwa";
import { updateOffered } from "./update";

const root = document.getElementById("root");
if (!root) throw new Error("no #root in index.html");

// The local end-to-end checks (e2e/) read the game's state through this: always on the dev server, and in a
// build when the address has `?e2e`.
if (
  import.meta.env.DEV ||
  new URLSearchParams(window.location.search).has("e2e") ||
  new URLSearchParams(window.location.search).get("test") === "1"
)
  (window as unknown as { ra2Store: typeof gameStore }).ra2Store = gameStore;

createRoot(root).render(<App />);

// the service worker is for a build; the dev server serves the files on disk, and a worker would keep old ones
if (import.meta.env.PROD) void registerServiceWorker(updateOffered).catch(() => {});
