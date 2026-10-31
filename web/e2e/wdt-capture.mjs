// Temporary WDT capture probe: reach the faction screen and click a side with
// HLE_NETTRACE=1, then dump every native line. Not a committed test.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
opts.noDev = true;
opts.pageArgs.push("--mute", "--debuglog", "--env", "HLE_NETTRACE=1");
const run = await startPage(opts);

async function waitDialog(id, after = 0, ms = 60000) {
  const deadline = Date.now() + ms;
  while (!run.all.slice(after).some((l) => l.includes(`[dialog] open ${id}`))) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for dialog ${id}`);
    await run.page.waitForTimeout(200);
  }
}
async function login(y0, y1) {
  for (const [y, text] of [
    [y0, process.env.WOL_TEST_USER ?? "woltst9"],
    [y1, process.env.WOL_TEST_PASSWORD ?? "wolpass1"],
  ]) {
    await run.clickGame(388, y);
    await run.page.keyboard.press("End");
    for (let i = 0; i < 16; i++) await run.page.keyboard.press("Backspace");
    await run.page.keyboard.type(text, { delay: 60 });
    await run.page.waitForTimeout(200);
  }
  await run.clickGame(720, 220);
}
try {
  if ((await run.state())?.phase === "idle") {
    await run.page.waitForTimeout(1000);
    await run.page.mouse.click(480, 421); // Red Alert 2 tab
    await run.page.waitForTimeout(500);
    await run.page.mouse.click(898, 505); // Play
  }
  await run.waitFor("main menu", (s) => s?.phase === "running", 180);
  await run.page.waitForTimeout(1500);
  await run.clickGame(720, 263); // Internet
  await waitDialog("0x10E");
  await run.page.waitForTimeout(800);
  await run.clickGame(720, 263); // Login
  await waitDialog("0x10F");
  await run.page.waitForTimeout(1000);
  await login(167, 205);
  await waitDialog("0x113");
  await run.page.waitForTimeout(2500);
  await run.clickGame(707, 557); // Back to WOL welcome
  await waitDialog("0x10E");
  await run.page.waitForTimeout(1200);
  await run.clickGame(720, 348); // World Domination
  await run.page.waitForTimeout(2000);
  // It may ask for login again.
  if (run.all.some((l) => l.includes("[dialog] open 0x10F"))) {
    await login(167, 205);
    await run.page.waitForTimeout(4000);
  }
  if (run.all.some((l) => l.includes("[dialog] open 0xFB"))) {
    await run.clickGame(707, 204); // Yes, change to 640x480
    await run.page.waitForTimeout(4000);
  }
  await run.page.waitForTimeout(3000);
  await run.shot("faction");
  await run.clickGame(190, 115); // Allied
  await run.page.waitForTimeout(4000);
  await run.shot("clicked");
} finally {
  writeFileSync(path.join(opts.shots, "game.log"), run.all.join("\n"));
  writeFileSync(path.join(opts.shots, "browser.log"), run.lines.join("\n"));
  await run.browser.close();
}
