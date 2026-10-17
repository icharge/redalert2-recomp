import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { isAllowlisted } from "./src/storage/allowlist";

/**
 * Development only (W4.8): the dev server serves the files of a local game
 * folder at /dev-game/, so the page can start the game without an import. The
 * folder is RA2_GAME_DIR, else ../game. Only the import allowlist is served,
 * only to this machine's dev server, and never in a build: nothing from the
 * game is ever part of what is published (docs/web/README.md).
 */
export function devGame(): Plugin {
  return {
    name: "ra2-dev-game",
    apply: "serve",
    configureServer(server) {
      const dir = path.resolve(process.env.RA2_GAME_DIR ?? path.join(__dirname, "..", "game"));
      server.middlewares.use("/dev-game", (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const name = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/").replace(/^\/+/, "");
        res.setHeader("Cache-Control", "no-store");
        if (name === "index.json") {
          const files = existsSync(dir)
            ? readdirSync(dir)
                .filter((f) => isAllowlisted(f) && statSync(path.join(dir, f)).isFile())
                .map((f) => ({ name: f, size: statSync(path.join(dir, f)).size }))
            : [];
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ dir, files }));
          return;
        }
        const file = path.join(dir, name);
        if (
          name.includes("/") ||
          name.includes("\\") ||
          !isAllowlisted(name) ||
          !existsSync(file)
        ) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", statSync(file).size);
        if (req.method === "HEAD") return res.end();
        createReadStream(file).pipe(res);
      });
    },
  };
}
