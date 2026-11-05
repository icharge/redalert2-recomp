// Temporary: screenshot the WOL game-type menu (0x10E) and the custom-match
// lobby (0x113) so the WDT button can be located precisely.
import { readFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
opts.noDev = true;
opts.pageArgs.push("--debuglog", "--mute");
opts.gameFileOverrides = { "game.exe": readFileSync(path.resolve("../game/game.exe")) };
const run = await startPage(opts);

async function waitDialog(id, ms = 90000) {
  const deadline = Date.now() + ms;
  while (!run.all.some((l) => l.includes(`[dialog] open ${id}`))) {
    if (Date.now() > deadline) throw new Error(`timeout ${id}`);
    await run.page.waitForTimeout(200);
  }
}
try {
  await run.waitFor("main menu", (s) => s?.phase === "running", 240);
  await run.page.waitForTimeout(3000);
  await run.clickGame(720, 263); // Internet
  await waitDialog("0x10E");
  await run.page.waitForTimeout(2000);
  await run.shot("menu-10E");
  const size = await run.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const rect = canvas?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null;
  });
  console.log("canvas", JSON.stringify(size));
} finally {
  await run.browser.close();
}
