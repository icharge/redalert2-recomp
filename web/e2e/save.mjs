// Issue 6 (docs/web/issues.md): start a skirmish, open the in-game menu (Esc), Save Game, Save, then
// shoot the screen every 400 ms. The message box that follows must show on the picture.
//
//   node e2e/save.mjs [--shots DIR]
//
// Game pixels: the battle runs at the size in the game's own settings (2580x1080 for the author's),
// so the in-game menu's buttons are found from the picture's width, not fixed numbers.
import { writeFileSync } from "node:fs";
import { options, startPage } from "./lib.mjs";

const t = await startPage(options(process.argv.slice(2)));
await t.waitFor("the main menu", (s) => s?.phase === "running");
const menuAt = Date.now();
const at = async (seconds) => {
  const wait = menuAt + seconds * Number(process.env.SLOW ?? 1) * 1000 - Date.now();
  if (wait > 0) await t.page.waitForTimeout(wait);
};
const click = (x, y) => t.clickGame(x, y);

await at(6);
await click(719, 221); // Single Player
await at(12);
await click(720, 305); // Skirmish
await at(18);
await click(719, 263); // Start Game
await at(52);
const size = await t.page.evaluate(() => {
  const c = document.querySelector("canvas");
  return { w: c.width, h: c.height };
});
console.log(`battle at ${size.w}x${size.h}`);
// the sidebar's menu buttons sit 3% in from the right edge; Save Game is the third
const bx = Math.round(size.w - 87 * (size.w / 2580));
await t.page.keyboard.press("Escape");
await at(55);
await t.shot("save-0-menu");
await click(bx, 288 * (size.h / 1080));
await at(59);
await t.shot("save-1-list");
await click(Math.round(size.w * 0.469), Math.round(size.h * 0.351)); // the first slot
await at(61);
await click(bx, 238 * (size.h / 1080)); // Save
for (let i = 0; i < 8; i++) {
  await t.page.waitForTimeout(400);
  await t.shot(`save-2-after-${i}`);
}
const log = await t.log();
console.log(
  log
    .filter((l) => /dialog/.test(l))
    .slice(-6)
    .join("\n"),
);
// LOG_FILE=path keeps the game's whole log, for a trace (--arg --msgtrace --arg HWND)
if (process.env.LOG_FILE)
  writeFileSync(
    process.env.LOG_FILE,
    (await t.page.evaluate(() => window.ra2Store?.getLog() ?? [])).join("\n"),
  );
await t.browser.close();
