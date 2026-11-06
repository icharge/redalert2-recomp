// Browser RA2 resolution regression: import a game with a saved campaign, persist
// an older RA2.INI, choose a launcher size, then load the save from OPFS.
//
//   node e2e/resolution-load-saved.mjs --game ../game \
//     --save-zip ../work/runtime-resolution-load/saves.zip \
//     --url http://127.0.0.1:4173/ --shots ../work/runtime-resolution-load/shots
import { chromium } from "playwright-core";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseEdition, installIfMissing, openTab, options, playButton } from "./lib.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const gameDir = path.resolve(flag("--game", "../game"));
const saveZip = path.resolve(flag("--save-zip", "../work/runtime-resolution-load/saves.zip"));
const base = options(argv);
const persistentProfile = flag("--profile", null);
const profile = persistentProfile
  ? path.resolve(persistentProfile)
  : mkdtempSync(path.join(os.tmpdir(), "ra2-resolution-load-"));
if (persistentProfile) mkdirSync(profile, { recursive: true });
const target = { w: 1280, h: 720 };
const context = await chromium.launchPersistentContext(profile, {
  executablePath: base.chrome,
  headless: !base.headed,
  args: ["--no-sandbox"],
  viewport: { width: 1280, height: 960 },
  serviceWorkers: "block",
});
let failed = false;
let page;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  failed ||= !ok;
};

try {
  page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("console.error:", message.text());
  });
  await page.goto(base.url);
  console.log("    importing into OPFS...");
  await installIfMissing(page, gameDir);
  console.log("    the game is in the rail");

  await chooseEdition(page, "ra2");
  await openTab(page, "GAME");
  console.log("    importing the campaign save...");
  await page.getByLabel("Saves for Red Alert 2").setInputFiles(saveZip);
  await page
    .getByRole("status")
    .filter({ hasText: /saved game.*brought in/i })
    .waitFor({ timeout: 30_000 });
  console.log("    opening launcher settings...");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("link", { name: "VIDEO" })
    .click();
  await page.getByRole("radio", { name: "Fixed" }).click();
  await page.getByRole("combobox", { name: "Size" }).selectOption(`${target.w}x${target.h}`);
  await openTab(page, "PLAY");
  const preference = await page.evaluate(
    () => Object.entries(localStorage).find(([key]) => key.startsWith("ra2.video.")) ?? null,
  );
  check(Boolean(preference), "the launcher stores the selected 1280x720 size");

  const play = playButton(page);
  check(await play.isEnabled(), "the imported Red Alert 2 build is playable");
  await play.click();
  console.log("    clicked Play; current URL:", page.url());
  await page.waitForURL(/\/game\/1(?:\?|$)/, { timeout: 30_000 });
  const gameUrl = new URL(page.url());
  const gameArgs = [
    "--press",
    "0xE2:1667@1",
    "--press",
    "0x100:1673@2",
    "--select",
    "0xB7:1317=0@3",
    "--press",
    "0xB7:1039@4",
    "--waitlog",
    "Capture_Mouse@5",
    // The page's own Escape only releases the pointer; the guest key opens the game menu.
    "--waitlog",
    "- Complete@6",
    "--key",
    "0x1B@12",
  ];
  for (const arg of gameArgs) gameUrl.searchParams.append("arg", arg);
  await page.goto(gameUrl.toString());
  await page.waitForFunction(() => window.ra2Store?.getSnapshot().phase === "running", null, {
    timeout: 900_000,
  });
  await page.waitForFunction(
    ([w, h]) => {
      const size = window.ra2Store?.getSnapshot().size;
      return size?.w === w && size?.h === h;
    },
    [target.w, target.h],
    { timeout: 240_000 },
  );
  await page.screenshot({ path: path.join(base.shots, "loaded-game.png") });
  const loaded = await page.evaluate(() => ({
    size: window.ra2Store?.getSnapshot().size,
    log: (window.ra2Store?.getLog() ?? []).filter((line) =>
      /Toggle display mode|SetDisplayMode/.test(line),
    ),
  }));
  check(
    loaded.size?.w === target.w && loaded.size?.h === target.h,
    "loading the saved game switches to 1280x720",
  );
  check(
    loaded.log.some((line) => /1280 ?X ?720|1280x720/i.test(line)),
    "the game log confirms the target display mode",
  );
  await page.waitForTimeout(20_000);
  await page.screenshot({ path: path.join(base.shots, "pause-menu.png") });
  console.log("    loaded game:", JSON.stringify(loaded));
} catch (error) {
  console.error(error);
  if (page) {
    console.error(
      "page:",
      (
        await page
          .locator("body")
          .innerText()
          .catch(() => "<unavailable>")
      ).slice(-2000),
    );
    await page.screenshot({ path: path.join(base.shots, "failure.png") }).catch(() => {});
  }
  failed = true;
} finally {
  await context.close();
  if (!persistentProfile && !argv.includes("--keep-profile"))
    rmSync(profile, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log("Browser RA2 saved-game resolution check passed");
