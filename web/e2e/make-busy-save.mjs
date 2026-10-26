// Makes the busy save game that perf.mjs loads (docs/web/testing.md, "The frame benchmark"): a Team
// Alliance skirmish on the eight-player map Territorial Imperative (2-8), the human and six Brutal AIs on team
// A against one Easy AI on team B, game speed 5 (the setup screen's normal speed). The human deploys its MCV
// and then does nothing; the allied AIs build up for --minutes, the camera is scrolled to a busy place
// (--scroll), and the game's own Save Game menu saves it. The save is copied out of the game's file system.
//
//   node e2e/make-busy-save.mjs [--minutes 5] [--scroll "ArrowUp=2000,ArrowRight=1500"]
//                               [--out work/perf/busy.sav] [--profile work/perf/profile-fresh]
//                               [--shots DIR] [--headed]
//
// --scroll holds arrow keys for the milliseconds given, in order, once the minutes are over. The players'
// start positions are random, so where the busiest base is differs from match to match: look at the
// screenshots in --shots (one a minute, and "busy-view.png", the picture that is saved) and run it again with
// a --scroll that suits, or scroll by hand in the headed window while --minutes runs.
//
// In a battle the page locks the pointer, which makes the mouse relative to where the game last had it, so
// clicks at game positions miss (perf-nav.mjs syncPointer); every click here goes through it. The in-game menu
// (Escape) is laid out for the picture's size: the positions below are those of 1280x720, found from its
// screenshots (Save Game 1194,289; Save 1194,239; the "Mission Saved" box's OK 787,493), and the script stops
// when the battle is at another size.
//
// It needs the imported Yuri's Revenge in --profile: perf.mjs's first run imports the game folder (game/).
// Relative --out and --profile paths are the repo root's. Screenshots go to --shots.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { options } from "./lib.mjs";
import {
  openGame,
  setResolution,
  setUpBusySkirmish,
  startBattle,
  syncPointer,
} from "./perf-nav.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);

const VALUE_FLAGS = new Set(["--minutes", "--scroll", "--out", "--profile", "--shots", "--url"]);
const BOOLEAN_FLAGS = new Set(["--headed"]);
for (let i = 0; i < argv.length; i++) {
  if (BOOLEAN_FLAGS.has(argv[i])) continue;
  if (VALUE_FLAGS.has(argv[i])) {
    if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`);
    i++;
    continue;
  }
  throw new Error(
    `unknown argument ${argv[i]} (see the usage at the top of e2e/make-busy-save.mjs)`,
  );
}
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const minutes = Number(flag("--minutes", 5));
const scroll = flag("--scroll", "")
  .split(",")
  .filter(Boolean)
  .map((step) => {
    const [key, ms] = step.split("=");
    if (!/^Arrow(Up|Down|Left|Right)$/.test(key) || !(Number(ms) > 0))
      throw new Error(`--scroll ${step}: use ArrowUp|ArrowDown|ArrowLeft|ArrowRight=milliseconds`);
    return { key, ms: Number(ms) };
  });
const out = path.resolve(repo, flag("--out", "work/perf/busy.sav"));
const profile = path.resolve(repo, flag("--profile", "work/perf/profile-fresh"));
const shots = path.resolve(flag("--shots", "e2e/shots/busy-save"));
mkdirSync(shots, { recursive: true });
mkdirSync(path.dirname(out), { recursive: true });

const base = { ...options(argv), profile, shots, testGame: null, gameBuild: null };
const started = Date.now();
const log = (line) => console.log(`${((Date.now() - started) / 1000).toFixed(0)}s  ${line}`);

let t = null;
try {
  t = await openGame(base, { video: "1280x720" });
  await setResolution(t, { w: 1280, h: 720 });
  await setUpBusySkirmish(t, { log });
  await startBattle(t);
  log("battle started");
  const battleSize = (await t.state())?.size;
  if (battleSize?.w !== 1280 || battleSize?.h !== 720)
    throw new Error(`the battle reports ${battleSize?.w}x${battleSize?.h}, not 1280x720`);

  // the MCV: a box around the middle of the picture selects it (the camera starts on it), D deploys it
  await dragBox(150, 150, 950, 650);
  await t.page.waitForTimeout(500);
  await t.page.keyboard.press("d");
  await t.page.waitForTimeout(8000);
  await t.shot("busy-deployed");
  log("MCV deploy sent (busy-deployed.png shows the base)");

  // the match: every 30 s the game's frame rate; a picture at the start and every minute
  const end = Date.now() + minutes * 60_000;
  let nextShot = Date.now();
  let shotNo = 0;
  while (Date.now() < end) {
    const s = await t.state();
    if (s?.phase === "crashed" || s?.phase === "exited") throw new Error(`the game ${s.phase}`);
    if (Date.now() >= nextShot) {
      await t.shot(`busy-${String(shotNo++).padStart(2, "0")}`);
      nextShot += 60_000;
    }
    log(`game ${s?.fps ?? 0} fps, phase ${s?.phase}`);
    await t.page.waitForTimeout(Math.min(30_000, Math.max(1000, end - Date.now())));
  }
  if ((await t.state())?.fps === 0) throw new Error("the match has ended (no game frames)");

  // the camera
  for (const { key, ms } of scroll) {
    await t.page.keyboard.down(key);
    await t.page.waitForTimeout(ms);
    await t.page.keyboard.up(key);
    await t.page.waitForTimeout(400);
  }
  await t.shot("busy-view");

  // the game's own save: Escape (it also releases the pointer), the menu's Save Game, Save, the box's OK
  const before = await saveNames();
  await t.page.keyboard.press("Escape");
  await t.page.waitForTimeout(2500);
  await t.shot("save-0-menu");
  const menuSize = (await t.state())?.size;
  if (menuSize?.w !== 1280 || menuSize?.h !== 720)
    throw new Error(`the in-game menu is at ${menuSize?.w}x${menuSize?.h}, not 1280x720`);
  await t.clickGame(1194, 289); // Save Game
  await t.page.waitForTimeout(2500);
  await t.shot("save-1-list"); // the empty slot is selected already
  await t.clickGame(1194, 239); // Save
  await t.page.waitForTimeout(2500);
  await t.shot("save-2-saved");
  await t.clickGame(787, 493); // the box's OK
  await t.page.waitForTimeout(2000);
  await t.shot("save-3-after-ok");

  const saved = await t.page.evaluate((known) => {
    const fs = window.Module.FS;
    const name = fs
      .readdir("/game")
      .filter((n) => /^SAVE[0-9A-F]+\.SAV$/i.test(n) && !known.includes(n))
      .sort()
      .at(-1);
    if (!name) return null;
    const bytes = fs.readFile(`/game/${name}`);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { name, base64: btoa(binary), size: bytes.length };
  }, before);
  if (!saved) throw new Error("the game wrote no saved game");
  writeFileSync(out, Buffer.from(saved.base64, "base64"));
  log(`saved ${saved.name} (${saved.size} bytes) to ${out}`);
} catch (error) {
  console.error(`FAILED: ${error?.stack ?? error}`);
  await t?.shot("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await t?.browser.close().catch(() => {});
}
if (!process.exitCode && !existsSync(out)) throw new Error(`${out} was not written`);

/** A left-button drag of a box, in game pixels, from a pointer the game sees where it was put. */
async function dragBox(x1, y1, x2, y2) {
  await syncPointer(t, x1, y1);
  await t.page.mouse.down();
  await t.moveGame((x1 + x2) / 2, (y1 + y2) / 2);
  await t.moveGame(x2, y2);
  await t.page.waitForTimeout(200);
  await t.page.mouse.up();
}

function saveNames() {
  return t.page.evaluate(() =>
    window.Module.FS.readdir("/game").filter((n) => /^SAVE[0-9A-F]+\.SAV$/i.test(n)),
  );
}
