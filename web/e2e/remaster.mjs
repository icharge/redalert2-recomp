// W9: exercise the real import, host settings, persistence and F9 restart in
// Chromium. Artifacts and the reusable OPFS profile stay under work/.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { options } from "./lib.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const opts = options(argv);
const output = path.resolve(option("--output", "../work/web-remaster"));
const gameDir = path.resolve(option("--game", "../game"));
mkdirSync(path.join(output, "fixture", "WebTest"), { recursive: true });
copyFileSync(
  path.join(gameDir, "KeyboardMD.ini"),
  path.join(output, "fixture", "WebTest", "KeyboardMD.ini"),
);
const context = await chromium.launchPersistentContext(path.join(output, "profile"), {
  executablePath: opts.chrome,
  headless: !opts.headed,
  serviceWorkers: "block",
  args: ["--no-sandbox"],
  viewport: { width: 1280, height: 960 },
});
try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.exposeFunction("ra2Tap", (line) =>
    appendFileSync(path.join(output, "run.log"), `${line}\n`),
  );
  page.on("pageerror", (error) => console.error(error));
  const url = new URL(opts.url);
  url.searchParams.set("e2e", "1");
  url.searchParams.append("arg", "--debuglog");
  url.searchParams.append("arg", "--heartbeat");
  url.searchParams.append("arg", "3");
  url.searchParams.append("arg", "--windows");
  await page.goto(url.toString());
  await page.getByText(/Bring your game|Your games/, { exact: true }).waitFor();
  if (await page.getByText("Bring your game", { exact: true }).isVisible()) {
    await page.getByLabel("Game folder").setInputFiles(gameDir);
    await page.getByRole("button", { name: /^Import / }).waitFor({ timeout: 120000 });
    await page.getByRole("button", { name: /^Import / }).click();
    await page.getByText("Your games", { exact: true }).waitFor({ timeout: 300000 });
  }
  await page.getByRole("button", { name: "Mods…" }).click();
  if (!(await page.getByText(/^WebTest ·/).isVisible())) {
    await page.getByLabel("Mod folder").setInputFiles(path.join(output, "fixture", "WebTest"));
    await page.getByText(/WebTest imported/).waitFor();
  }
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const running = () =>
    page.waitForFunction(() => window.ra2Store?.getSnapshot().phase === "running", null, {
      timeout: 180000,
    });
  const snapshot = () => page.evaluate(() => window.ra2Store.getSnapshot());
  await running();
  await page.waitForTimeout(3000);
  await page.keyboard.press("F10");
  await page.getByRole("dialog", { name: "Game settings" }).waitFor();
  await page.getByRole("combobox", { name: "Scaling" }).click();
  await page.getByRole("option", { name: "Nearest", exact: true }).click();
  await page.getByRole("combobox", { name: "Resolution", exact: true }).click();
  await page.getByRole("option", { name: "1280 × 720", exact: true }).click();
  const hd = page.getByRole("switch", { name: "HD vehicles", exact: true });
  if ((await hd.getAttribute("data-state")) !== "checked") await hd.click();
  const modern = page.getByRole("switch", { name: "Modern controls and Queue Five" });
  if ((await modern.getAttribute("data-state")) !== "checked") await modern.click();
  await page.waitForFunction(() => {
    const s = window.ra2Store.getSnapshot().settings;
    return s?.scale === "nearest" && s.width === 1280 && s.height === 720 && s.hd && s.modern;
  });
  await page.screenshot({ path: path.join(output, "settings.png") });
  await page.getByRole("button", { name: "Fullscreen (F11)" }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.getByRole("button", { name: "Leave fullscreen" }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.bringToFront();
  console.log(
    "Pointer request",
    await page.evaluate(() => ({
      focused: document.hasFocus(),
      connected: document.querySelector('canvas[aria-label="The game"]').isConnected,
      visibility: document.visibilityState,
    })),
  );
  await page.getByRole("button", { name: "Lock pointer for edge scrolling" }).click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.mouse.move(400, 300);
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => !document.pointerLockElement);
  await page.waitForTimeout(5000);
  await page.reload();
  await page.getByRole("button", { name: "Play", exact: true }).waitFor();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await running();
  const saved = (await snapshot()).settings;
  assert.equal(saved.scale, "nearest");
  assert.equal(saved.hd, true);
  assert.equal(saved.modern, true);
  assert.equal(saved.width, 1280);
  assert.equal(saved.height, 720);
  console.log("PASS F10 host settings, persistence, fullscreen, Pointer Lock");
  // F9 restarts the runtime only from the main menu, after its saves have flushed.
  await page.waitForTimeout(3000);
  await page.keyboard.press("F9");
  await page.waitForEvent("load", { timeout: 30000 });
  await running();
  await page.waitForFunction(() => window.ra2Store.getSnapshot().settings?.mod === "WebTest");
  await page.screenshot({ path: path.join(output, "mod-active.png") });
  assert.ok(
    await page.evaluate(() =>
      window.ra2Store.getLog().some((line) => line.includes("[mods] playing WebTest")),
    ),
  );
  console.log("PASS mod folder import, F9 switch, restart and persisted overlay");
} finally {
  const page = context.pages()[0];
  if (page) {
    await page.screenshot({ path: path.join(output, "last.png") }).catch(() => {});
    console.log(
      "Final state",
      await page.evaluate(() => window.ra2Store?.getSnapshot()).catch(() => null),
    );
  }
  await context.close();
}
