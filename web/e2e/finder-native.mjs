// The game-drawn finder screen end to end (src/web/finder_screen.c, built with -DRA2_FINDER_NATIVE=ON): type a name in
// its search box, press Search, pick the first result, press Add, then Back, and open the finder a second time.
// Needs the dev server (its /maps-api/ route reaches mapdb2.cncnet.org).
//
// Fails unless: the finder is a screen of its own (map_search.c does not take it for a map screen and give it a search box
// and a Find button), the map scan waits for Back (the game does not stand still while the finder is up), the scan then
// finds one more map, Customize Battle lists it, and Find opens the finder again.
//
//   node e2e/finder-native.mjs --url "http://127.0.0.1:5180/?mute" --game E:/Games/Westwood/RA2 --build ../build-proto2/out
import { options, startPage } from "./lib.mjs";

const FIRST_ROW_Y = Number(process.env.FIRST_ROW_Y ?? 158);
const query = process.env.QUERY ?? "Dustbowl";
const t = await startPage(options(process.argv.slice(2)));
await t.waitFor("the main menu", (s) => s?.phase === "running");
const sleep = (ms) => t.page.waitForTimeout(ms);
/** Where the first game line matching `pattern` is, at or after `from`; -1 when there is none. */
const line = (pattern, from = 0) => t.all.findIndex((l, i) => i >= from && pattern.test(String(l)));
const count = (pattern) => t.all.filter((l) => pattern.test(String(l))).length;

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
await t.clickGame(150, FIRST_ROW_Y); // the first row
await sleep(700);
await t.clickGame(719, 263); // Add
await sleep(8000);
await t.moveGame(400, 560);
await sleep(500);
await t.shot("fn-4-added");
const scansWhileOpen = count(/\[maps\] rescan/);
await t.clickGame(719, 557); // Back
await sleep(4000);
await t.shot("fn-5-back");
// the map is in Customize Battle's own list: its search box finds it by a word no stock map has
await t.clickGame(435, 136);
await sleep(500);
await t.page.keyboard.type(process.env.LISTED_AS ?? "battleground", { delay: 120 });
await sleep(1500);
await t.shot("fn-5b-listed");
const listed = (await t.state())?.mapSearchStatus;
await t.clickGame(719, 305); // Find, a second time
await sleep(3000);
await t.shot("fn-6-again");

console.log(
  t.all.filter((l) => /\[finder\]|\[maps\]|crash|fatal|unimplemented/i.test(String(l))).join("\n"),
);
const problems = [];
const opened = line(/\[finder\] dialog/);
const closed = line(/\[finder\] closed/);
if (opened < 0) problems.push("the finder did not open");
if (count(/Find Maps button .* settled/) !== 1)
  problems.push("the finder was taken for a map screen (a second Find Maps button was settled)");
if (scansWhileOpen !== 0) problems.push("the maps were scanned while the finder was up");
const scan =
  closed < 0
    ? null
    : String(t.all[line(/\[maps\] rescan/, closed)] ?? "").match(/: (\d+) -> (\d+)/);
if (!scan) problems.push("no map scan after Back");
else if (Number(scan[2]) !== Number(scan[1]) + 1)
  problems.push(`the scan found ${scan[1]} -> ${scan[2]} maps, not one more`);
if (!listed?.open || listed.noMatches)
  problems.push("the added map is not in Customize Battle's list");
if (closed < 0 || line(/\[finder\] dialog/, closed) < 0)
  problems.push("Find did not open the finder a second time");
if ((await t.state())?.phase !== "running") problems.push("the game is not running");
await t.browser.close();
if (problems.length) {
  console.error(`FAIL: ${problems.join("; ")}`);
  process.exit(1);
}
console.log("ok");
process.exit(0);
