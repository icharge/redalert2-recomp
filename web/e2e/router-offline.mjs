// The production service worker must serve clean routes under a context path offline.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { options } from "./lib.mjs";

const opts = options(process.argv.slice(2));
const browser = await chromium.launch({ executablePath: opts.chrome, args: ["--no-sandbox"] });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(opts.url);
  await page.getByRole("heading", { name: "Your games" }).waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.reload();
  await page.getByRole("heading", { name: "Your games" }).waitFor();
  const keptBuild = await page.evaluate(async () => {
    const base = new URL((await navigator.serviceWorker.ready).scope).pathname;
    const response = await (
      await caches.open(`ra2-meta-${encodeURIComponent(base)}`)
    ).match(`${base}game/build.json`);
    return !!response;
  });
  assert.ok(keptBuild, "the launcher must retain build metadata for offline route loading");
  await context.setOffline(true);
  const direct = new URL("game/999", opts.url);
  await page.goto(direct.toString());
  await page.getByText("That installation was not found.", { exact: true }).waitFor();
  const home = page.getByRole("link", { name: "Back to launcher" });
  assert.equal(await home.getAttribute("href"), new URL(opts.url).pathname);
  await home.click();
  await page.getByRole("heading", { name: "Your games" }).waitFor();
  console.log("PASS: offline direct routes and launcher links retain the deployment context path.");
} finally {
  await browser.close();
}
