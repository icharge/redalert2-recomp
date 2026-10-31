// Import the local game folder into a persistent Chrome profile so the WDT
// probe can start from OPFS (the capture probe does not re-import).
import path from "node:path";
import { chromium } from "playwright-core";

const gameDir = path.resolve(process.argv[2] ?? "../game");
const profile = path.resolve(process.argv[3] ?? "../work/perf/wdt-profile");
const browser = await chromium.launchPersistentContext(profile, {
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
  viewport: { width: 1280, height: 960 },
  serviceWorkers: "block",
});
const page = browser.pages()[0] ?? (await browser.newPage());
await page.goto("http://127.0.0.1:5173/");
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
