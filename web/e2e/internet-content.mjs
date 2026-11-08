// Standalone, throwaway Internet-panel POC. No game/WASM rebuild or backend needed.
// Run from web/: node e2e/internet-content.mjs [--port 5180]
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "internet-content");
const repo = path.resolve(here, "../..");
const at = process.argv.indexOf("--port");
const port = at < 0 ? 5180 : Number(process.argv[at + 1]);
const files = {
  "/": [path.join(root, "index.html"), "text/html; charset=utf-8"],
  "/news.json": [path.join(root, "news.json"), "application/json; charset=utf-8"],
  "/news.html": [path.join(root, "news.html"), "text/html; charset=utf-8"],
  // Private local assets only. Nothing retail is copied into tracked prototype files.
  "/reference.png": [path.join(repo, "build-web/wol-menu-shots/internet.png"), "image/png"],
  "/backdrop.webp": [path.join(repo, "web/public/brand/bg-yr.webp"), "image/webp"],
  "/font.woff2": [path.join(repo, "web/public/fonts/barlow-condensed-500.woff2"), "font/woff2"],
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const entry = files[url.pathname];
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (!entry || !existsSync(entry[0])) return res.writeHead(404).end("Not found");
  if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();
  const finish = () => {
    if (res.destroyed) return;
    if (url.searchParams.get("fail") === "1")
      return res.writeHead(503).end("Simulated content failure");
    res.writeHead(200, { "Content-Type": entry[1], "Content-Length": statSync(entry[0]).size });
    if (req.method === "HEAD") res.end();
    else
      createReadStream(entry[0])
        .on("error", () => res.destroy())
        .pipe(res);
  };
  const delay = Math.min(5000, Math.max(0, Number(url.searchParams.get("delay")) || 0));
  if (delay) {
    const timer = setTimeout(finish, delay);
    res.on("close", () => clearTimeout(timer));
  } else finish();
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Internet content POC: http://127.0.0.1:${server.address().port}/`),
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
