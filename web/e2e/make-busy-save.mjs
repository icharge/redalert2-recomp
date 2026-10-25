// Makes the busy save game that perf.mjs loads (docs/web/testing.md, "The frame benchmark"). A Team
// Alliance skirmish on the eight-player map Territorial Imperative (2-8): the human with three allied
// Brutal AIs against four, game speed at its maximum, let run for --minutes, then saved through the
// game's own Save Game menu, the save copied out of the game's file system.
//
// STATUS: BLOCKED. Two attempts failed: the human's side was eliminated at 1:39 (Free For All) and at
// 8:08 (Team Alliance) of game time, and the game then froze on its Skirmish Score screen, where the save
// step hung. The MCV deploy (selected by a click on the middle pad, then D) was not logged as a DEPLOY order
// in the game log (--debuglog), so the human is not defended, and the script stops there. See
// docs/web/testing.md.
//
//   node e2e/make-busy-save.mjs [--minutes 10] [--out work/perf/busy.sav]
//                               [--profile work/perf/profile] [--shots DIR] [--headed]
//
// It needs the imported Yuri's Revenge in --profile: perf.mjs's first run imports the game folder
// (game/) into it. Relative --out and --profile paths are the repo root's.
// Screenshots every two minutes go to --shots, so the army can be looked at.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { options } from "./lib.mjs";
import { openGame, setUpBusySkirmish, startBattle } from "./perf-nav.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const minutes = Number(flag("--minutes", 10));
const out = path.resolve(repo, flag("--out", "work/perf/busy.sav"));
const profile = path.resolve(repo, flag("--profile", "work/perf/profile"));
const shots = path.resolve(flag("--shots", "e2e/shots/busy-save"));
mkdirSync(shots, { recursive: true });
mkdirSync(path.dirname(out), { recursive: true });

// --debuglog makes the game log its orders ("Adding event DEPLOY"), which the MCV deploy is checked against
const base = { ...options(argv), profile, shots, pageArgs: ["--debuglog"] };
const video = "1280x720";
const t = await openGame(base, { video });
const log = (line) => console.log(`${((Date.now() - started) / 1000).toFixed(0)}s  ${line}`);
const started = Date.now();
await setUpBusySkirmish(t, { log });
await startBattle(t);
log("battle started");
// the base is centred with H; the MCV is the large vehicle on the middle pad (game pixels, 1280x720).
// It is selected by a click and deployed with D; the game logs the order, which is checked.
await t.moveGame(640, 360);
await t.page.waitForTimeout(800);
await t.page.keyboard.press("h");
await t.page.waitForTimeout(1500);
const orders = t.all.length;
await t.clickGame(555, 330);
await t.page.waitForTimeout(1000);
await t.page.keyboard.press("d");
let deployed = false;
for (let waited = 0; waited < 20_000 && !deployed; waited += 250) {
  deployed = t.all.slice(orders).some((line) => line.includes("Adding event DEPLOY"));
  if (!deployed) await t.page.waitForTimeout(250);
}
log(deployed ? "the MCV deploy was logged" : "the MCV deploy was not logged");
await t.shot("after-deploy");
if (!deployed) await t.fail("the MCV did not deploy: no DEPLOY order in the game log");

// the match: every 30 s a line of the game's frame rate; every 2 minutes a picture
const end = Date.now() + minutes * 60_000;
let nextShot = Date.now();
let shotNo = 0;
while (Date.now() < end) {
  const s = await t.state();
  if (s?.phase === "crashed" || s?.phase === "exited") await t.fail(`the game ${s.phase}`);
  if (Date.now() >= nextShot) {
    await t.shot(
      `busy-${String(shotNo++).padStart(2, "0")}-${Math.round((Date.now() - started) / 60_000)}min`,
    );
    nextShot += 120_000;
  }
  log(`game ${s?.fps ?? 0} fps, phase ${s?.phase}`);
  await t.page.waitForTimeout(30_000);
}

// the game's own save: Escape opens its menu, Save Game, the first slot, Save
await t.page.keyboard.press("Escape");
await t.page.waitForTimeout(2500);
await t.clickGame(1194, 289); // Save Game, in the sidebar
await t.page.waitForTimeout(2500);
await t.clickGame(560, 200); // the first slot
await t.page.waitForTimeout(1500);
await t.clickGame(1194, 239); // Save
await t.page.waitForTimeout(2000);
await t.shot("save-after-save");
// the box that follows the save (as save.mjs): its OK button
const box = { w: 451, h: 328 };
const size = { w: 1280, h: 720 };
await t.clickGame(
  Math.round((size.w - box.w) / 2 + 310 + 62),
  Math.round((size.h - box.h) / 2 + 285 + 12),
);
await t.page.waitForTimeout(1500);
await t.shot("save-after-ok");

const saved = await t.page.evaluate(() => {
  const fs = window.Module.FS;
  const name = fs
    .readdir("/game")
    .filter((n) => /^SAVE\d+\.sav$/i.test(n))
    .sort()
    .at(-1);
  if (!name) return null;
  const bytes = fs.readFile(`/game/${name}`);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name, base64: btoa(binary), size: bytes.length };
});
if (!saved) await t.fail("the game wrote no saved game");
writeFileSync(out, Buffer.from(saved.base64, "base64"));
log(`saved ${saved.name} (${saved.size} bytes) to ${out}`);
await t.browser.close();
