// The game's Find Maps button (under Random Map on Customize Battle): one press is one mapFinder event.
//
//   node e2e/maps-button.mjs --url "http://127.0.0.1:5180/?mute" --game E:/Games/Westwood/RA2 --build ../build-proto2/out
import { options, startPage } from "./lib.mjs";

const t = await startPage(options(process.argv.slice(2)));
await t.waitFor("the main menu", (s) => s?.phase === "running");
const sleep = (ms) => t.page.waitForTimeout(ms);
const presses = async () => (await t.state()).mapFinderRequests;

await sleep(3000);
await t.clickGame(719, 221); // Single Player
await sleep(4000);
await t.clickGame(720, 305); // Skirmish
await sleep(4000);
await t.clickGame(720, 305); // Customize Battle
await sleep(4000);
await t.moveGame(400, 520);
await sleep(800);
await t.shot("btn-1-customize-battle");
const before = await presses();
await t.clickGame(719, 305); // Find Maps
await sleep(1500);
const after = await presses();
console.log("presses before:", before, "after one click:", after);
await t.shot("btn-2-after-click");
await t.browser.close();
process.exit(after - before === 1 ? 0 : 1);
