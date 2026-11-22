import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { devGame } from "./vite.dev-game";
import { precompressedWasm } from "./vite.precompressed-wasm";
import { gameModuleHashes } from "./vite.game-hashes";
import { DEV_PROXY_TARGET, assertSecureEndpoint, wolDevProxy } from "./src/wol-endpoint";

// The game uses threads, so the page must be cross-origin isolated
// (docs/web/deploy.md). A host that cannot send these headers gets them from the
// service worker instead (stage 6).
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig(({ mode }) => {
  // RA2_BASE may come from .env, .env.production or .env.<mode> (a shell value
  // still wins); VITE_* below come from those files through import.meta.env.
  const env = loadEnv(mode, process.cwd(), "RA2_");
  const wol = loadEnv(mode, process.cwd(), "VITE_WOL_");
  return {
    base: env.RA2_BASE || "/",
    plugins: [
      react(),
      {
        // A build sends passwords and the session cookie to the WOL server: never over plain
        // http to another machine (src/wol-endpoint.ts checks again when the page starts).
        name: "ra2-secure-wol-server",
        apply: "build",
        configResolved(config) {
          for (const name of ["VITE_WOL_HTTP_URL", "VITE_WOL_SOCKET_URL"]) {
            const url = wol[name];
            if (url) assertSecureEndpoint(url);
          }
          if (!wol.VITE_WOL_HTTP_URL)
            config.logger.warn(
              "VITE_WOL_HTTP_URL is unset: this build talks to http://127.0.0.1:9090, a local server only.",
            );
        },
      },
      devGame(),
      precompressedWasm(),
      gameModuleHashes(),
      // The service worker is src/sw.ts (docs/web/deploy.md). It is built for `pnpm build` only: the dev
      // server has none, so a reload there is always the files on disk. The game's own files (public/game)
      // are not in its list: it keeps those itself, by build.
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        injectRegister: false,
        registerType: "prompt",
        devOptions: { enabled: false },
        injectManifest: {
          globPatterns: ["**/*.{js,css,html,svg,png,webp,webmanifest,woff,woff2,fnt}"],
          globIgnores: ["game/**"],
          maximumFileSizeToCacheInBytes: 3_000_000,
          rollupFormat: "iife",
        },
        manifest: {
          name: "YuriNET Launcher",
          short_name: "YuriNET",
          description: "The C&C Red Alert 2: Yuri's Revenge Launcher on the web",
          display: "standalone",
          start_url: "./",
          scope: "./",
          background_color: "#0b0b0e",
          theme_color: "#0b0b0e",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          ],
        },
      }),
    ],
    // the archive import's worker bundles 7-Zip's ES module (src/storage/archive.worker.ts)
    worker: { format: "es" as const },
    // The WOL server under the page's own origin (src/wol-endpoint.ts): its refresh cookie is then
    // first-party, so a reload keeps the member signed in whatever host the page is opened on.
    server: {
      headers: isolation,
      port: 5173,
      proxy: wolDevProxy(env.RA2_WOL_PROXY_TARGET || DEV_PROXY_TARGET),
    },
    preview: { headers: isolation, port: 4173 },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
