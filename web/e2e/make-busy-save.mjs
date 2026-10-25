// Makes the busy save game that perf.mjs loads (docs/web/testing.md, "The frame benchmark"): a Team
// Alliance skirmish on the eight-player map Territorial Imperative (2-8), the human with three allied
// Brutal AIs against four, game speed 5 (the setup screen's normal speed), played for --minutes, then saved
// through the game's own Save Game menu. The save is copied out of the game's file system.
//
//   node e2e/make-busy-save.mjs [--minutes 4] [--out work/perf/busy.sav]
//                               [--profile work/perf/profile-fresh] [--shots DIR] [--headed]
//
// STATUS: BLOCKED. Two attempts at the save with speed 5 and four minutes of play: the battle ran with the
// human alive, but the save did not happen. Attempt 1 opened the in-game menu at 800x600 (its sidebar buttons
// are not where the 1280x720 menu's are) and the save step clicked the wrong places. Attempt 2 clicked the
// 800x600 positions, but the menu was at 1280x720 by then. The 1280x720 positions that worked in an earlier
// session are Save Game (1194, 289), the first slot (560, 200), Save (1194, 239). Screenshots: the scratchpad's
// busy-shots5 and busy-shots6 folders. See docs/web/testing.md.
//
// It needs the imported Yuri's Revenge in --profile: perf.mjs's first run imports the game folder (game/).
// Relative --out and --profile paths are the repo root's. Screenshots go to --shots.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
const minutes = Number(flag("--minutes", 4));
const out = path.resolve(repo, flag("--out", "work/perf/busy.sav"));
const profile = path.resolve(repo, flag("--profile", "work/perf/profile-fresh"));
const shots = path.resolve(flag("--shots", "e2e/shots/busy-save"));
mkdirSync(shots, { recursive: true });
mkdirSync(path.dirname(out), { recursive: true });

const base = { ...options(argv), profile, shots, testGame: null, gameBuild: null };
const started = Date.now();
const log = (line) => console.log(`${((Date.now() - started) / 1000).toFixed(0)}s  ${line}`);

const t = await openGame(base, { video: "1280x720" });
await setUpBusySkirmish(t, { log });
await startBattle(t);
log("battle started");

// the match: every 30 s the game's frame rate; a picture at the start and every minute
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
    nextShot += 60_000;
  }
  log(`game ${s?.fps ?? 0} fps, phase ${s?.phase}`);
  await t.page.waitForTimeout(Math.min(30_000, Math.max(1000, end - Date.now())));
}

// the game's own save. With Escape the game shows its menu at 800x600 (the sidebar buttons at 713 across:
// Game Controls 383, Load 423, Save 463 in window pixels at 1.6x), so the game coordinates are 800x600's.
await t.page.keyboard.press("Escape");
await t.page.waitForTimeout(2500);
await t.shot("save-0-menu");
await t.clickGame(712, 289); // Save Game
await t.page.waitForTimeout(2500);
await t.shot("save-1-list");
await t.clickGame(350, 167); // the first slot (estimated for 800x600)
await t.page.waitForTimeout(1500);
await t.shot("save-2-slot");
await t.clickGame(712, 239); // Save (estimated for 800x600)
await t.page.waitForTimeout(2000);
await t.shot("save-3-after-save");
// the box that follows the save: its OK button (800x600: a 451x328 box at the centre)
await t.clickGame(546, 433);
await t.page.waitForTimeout(1500);
await t.shot("save-4-after-ok");

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
if (!existsSync(out)) throw new Error(`${out} was not written`);
