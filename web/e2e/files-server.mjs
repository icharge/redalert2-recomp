// Local test fixture transport. Only the import allowlist is streamed, only on
// IPv4 loopback, and the server exists for the lifetime of one browser run.
import { createReadStream, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { transformWithEsbuild } from "vite";

export async function serveGame(game, pageOrigin) {
  const rulesPath = fileURLToPath(new URL("../src/storage/install.ts", import.meta.url));
  const rules = await transformWithEsbuild(readFileSync(rulesPath, "utf8"), rulesPath);
  const { classify } = await import(`data:text/javascript;base64,${Buffer.from(rules.code).toString("base64")}`);
  const files = readdirSync(game).filter((name) => classify(name) && statSync(path.join(game, name)).isFile())
    .map((name) => ({ name, size: statSync(path.join(game, name)).size }));
  const names = new Set(files.map((f) => f.name));
  const server = createServer((req, res) => {
    let name;
    try { name = decodeURIComponent(new URL(req.url, "http://localhost").pathname.slice(1)); }
    catch { res.writeHead(400); res.end(); return; }
    res.setHeader("Access-Control-Allow-Origin", pageOrigin);
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (name === "index.json") {
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ files })); return;
    }
    if (!names.has(name)) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", statSync(path.join(game, name)).size);
    createReadStream(path.join(game, name)).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    async route(context) {
      await context.route("**/test-game/**", (route) => {
        const name = new URL(route.request().url()).pathname.slice("/test-game/".length);
        return route.fulfill({ status: 307, headers: { Location: `${origin}/${name}` } });
      });
    },
    close() { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); },
  };
}
