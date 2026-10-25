// Exercises real browser Pointer Lock without a server or game assets.
import { chromium } from "playwright-core";
import { transformWithEsbuild } from "vite";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const out = path.resolve("work/auto-pointer-test");
await mkdir(out, { recursive: true });
const { code } = await transformWithEsbuild(
  await readFile(new URL("../src/game/browser-controls.ts", import.meta.url), "utf8"),
  "browser-controls.ts",
  { format: "iife", globalName: "BrowserControls", target: "es2022" },
);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.setContent(
    '<canvas width="600" height="400" style="background:#123" tabindex="0"></canvas>',
  );
  await page.addScriptTag({ content: code });
  await page.evaluate(() => {
    window.capture = BrowserControls.autoLockPointer(document.querySelector("canvas"));
    window.capture.update(true);
  });
  const automaticCapture = await page.evaluate(() => !!document.pointerLockElement);
  if (!automaticCapture) await page.mouse.click(100, 100);
  await page.waitForFunction(
    () => document.pointerLockElement === document.querySelector("canvas"),
  );
  const checks = { automaticCapture, gameplayCaptures: true };
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.pointerLockElement);
  checks.escapeReleases = true;
  await page.evaluate(() => {
    for (let i = 0; i < 60; i++) window.capture.update(true);
  });
  if (await page.evaluate(() => !!document.pointerLockElement))
    throw new Error("Recaptured without a new click");
  checks.unlockIsRespected = true;
  await page.evaluate(() => window.capture.update(false)); // Game reports the pause cursor.
  await page.mouse.click(100, 100);
  if (await page.evaluate(() => !!document.pointerLockElement))
    throw new Error("Captured on pause-menu click");
  checks.pauseMenuStaysUnlocked = true;
  await page.evaluate(() => window.capture.update(true)); // Resume returns to gameplay.
  if (!(await page.evaluate(() => !!document.pointerLockElement))) await page.mouse.click(100, 100);
  await page.waitForFunction(() => !!document.pointerLockElement);
  checks.resumeRecaptures = true;
  await page.evaluate(() => window.capture.update(false));
  await page.waitForFunction(() => !document.pointerLockElement);
  await page.mouse.click(100, 100);
  if (await page.evaluate(() => !!document.pointerLockElement))
    throw new Error("Captured in settings/menu");
  checks.settingsAndMenusRelease = true;
  await page.evaluate(() => window.capture.dispose());
  await writeFile(path.join(out, "report.json"), JSON.stringify(checks, null, 2));
  console.log(JSON.stringify(checks, null, 2));
} finally {
  await browser.close();
}
