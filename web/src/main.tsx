import "@radix-ui/themes/styles.css";
import "./styles/tokens.css";
import "./styles/global.css";
import { createRoot } from "react-dom/client";
import { account } from "./account/store";
import { App } from "./App";
import { exposeDebugStore } from "./debug-global";
import { gameStore } from "./game/store";
import { registerServiceWorker } from "./pwa";
import { updateOffered } from "./update";

const root = document.getElementById("root");
if (!root) throw new Error("no #root in index.html");

// The local end-to-end checks (e2e/) read the game's state through window.ra2Store: on the dev server, and
// in a build made with VITE_E2E_HOOKS=1 when the address has `?e2e` (src/debug-global.ts).
exposeDebugStore(window, gameStore, {
  dev: import.meta.env.DEV,
  e2eBuild: import.meta.env.VITE_E2E_HOOKS === "1",
});

// one refresh from the cookie restores a signed-in member; with no server the launcher stays a guest
void account.restore();

createRoot(root).render(<App />);

// the service worker is for a build; the dev server serves the files on disk, and a worker would keep old ones
if (import.meta.env.PROD) void registerServiceWorker(updateOffered).catch(() => {});
