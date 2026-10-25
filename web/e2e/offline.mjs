// W6.7: the service worker, in a real Chrome with a fresh profile, against `dist/` served WITHOUT the
// cross-origin isolation headers (a host like GitHub Pages): the page must make itself isolated, and after one
// play it must start, and start the game, with the network off.
//
//   pnpm build && node e2e/offline.mjs [--game ../game]
//
// Needs a built game (web/public/game, copied into dist by the build).
import { chromium } from "playwright-core";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { options } from "./lib.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const gameDir = path.resolve(flag("--game", "../game"));
const dist = path.resolve("dist");
if (!existsSync(path.join(dist, "sw.js"))) {
  console.error("no dist/sw.js: run `pnpm build` first");
  process.exit(1);
}
const base = options(argv);

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
// a plain static server: no COOP, no COEP, no cache headers
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist)) return void res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, {
    "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
    "Content-Length": statSync(file).size,
  });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const swFile = path.join(dist, "sw.js");
const buildFile = path.join(dist, "game", "build.json");
const original = { sw: readFileSync(swFile, "utf8"), build: readFileSync(buildFile, "utf8") };

const profile = mkdtempSync(path.join(os.tmpdir(), "ra2-offline-"));
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const context = await chromium.launchPersistentContext(profile, {
  executablePath: base.chrome,
  headless: !base.headed,
  args: ["--no-sandbox"],
  viewport: { width: 1280, height: 960 },
});
const page = context.pages()[0] ?? (await context.newPage());
page.on("pageerror", (e) => console.error("pageerror:", e.message));

async function running() {
  await page.waitForFunction(() => window.ra2Store?.getSnapshot().phase === "running", null, {
    timeout: 180_000,
  });
}

try {
  // ---- first visit: the page makes itself isolated -------------------------------------------------
  await page.goto(`${origin}/?e2e`);
  await page.getByText("Bring your game").waitFor({ timeout: 30_000 });
  check(
    await page.evaluate(() => window.crossOriginIsolated),
    "a host with no headers: the worker makes the page isolated (after one reload)",
  );

  // ---- import, play once so the game's files are in the worker's cache ------------------------------------
  await page.locator('input[type="file"]').setInputFiles(gameDir);
  await page.getByRole("button", { name: /^Import / }).click();
  await page.getByText("Your games").waitFor({ timeout: 600_000 });
  await page.getByRole("button", { name: "Play" }).click();
  await running();
  check(true, "the game starts, and its files are fetched through the worker");
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((n) => n.startsWith("ra2-game-"));
    const keys = names.length ? await (await caches.open(names[0])).keys() : [];
    return keys.map((r) => new URL(r.url).pathname).sort();
  });
  check(
    ["/game/ra2md.data", "/game/ra2md.js", "/game/ra2md.wasm"].every((p) => cached.includes(p)),
    `Yuri's edition-named files are kept, by build (${cached.join(", ")})`,
  );

  // ---- a new build: the worker and build.json change on the server ---------------------------------------------
  const ids = () =>
    page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith("ra2-game-")));
  const before = await ids();
  writeFileSync(swFile, `${original.sw}\n// a new build\n`);
  writeFileSync(
    buildFile,
    original.build.replace(/"build":"[0-9a-f]+"/, '"build":"ffffffffffffffff"'),
  );
  await page.goto(`${origin}/?e2e`);
  await page.getByText("A new version is ready").waitFor({ timeout: 30_000 });
  check(true, "a new build on the server: the page offers the update");
  await page.getByRole("button", { name: "Reload" }).click();
  await page.getByText("Your games").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Play" }).click();
  await running();
  const after = await ids();
  check(
    before.length === 1 &&
      after.length === 1 &&
      after[0] === "ra2-game-ffffffffffffffff" &&
      after[0] !== before[0],
    `after the update the game is kept under the new build only (${before} -> ${after})`,
  );

  // ---- offline: the server is shut down, so nothing can come from it (the worker's own requests are not
  // covered by the browser's offline switch, so that is not enough) --------------------------------------
  await context.setOffline(true);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await page.goto(`${origin}/?e2e`);
  await page.getByText("Your games").waitFor({ timeout: 30_000 });
  check(true, "with the server gone: the page loads (from the worker's cache)");
  await page.getByRole("button", { name: "Play" }).click();
  await running();
  check(true, "with the server gone: the game starts too");
  check(
    await page.evaluate(() => window.crossOriginIsolated),
    "with the server gone: still isolated",
  );
} finally {
  await context.close();
  server.closeAllConnections();
  writeFileSync(swFile, original.sw); // dist as it was
  writeFileSync(buildFile, original.build);
  rmSync(profile, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
console.log("all passed");
