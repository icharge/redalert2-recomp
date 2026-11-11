// What the game's screen change looks like, frame by frame, for the game-drawn finder (src/web/finder_screen.c, built with
// -DRA2_FINDER_NATIVE=ON): opens Customize Battle, presses Find, then Back, and saves a screenshot every ~30 ms for each press
// as e2e/shots/tr-<press>-<ms since the click>.jpg. Nothing is asserted: the frames are for looking at (docs/web/shell-screens.md,
// "Looking at a transition"). A good change reads: the old screen stays up while the right-hand sidebar retracts, then the dark
// map, then the new screen with its sidebar sliding in.
//
//   node e2e/finder-transition.mjs --url "http://127.0.0.1:5173/?mute" --game E:/Games/Westwood/RA2 --build ../build-proto2/out
//
// FRAMES (default 50) is how many screenshots are taken for each press.
import { options, startPage } from "./lib.mjs";

const frameCount = Number(process.env.FRAMES ?? 50);
const opts = options(process.argv.slice(2));
const t = await startPage(opts);
await t.waitFor("the main menu", (s) => s?.phase === "running");
const sleep = (ms) => t.page.waitForTimeout(ms);
await sleep(3000);
await t.clickGame(719, 221); // Single Player
await sleep(4000);
await t.clickGame(720, 305); // Skirmish
await sleep(4000);
await t.clickGame(720, 305); // Customize Battle
await sleep(4000);

const frames = [];
/** Presses with `press`, and takes screenshots as fast as the page gives them until `frameCount` are in. */
async function burst(name, press) {
  const began = Date.now();
  const pressed = press();
  for (let i = 0; i < frameCount; i++) {
    const image = await t.page.screenshot({ type: "jpeg", quality: 60, scale: "css" });
    frames.push([name, Date.now() - began, image]);
  }
  await pressed;
}
await burst("find", () => t.clickGame(719, 305)); // Find
await sleep(3000);
await burst("back", () => t.clickGame(719, 557)); // Back

const { writeFileSync } = await import("node:fs");
for (const [name, ms, image] of frames)
  writeFileSync(`${opts.shots}/tr-${name}-${String(ms).padStart(5, "0")}.jpg`, image);
console.log(`${frames.length} frames in ${opts.shots} (tr-find-*, tr-back-*)`);
await t.browser.close();
process.exit(0);
