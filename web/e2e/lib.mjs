// Shared by the local end-to-end checks: a Chrome on the dev server's page, the game's
// state, screenshots, and clicks in the game's own pixels.
import { chromium } from "playwright-core";
import { createReadStream, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { serveGame } from "./files-server.mjs";

export function options(argv) {
  const option = (name, fallback) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : fallback;
  };
  return {
    url: option("--url", "http://127.0.0.1:5173/"),
    shots: path.resolve(option("--shots", "e2e/shots")),
    headed: argv.includes("--headed"),
    chrome: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
    pageArgs: argv.filter((a, i) => argv[i - 1] === "--arg"),
    testGame: option("--game", null),
    gameBuild: option("--build", null),
  };
}

export async function startPage(opts) {
  mkdirSync(opts.shots, { recursive: true });
  const browser = await chromium.launch({
    executablePath: opts.chrome,
    headless: !opts.headed,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 },
    serviceWorkers: "block",
  });
  // Pin a test's module without overwriting another developer's published build.
  if (opts.gameBuild) {
    // Stream the large debug WASM over HTTP; CDP fulfill bodies exceed Chrome's
    // 100 MB DevTools pipe buffer and disconnect the browser.
    const server = createServer((request, response) => {
      const name = new URL(request.url, "http://localhost").pathname.slice(1);
      if (!/^ra2\.(js|wasm|data)$/.test(name)) {
        response.writeHead(404).end();
        return;
      }
      const file = path.resolve(opts.gameBuild, name);
      response.writeHead(200, {
        "Content-Length": statSync(file).size,
        "Content-Type": name.endsWith(".js")
          ? "text/javascript"
          : name.endsWith(".wasm")
            ? "application/wasm"
            : "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(file).pipe(response);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    browser.on("disconnected", () => server.close());
    await context.route(/\/game\/(?:ra2\/)?ra2\.(js|wasm|data)(?:\?.*)?$/, (route) => {
      const name = new URL(route.request().url()).pathname.split("/").at(-1);
      return route.continue({ url: `http://127.0.0.1:${server.address().port}/${name}` });
    });
  }
  if (opts.testGame) {
    const server = await serveGame(
      path.resolve(opts.testGame),
      new URL(opts.url).origin,
      opts.gameFileOverrides,
    );
    await server.route(context);
    browser.on("disconnected", () => {
      void server.close();
    });
  }
  const page = await context.newPage();
  const lines = [];
  /** Every line the game printed (the page keeps only the last 3000). */
  const all = [];
  await page.exposeFunction("ra2Tap", (line) => all.push(line));
  page.on("console", (m) => lines.push(`[console.${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => lines.push(`[pageerror] ${e.message}`));

  const state = () => page.evaluate(() => window.ra2Store?.getSnapshot());
  const log = () => page.evaluate(() => window.ra2Store?.getLog().slice(-40) ?? []);
  const shot = (name) => page.screenshot({ path: path.join(opts.shots, `${name}.png`) });
  const fail = async (why) => {
    console.error("FAIL:", why);
    console.error("state:", JSON.stringify(await state()));
    console.error((await log()).join("\n"));
    console.error(lines.slice(-10).join("\n"));
    await shot("failure").catch(() => {});
    await browser.close();
    process.exit(1);
  };

  /** Where a point in the game's own pixels is in the window (the canvas shows them letterboxed). */
  const windowPoint = (x, y) =>
    page.evaluate(
      ([gx, gy]) => {
        const c = document.querySelector("canvas");
        const size = window.ra2Store?.getSnapshot().size;
        const width = size?.w ?? c.width;
        const height = size?.h ?? c.height;
        const r = c.getBoundingClientRect();
        const scale = Math.min(r.width / width, r.height / height);
        return {
          x: r.left + (r.width - width * scale) / 2 + (gx + 0.5) * scale,
          y: r.top + (r.height - height * scale) / 2 + (gy + 0.5) * scale,
        };
      },
      [x, y],
    );
  const moveGame = async (x, y) => {
    const point = await windowPoint(x, y);
    await page.mouse.move(point.x, point.y);
  };
  /** The right button down at (x, y), the mouse moved to (x2, y2) in ten steps, held there, then released. */
  const rdrag = async (x, y, x2, y2, holdMs = 2000) => {
    const a = await windowPoint(x, y);
    const b = await windowPoint(x2, y2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button: "right" });
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(holdMs);
    await page.mouse.up({ button: "right" });
  };
  const clickGame = async (x, y, button = "left") => {
    const point = await windowPoint(x, y);
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y, { button, delay: Number(process.env.HOLD_MS ?? 80) }); // a person holds the button for a moment
  };

  // `dev`: straight to Play with the dev server's game folder, not the Import and Library screens
  const url = new URL(opts.url);
  if (opts.testGame) url.searchParams.set("test", "1");
  else if (!opts.noDev) url.searchParams.set("dev", "1");
  for (const arg of opts.pageArgs) url.searchParams.append("arg", arg);
  await page.goto(url.toString());
  const started = Date.now();

  const waitFor = async (what, done, seconds = 600) => {
    let last = "";
    for (;;) {
      const s = await state();
      const text = `${s?.phase} ${s?.loading ?? ""}`;
      if (what && text !== last) {
        last = text;
        console.log(`${((Date.now() - started) / 1000).toFixed(0)}s  ${text}`);
      }
      if (done(s)) return s;
      if (s?.phase === "crashed" || s?.phase === "exited")
        await fail(`the game ${s.phase}: ${s.error ?? ""}`);
      if (Date.now() - started > seconds * 1000) await fail(`timed out waiting for ${what}`);
      await page.waitForTimeout(500);
    }
  };

  return {
    browser,
    page,
    lines,
    all,
    state,
    log,
    shot,
    fail,
    clickGame,
    moveGame,
    rdrag,
    waitFor,
    started,
  };
}

/** How much of the canvas is lit, and how many distinct frames it showed: is it drawing? */
export function picture(page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    let sum = 0;
    const step = 4 * 97;
    for (let i = 0; i < d.length; i += step) {
      if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
      sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0;
    }
    return { w: c.width, h: c.height, sampled: Math.floor(d.length / step), lit, checksum: sum };
  });
}
