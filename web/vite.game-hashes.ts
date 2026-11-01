import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

/**
 * Give the Emscripten game modules Vite-style hashed filenames in the built
 * site: `dist/game/ra2-<build>.js`, `.wasm`, `.wasm.br`, `.wasm.gz`, `.data`.
 *
 * The build id comes from `build.json` (cmake/build_json.cmake); the plugin
 * rewrites `script`, `wasm` and `data` there to the hashed names, and the page
 * loader reads those fields. The plain `ra2.js` stays as the small
 * "is this build present" HEAD probe; the large wasm/data files exist only
 * under their hashed names. Dev serves `public/game` unchanged.
 *
 * This is a Vite build step, not a source rename: `public/game` stays the
 * build output of build-web.cmd/sh.
 */
export function gameModuleHashes(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "ra2-game-module-hashes",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle() {
      const gameDir = path.join(path.resolve(config.root, config.build.outDir), "game");
      const manifestPath = path.join(gameDir, "build.json");
      if (!existsSync(manifestPath)) return;

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        games?: Record<string, { build?: string; script?: string; wasm?: string; data?: string }>;
      };
      if (!manifest.games) return;

      let changed = false;
      for (const [game, info] of Object.entries(manifest.games)) {
        if (!info?.build) continue;
        const suffix = `-${info.build}`;
        // `.wasm` before `.wasm.br/.gz` so the sidecars are renamed from the
        // plain names, then `.js` is copied (the plain probe stays).
        for (const ext of [".wasm", ".wasm.br", ".wasm.gz", ".data", ".js"]) {
          const from = path.join(gameDir, `${game}${ext}`);
          if (!existsSync(from)) continue;
          const to = path.join(gameDir, `${game}${suffix}${ext}`);
          rmSync(to, { force: true });
          if (ext === ".js") copyFileSync(from, to);
          else renameSync(from, to);
          changed = true;
        }
        info.script = `${game}${suffix}.js`;
        info.wasm = `${game}${suffix}.wasm`;
        info.data = `${game}${suffix}.data`;
        changed = true;
      }
      if (changed) writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    },
  };
}
