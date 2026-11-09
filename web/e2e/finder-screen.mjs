// The game-drawn finder screen (src/web/finder_screen.c, a prototype): Find opens it, Back closes it. Needs a
// build with -DRA2_FINDER_NATIVE=ON; screenshots finder-1 and finder-2-after-back, and the [finder] log lines.
//
//   node e2e/finder-screen.mjs --url "http://127.0.0.1:5180/?mute" --game E:/Games/Westwood/RA2 --build ../build-native/out
import { options, startPage } from "./lib.mjs";
const t = await startPage(options(process.argv.slice(2)));
await t.waitFor("the main menu", (s) => s?.phase === "running");
const sleep = (ms) => t.page.waitForTimeout(ms);
await sleep(3000);
await t.clickGame(719, 221);
await sleep(4000);
await t.clickGame(720, 305);
await sleep(4000);
await t.clickGame(720, 305);
await sleep(4000);
await t.clickGame(719, 305);
await sleep(3000); // Find
await t.moveGame(400, 560);
await sleep(500);
await t.shot("finder-1");
await t.clickGame(719, 557);
await sleep(2500); // Back
await t.moveGame(400, 560);
await sleep(500);
await t.shot("finder-2-after-back");
const log = await t.page.evaluate(() => window.ra2Store.getLog());
console.log(
  (Array.isArray(log) ? log : String(log).split("\n"))
    .filter((l) => /\[finder\]|\[hle\]|crash|fatal|unimplemented/i.test(String(l)))
    .join("\n"),
);
await t.browser.close();
