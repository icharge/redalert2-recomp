// Makes the busy save game that perf.mjs loads (docs/web/testing.md, "The frame benchmark"). A Team
// Alliance skirmish on the eight-player map Territorial Imperative (2-8): the human with three allied
// Brutal AIs against four, game speed at its maximum, let run for --minutes, then saved through the
// game's own Save Game menu, the save copied out of the game's file system.
//
// STATUS: not yet reliable. The human's side was eliminated at 1:39 (Free For All) and at 8:08 (Team
// Alliance) of game time, the game then froze on its Skirmish Score screen, and the save step hung there.
// A 5-minute run also ended before its save (about 5 minutes wall clock). See docs/web/testing.md.
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

const base = { ...options(argv), profile, shots };
const video = "1280x720";
const t = await openGame(base, { video });
const log = (line) => console.log(`${((Date.now() - started) / 1000).toFixed(0)}s  ${line}`);
const started = Date.now();
await setUpBusySkirmish(t, { log });
await startBattle(t);
log("battle started");

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
