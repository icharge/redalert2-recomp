// Import the local game folder into a persistent Chrome profile so the WDT
// probe can start from OPFS (the capture probe does not re-import).
//
//   node e2e/wdt-import.mjs --url http://127.0.0.1:5176/ --game ../game \
//     --profile ../work/perf/wdt-e2e
import path from "node:path";
import { chromium } from "playwright-core";
import { options } from "./lib.mjs";

const opts = options(process.argv.slice(2));
const gameDir = path.resolve(opts.testGame ?? "../game");
const profile = path.resolve(opts.profile ?? "../work/perf/wdt-profile");
const browser = await chromium.launchPersistentContext(profile, {
  executablePath: opts.chrome,
  headless: !opts.headed,
  args: ["--no-sandbox"],
  viewport: { width: 1280, height: 960 },
  serviceWorkers: "block",
});
const page = browser.pages()[0] ?? (await browser.newPage());
await page.goto(opts.url);
await page.getByRole("heading", { name: "Your games" }).waitFor({ timeout: 60000 });
if (!(await page.locator('[data-slot-id="1"]').count())) {
  await page.getByRole("button", { name: /Import a folder/ }).click();
  await page.locator('input[type="file"]').setInputFiles(gameDir);
  await page.getByText(/^Found /).waitFor({ timeout: 300000 });
  console.log(await page.getByText(/^Found /).innerText());
  await page.getByRole("button", { name: /^Import / }).click();
  await page.locator('[data-slot-id="1"]').waitFor({ timeout: 900000 });
}
console.log("imported");
await browser.close();
