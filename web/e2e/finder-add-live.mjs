// Does the game stay alive while the game-drawn finder screen adds maps? (src/web/finder_screen.c, -DRA2_FINDER_NATIVE=ON)
// Searches, then adds the first ROWS results one after another. While each downloads it moves the mouse and watches two
// clocks: the page's own (a timer on the main thread) and the game's (its picture must follow the cursor). Fails if either
// stops for longer than STALL_MS. QUERY is the search ("" lists the newest maps, which are large), SLOW_KBPS a slow line
// for the downloads, WATCH how many quarter seconds each add is watched for.
//
//   node e2e/finder-add-live.mjs --url "http://127.0.0.1:5180/?mute" --game E:/Games/Westwood/RA2 --build ../build-proto2/out
import { options, picture, startPage } from "./lib.mjs";

const query = process.env.QUERY ?? "Dustbowl";
const rows = Number(process.env.ROWS ?? 3);
const stallMs = Number(process.env.STALL_MS ?? 1000);
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
await t.clickGame(325, 137); // the search box
await sleep(500);
await t.page.keyboard.type(query, { delay: 120 });
await sleep(500);
await t.clickGame(719, 221); // Search
await sleep(6000);
await t.shot("fl-0-results");

// the page's clock: the longest gap between two 50 ms timer ticks
await t.page.evaluate(() => {
  window.__gap = 0;
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    window.__gap = Math.max(window.__gap, now - last);
    last = now;
  }, 50);
});

// SLOW_KBPS: a slow line for the downloads (the search is done by now)
if (process.env.SLOW_KBPS) {
  const cdp = await t.page.context().newCDPSession(t.page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 300,
    downloadThroughput: Number(process.env.SLOW_KBPS) * 125,
    uploadThroughput: 50 * 125,
  });
}
t.page.on("requestfinished", (r) => {
  if (r.url().includes("/maps-api/yr/"))
    console.log(`  ${stamp()} downloaded ${r.url().slice(-16)}`);
});
t.page.on("requestfailed", (r) =>
  console.log(`  ${stamp()} FAILED ${r.url().slice(-40)} ${r.failure()?.errorText}`),
);
let seen = t.all.length;
const began = Date.now();
const stamp = () => `${((Date.now() - began) / 1000).toFixed(1)}s`;
const printNew = () => {
  for (; seen < t.all.length; seen++)
    if (/\[finder\]|\[maps\]|crash|fatal|unimplemented|abort|error/i.test(String(t.all[seen])))
      console.log(`  ${stamp()} ${t.all[seen]}`);
};
let worst = 0;
for (let row = 0; row < rows; row++) {
  const y = 158 + row * 19;
  console.log(`${stamp()} add row ${row}`);
  await t.clickGame(150, y);
  await sleep(500);
  await t.clickGame(719, 263); // Add
  // the game's clock: its picture changes when the cursor moves; count how long it does not
  let lastPicture = "";
  let still = 0;
  let lastChange = Date.now();
  for (let i = 0; i < Number(process.env.WATCH ?? 40); i++) {
    await t.moveGame(300 + (i % 2) * 150, 430 + (i % 3) * 30);
    await sleep(250);
    const now = await picture(t.page);
    const key = typeof now === "string" ? now : JSON.stringify(now);
    if (key !== lastPicture) {
      if (Date.now() - lastChange > 1000)
        console.log(`  ${stamp()} the picture moved again after ${Date.now() - lastChange} ms`);
      lastPicture = key;
      lastChange = Date.now();
    }
    still = Math.max(still, Date.now() - lastChange);
    printNew();
  }
  const gap = await t.page.evaluate(() => {
    const g = window.__gap;
    window.__gap = 0;
    return g;
  });
  console.log(
    `${stamp()} row ${row}: game still for ${still} ms at most, page timer gap ${gap.toFixed(0)} ms`,
  );
  worst = Math.max(worst, still, gap);
  await t.shot(`fl-${row + 1}-added`);
}
await t.clickGame(719, 557); // Back
await sleep(3000);
await t.shot("fl-9-back");
printNew();
const s = await t.state();
console.log(`phase ${s?.phase}, worst stall ${worst.toFixed(0)} ms`);
await t.browser.close();
process.exit(worst > stallMs || s?.phase !== "running" ? 1 : 0);
