// Temporary WDT capture probe: reach the faction screen and click a side with
// HLE_NETTRACE=1, then dump every native line. Not a committed test.
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
opts.noDev = true;
opts.pageArgs.push("--debuglog", "--env", "HLE_NETTRACE=1");
if (process.env.WDT_MSGTRACE) opts.pageArgs.push("--env", "HLE_MSGTRACE=1");
if (process.env.WDT_MANGLER_ECHO) opts.pageArgs.push("--env", "WDT_MANGLER_ECHO=1");
if (process.env.WDT_INJECT) opts.pageArgs.push("--env", `RA2_WDT_CLICK=${process.env.WDT_INJECT}`);
if (opts.testGame) {
  // `?test=1` streams the game folder; the import allowlist omits the exe, so
  // hand it the same file the installer would have imported.
  opts.gameFileOverrides = { "game.exe": readFileSync(path.resolve("../game/game.exe")) };
}
const run = await startPage(opts);

async function waitDialog(id, after = run.all.length, ms = 60000) {
  const deadline = Date.now() + ms;
  while (!run.all.slice(after).some((l) => l.includes(`[dialog] open ${id}`))) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for dialog ${id}`);
    await run.page.waitForTimeout(200);
  }
}
async function login() {
  const state = await run.page.evaluate(() => window.ra2Store?.getSnapshot() ?? null);
  // The WOL login dialog is laid out per edition and screen size. RA2's
  // fields sit higher than YR's on the same 800x600 shell.
  const yuri = (state?.title ?? "").toLowerCase().includes("yuri");
  const [x, y0, y1] = yuri ? [401, 254, 297] : [398, 167, 205];
  const [submitX, submitY] = yuri ? [706, 220] : [720, 220];
  for (const [y, text] of [
    [y0, process.env.WOL_TEST_USER ?? "woltst9"],
    [y1, process.env.WOL_TEST_PASSWORD ?? "wolpass1"],
  ]) {
    await run.clickGame(x, y);
    await run.page.keyboard.press("End");
    for (let i = 0; i < 16; i++) await run.page.keyboard.press("Backspace");
    await run.page.keyboard.type(text, { delay: 60 });
    await run.page.waitForTimeout(200);
  }
  await run.clickGame(submitX, submitY);
}
try {
  if (!opts.testGame) {
    await run.page.getByRole("heading", { name: "Your games" }).waitFor({ timeout: 60000 });
    const installation = run.page.locator('[data-slot-id="1"]');
    const ra2Edition = installation.getByRole("radio", { name: "Red Alert 2" });
    if (await ra2Edition.count()) await ra2Edition.click();
    const card = run.page.locator('[data-slot-id="1"] [data-game-id="ra2"]');
    await card.getByRole("button", { name: "Play" }).click();
  }
  await run.waitFor("main menu", (s) => s?.phase === "running", 180);
  console.log(
    "wdt hooks",
    await run.page.evaluate(() => [
      typeof globalThis.ra2WdtState,
      typeof globalThis.Module?.ra2WdtState,
      typeof globalThis.Module?.ra2WolStart,
    ]),
  );
  await run.page.waitForTimeout(3000);
  await run.clickGame(720, Number(process.env.WDT_MAIN_Y ?? 263)); // Internet
  await waitDialog("0x10E");
  await run.page.waitForTimeout(1500);
  await run.clickGame(720, 263); // Login
  await waitDialog("0x10F");
  await run.page.waitForTimeout(2000);
  await run.shot("login-dialog");
  await login();
  await waitDialog("0x113");
  await run.page.waitForTimeout(4000);
  await run.shot("lobby-113");
  await run.clickGame(720, 348); // World Domination on the WOL profile screen
  await run.page.waitForTimeout(3000);
  // It may ask for login again.
  if (run.all.some((l) => l.includes("[dialog] open 0x10F"))) {
    await login();
    await run.page.waitForTimeout(4000);
  }
  if (run.all.some((l) => l.includes("[dialog] open 0xFB"))) {
    await run.clickGame(707, 204); // Yes, change to 640x480
    await run.page.waitForTimeout(4000);
  }
  await run.page.waitForTimeout(3000);
  await run.shot("faction");
  await run.clickGame(190, 115); // Allied
  const afterClickDialogs = new Set();
  for (let i = 0; i < 20; i++) {
    await run.page.waitForTimeout(3000);
    await run.shot(`tick${i}`);
    for (const line of run.all) {
      const match = /\[dialog\] open (0x[0-9A-F]+)/.exec(line);
      if (match) afterClickDialogs.add(match[1]);
    }
  }
  if (process.env.WDT_ESCAPE) {
    await run.page.keyboard.press("Escape");
    await run.page.waitForTimeout(1000);
    await run.shot("after-escape");
  }
  if (process.env.WDT_BACK) {
    // WDT map Back (640 art: BackButtonRectangle=490,415,136,25) returns to
    // the side-select screen; its Back leaves World Domination.
    await run.clickGame(558, 427);
    await run.page.waitForTimeout(2500);
    await run.shot("after-wdt-back");
    await run.clickGame(558, 427);
    await run.page.waitForTimeout(2500);
    await run.shot("after-wdt-back2");
    // The WOL main menu's "Main Menu" button returns to the game shell, whose
    // own (configured) display size is restored on the way out.
    await run.clickGame(555, 432);
    await run.page.waitForTimeout(3000);
    await run.shot("after-wol-main-menu");
    // After the 800x600 restore the WOL menu is laid out at 800; its Main Menu
    // button is then at the 800x600 position and returns to the game shell.
    await run.clickGame(719, 557);
    await run.page.waitForTimeout(3000);
    await run.shot("after-shell-menu");
  }
  if (process.env.WDT_FIGHT) {
    const [x, y] = process.env.WDT_FIGHT.split(",").map(Number);
    await run.clickGame(x, y);
    await run.page.waitForTimeout(900);
    await run.clickGame(x, y);
    await run.page.waitForTimeout(4000);
    await run.shot("territory-fight");
    console.log("territory fight phase", (await run.state())?.phase);
  }
  if (process.env.WDT_DBLCLICK) {
    const [x, y] = process.env.WDT_DBLCLICK.split(",").map(Number);
    await run.page.mouse.dblclick(x, y);
    await run.page.waitForTimeout(4000);
    await run.shot("territory-dblclick");
    const lines = run.all.filter((line) => /WDT|Match|match|STARTG|GAMEOPT|dialog/i.test(line));
    console.log("territory dblclick dialogs", JSON.stringify(lines.slice(-20)));
    console.log("territory dblclick phase", (await run.state())?.phase);
  }
  if (process.env.WDT_CLICK) {
    const [x, y] = process.env.WDT_CLICK.split(",").map(Number);
    await run.page.mouse.move(x, y);
    await run.page.mouse.down();
    await run.page.waitForTimeout(300);
    await run.page.mouse.up();
    await run.page.waitForTimeout(4000);
    await run.shot("territory-click");
    const lines = run.all.filter((line) => /WDT|Match|match|STARTG|GAMEOPT|dialog/i.test(line));
    console.log("territory click dialogs", JSON.stringify(lines.slice(-20)));
    console.log("territory phase", (await run.state())?.phase);
  }
  if (process.env.WDT_CLICK_GAME) {
    const points = process.env.WDT_CLICK_GAME.split(";").map((pair) => pair.split(",").map(Number));
    for (const [x, y] of points) {
      await run.clickGame(x, y);
      await run.page.waitForTimeout(3000);
    }
    await run.page.waitForTimeout(2000);
    await run.shot("territory-click-game");
    const lines = run.all.filter((line) => /WDT|Match|match|STARTG|GAMEOPT|dialog/i.test(line));
    console.log("territory game click dialogs", JSON.stringify(lines.slice(-20)));
    console.log("territory game phase", (await run.state())?.phase);
  }

  if (process.env.WDT_HOLD) {
    const seconds = Number(process.env.WDT_HOLD);
    for (let elapsed = 0; elapsed < seconds; elapsed += 5) {
      await run.page.waitForTimeout(5000);
      await run.shot(`hold-${elapsed + 5}`);
    }
  }

  if (process.env.WDT_OK) {
    const [x, y] = process.env.WDT_OK.split(",").map(Number);
    await run.clickGame(x, y);
    await run.page.waitForTimeout(5000);
    await run.shot("after-ok");
  }

  const serverCurrent = run.all.some((line) => line.includes("[wdt] server state current"));
  const serverPrevious = run.all.some((line) => line.includes("[wdt] server state previous"));
  const unable = run.all.some((line) => line.includes("[dialog] open 0xD0"));
  const mapScreen = afterClickDialogs.has("0x125");
  const phase = (await run.state())?.phase;
  await run.shot("wdt-screen");
  console.log(
    "wdt evidence",
    JSON.stringify({
      serverCurrent,
      serverPrevious,
      unable,
      mapScreen,
      phase,
      dialogs: [...afterClickDialogs],
    }),
  );
  if (!serverCurrent || !serverPrevious) throw new Error("WDT server state was not delivered");
  if (unable) throw new Error("the client opened the 0xD0 unable-to-connect dialog");
  if (!mapScreen) throw new Error("the side click did not open the WDT map screen (0x125)");
  if (phase !== "running") throw new Error(`the game left the running phase: ${phase}`);
} finally {
  writeFileSync(path.join(opts.shots, "game.log"), run.all.join("\n"));
  writeFileSync(path.join(opts.shots, "browser.log"), run.lines.join("\n"));
  await run.browser.close();
}
