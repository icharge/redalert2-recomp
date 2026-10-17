import "@radix-ui/themes/styles.css";
import "./styles/global.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { gameStore } from "./game/store";

const root = document.getElementById("root");
if (!root) throw new Error("no #root in index.html");

// Development only: the local end-to-end check (e2e/) reads the game's state through this
if (import.meta.env.DEV) (window as unknown as { ra2Store: typeof gameStore }).ra2Store = gameStore;

createRoot(root).render(<App />);
