// Screenshots on a timer from the page load, through a skirmish start, to see what the player
// sees while things load (docs/web/testing.md).
//
//   node e2e/timeline.mjs [--every 2] [--skirmish] [--seconds 60]
//
// Saves e2e/shots/timeline-NNN.png and prints the game's state with each.
import { options, startPage } from "./lib.mjs";

const argv = process.argv.slice(2);
const every = Number(argv[argv.indexOf("--every") + 1] || 2) * 1000;
const total = Number(argv[argv.indexOf("--seconds") + 1] || 60) * 1000;
const skirmish = argv.includes("--skirmish");

const t = await startPage(options(argv));
let n = 0;
let clicked = 0;
const t0 = Date.now();
const snap = async () => {
  const s = await t.state();
  const name = `timeline-${String(n++).padStart(3, "0")}`;
  await t.shot(name);
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${name} ${s?.phase} ${s?.loading ?? ""}`);
  return s;
};

let menuAt = 0;
while (Date.now() - t0 < total) {
  const s = await snap();
  if (s?.phase === "running" && !menuAt) menuAt = Date.now();
  if (skirmish && menuAt) {
    const since = (Date.now() - menuAt) / 1000;
    if (since > 3 && clicked === 0) (await t.clickGame(719, 221), (clicked = 1));
    else if (since > 6 && clicked === 1) (await t.clickGame(720, 305), (clicked = 2));
    else if (since > 10 && clicked === 2) (await t.clickGame(719, 263), (clicked = 3));
  }
  await t.page.waitForTimeout(every);
}
await t.browser.close();
