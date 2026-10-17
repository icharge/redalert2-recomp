import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { devGame } from "./vite.dev-game";

// The game uses threads, so the page must be cross-origin isolated
// (docs/web/deploy.md). A host that cannot send these headers gets them from the
// service worker instead (stage 6).
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react(), devGame()],
  server: { headers: isolation, port: 5173 },
  preview: { headers: isolation, port: 4173 },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
