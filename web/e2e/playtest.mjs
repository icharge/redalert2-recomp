// One tools/playtest.py case against the built page. Game files are fulfilled only
// inside this isolated browser context; the web server never hosts the install.
import { chromium } from "playwright-core";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { serveGame } from "./files-server.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { game, output, seconds, every, args } = config;
await mkdir(output, { recursive: true });
const log = createWriteStream(path.join(output, "run.log"));
const line = (text) => log.write(`${text}\n`);
const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
let browser;
let filesServer;
let code = 1;
try {
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: !config.headed,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 },
    serviceWorkers: "block",
  });
  // Test mode (?test=1) fulfils every game file from `game` into the page's memory, which the
  // published build's memory cap cannot hold. `import` runs the launcher's own path instead:
  // the folder is imported into OPFS and the game reads it in place (needs the dev server,
  // which exposes window.ra2Store).
  if (!config.import) {
    filesServer = await serveGame(game, new URL(config.url).origin);
    await filesServer.route(context);
  }
  const page = await context.newPage();
  let menuAt = 0;
  let ended = false;
  await page.exposeFunction("ra2Tap", (text) => {
    line(text);
    if (text.startsWith("@ra2 ")) {
      const event = JSON.parse(text.slice(5));
      if (event.e === "menu" && !menuAt) menuAt = Date.now();
      if (event.e === "exit") {
        code = event.code;
        ended = true;
      }
    }
  });
  page.on("pageerror", (error) => {
    line(`=== browser: ${error.message}`);
    ended = true;
    code = 3;
  });
  page.on("crash", () => {
    line("=== browser renderer crashed");
    ended = true;
    code = 3;
  });
  page.on("console", (message) => {
    if (message.type() === "error") line(`[browser] ${message.text()}`);
  });
  let url = new URL(config.url);
  if (config.import) {
    await page.goto(url.toString());
    await page.getByRole("heading", { name: "Your games" }).waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Import a folder…" }).click();
    await page.locator('input[type="file"]').setInputFiles(game);
    await page.getByText(/^Found /).waitFor({ timeout: 120_000 });
    await page.getByRole("button", { name: /^Import / }).click();
    await page.locator('[data-slot-id="1"]').waitFor({ timeout: 900_000 });
    const installation = page.locator('[data-slot-id="1"]');
    const edition = installation.getByRole("radio", {
      name: config.target === "game" ? "Red Alert 2" : "Yuri's Revenge",
    });
    if (await edition.count()) await edition.click();
    const card = installation.locator(
      `[data-game-id="${config.target === "game" ? "ra2" : "yr"}"]`,
    );
    await card.getByRole("button", { name: "Play" }).click();
    await page.waitForURL(/\/game\/1(?:\?|$)/, { timeout: 30_000 });
    url = new URL(page.url());
  } else {
    url.searchParams.set("test", "1");
    url.searchParams.set("target", config.target ?? "gamemd");
  }
  for (const arg of ["--mute", "--debuglog", ...args]) url.searchParams.append("arg", arg);
  await page.goto(url.toString());
  const started = Date.now();
  let nextShot = 0;
  let shot = 0;
  while (!ended) {
    const state = await page.evaluate(() => window.ra2Store?.getSnapshot());
    if (state?.phase === "crashed") throw new Error(state.error);
    if (state?.phase === "exited") {
      code = state.exitCode ?? 0;
      break;
    }
    const elapsed = menuAt ? (Date.now() - menuAt) / 1000 : 0;
    if (menuAt && elapsed >= nextShot) {
      await page.locator('canvas[aria-label="The game"]').screenshot({
        path: path.join(output, `frame_${String(shot++).padStart(4, "0")}.png`),
        timeout: 10000,
      });
      nextShot += Math.max(every, seconds / 16);
    }
    if (menuAt && elapsed >= seconds) {
      code = 4;
      break;
    }
    if (!menuAt && Date.now() - started > 300000)
      throw new Error("timed out reaching the main menu");
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: path.join(output, "last.png") });
  await writeFile(
    path.join(output, "state.json"),
    JSON.stringify(await page.evaluate(() => window.ra2Store?.getSnapshot()), null, 2),
  );
} catch (error) {
  line(`=== browser runner: ${error.stack ?? error}`);
  code = 3;
} finally {
  await browser?.close();
  if (filesServer) {
    await filesServer.close();
  }
  await new Promise((resolve) => log.end(resolve));
}
// A timed run is the native watchdog's 4, evaluated by the shared Python scorer.
process.exitCode = code;
