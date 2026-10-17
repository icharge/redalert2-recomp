// Shared by the local end-to-end checks: a Chrome on the dev server's page, the game's
// state, screenshots, and clicks in the game's own pixels.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import path from "node:path";

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
  };
}

export async function startPage(opts) {
  mkdirSync(opts.shots, { recursive: true });
  const browser = await chromium.launch({
    executablePath: opts.chrome,
    headless: !opts.headed,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  const lines = [];
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
        const r = c.getBoundingClientRect();
        const scale = Math.min(r.width / c.width, r.height / c.height);
        return {
          x: r.left + (r.width - c.width * scale) / 2 + (gx + 0.5) * scale,
          y: r.top + (r.height - c.height * scale) / 2 + (gy + 0.5) * scale,
        };
      },
      [x, y],
    );
  const moveGame = async (x, y) => {
    const point = await windowPoint(x, y);
    await page.mouse.move(point.x, point.y);
  };
  const clickGame = async (x, y, button = "left") => {
    const point = await windowPoint(x, y);
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y, { button });
  };

  const query = opts.pageArgs.map((a) => `arg=${encodeURIComponent(a)}`).join("&");
  await page.goto(opts.url + (query ? `?${query}` : ""));
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

  return { browser, page, lines, state, log, shot, fail, clickGame, moveGame, waitFor, started };
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
