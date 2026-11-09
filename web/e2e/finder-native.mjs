// The game-drawn finder screen end to end (src/web/finder_screen.c, built with -DRA2_FINDER_NATIVE=ON): type a name in
// its search box, press Search, pick the first result, press Add, then Back, and see the map in the game's own list.
// Needs the dev server (its /maps-api/ route reaches mapdb2.cncnet.org).
//
//   node e2e/finder-native.mjs --url "http://127.0.0.1:5180/?mute" --game E:/Games/Westwood/RA2 --build ../build-proto2/out
import { options, startPage } from "./lib.mjs";

const query = process.env.QUERY ?? "Dustbowl";
const t = await startPage(options(process.argv.slice(2)));
await t.waitFor("the main menu", (s) => s?.phase === "running");
const sleep = (ms) => t.page.waitForTimeout(ms);
await sleep(3000);
await t.clickGame(719, 221); // Single Player
await sleep(4000);
await t.clickGame(720, 305); // Skirmish
await sleep(4000);
await t.clickGame(720, 305); // Customize Battle
await sleep(4000);
await t.clickGame(719, 305); // Find
await sleep(3000);
await t.shot("fn-1-open");
await t.clickGame(325, 137); // the search box
await sleep(500);
await t.page.keyboard.type(query, { delay: 150 });
await sleep(800);
await t.shot("fn-2-typed");
await t.clickGame(719, 221); // Search
await sleep(6000);
await t.moveGame(400, 560);
await sleep(500);
await t.shot("fn-3-results");
await t.clickGame(150, 184); // the first row
await sleep(700);
await t.clickGame(719, 263); // Add
await sleep(6000);
await t.moveGame(400, 560);
await sleep(500);
await t.shot("fn-4-added");
await t.clickGame(719, 557); // Back
await sleep(3000);
await t.shot("fn-5-back");
const log = await t.page.evaluate(() => window.ra2Store.getLog());
console.log(
  (Array.isArray(log) ? log : String(log).split("\n"))
    .filter((l) => /\[finder\]|\[maps\]|crash|fatal|unimplemented/i.test(String(l)))
    .join("\n"),
);
await t.browser.close();
process.exit(0);
