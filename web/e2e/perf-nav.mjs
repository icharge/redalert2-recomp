// The menu steps perf.mjs and make-busy-save.mjs share: the main menu to a battle, at a given picture
// size. Coordinates are the game's own 800x600 menu pixels (lib.mjs's clickGame takes them), as
// measure.mjs and save.mjs use them. Screens are checked by screenshot (docs/web/testing.md).
//
// The game is the Yuri's Revenge installation in the persistent profile (perf.mjs's --profile), opened
// at its own route, so its large files are read in place from OPFS (the page's dev and test folders
// copy every file into memory, which Yuri's Revenge does not fit in the 768 MB limit).
import { readFileSync } from "node:fs";
import { picture, startPage } from "./lib.mjs";

/** The game's address for an installation's Yuri's Revenge, at a picture size (or the game's own). */
export function gameUrl(base, video, stats = true) {
  const url = new URL(base.url);
  url.pathname = `${url.pathname.replace(/\/?$/, "/")}game/1`;
  url.searchParams.set("edition", "ra2md");
  if (video) url.searchParams.set("video", video);
  if (stats) url.searchParams.set("stats", "1");
  return url.toString();
}

/** Opens the game at its route with the persistent profile and waits for the main menu. */
export async function openGame(base, { video, shots, headed } = {}) {
  const t = await startPage({
    ...base,
    headed: headed ?? base.headed,
    shots: shots ?? base.shots,
    noDev: true,
    url: gameUrl(base, video),
  });
  try {
    await t.waitFor("the main menu", (s) => s?.phase === "running", 300);
  } catch (error) {
    await t.browser.close().catch(() => {});
    throw error;
  }
  return t;
}

/**
 * Waits until `done(state)` holds, up to `seconds` from now. (lib.mjs's waitFor counts from the page's start, so
 * a wait made late in a long run, such as the soak's reload, would time out at once.)
 */
export async function waitState(t, what, done, seconds) {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const s = await t.state();
    if (done(s)) return s;
    if (s?.phase === "crashed" || s?.phase === "exited")
      await t.fail(`the game ${s.phase} while waiting for ${what}: ${s.error ?? ""}`);
    if (Date.now() > until) await t.fail(`timed out waiting for ${what}`);
    await t.page.waitForTimeout(500);
  }
}

/** Wait for the menu's own music and drawing to settle (the splash and the first frames). */
export async function settle(t, ms = 6000) {
  await t.page.waitForTimeout(ms);
}

export const at = {
  singlePlayer: [719, 221],
  // Single Player's buttons
  skirmish: [720, 305],
  // Skirmish Game: Start Game and Customize Battle
  startGame: [719, 263],
  customizeBattle: [719, 304],
  // Customize Battle: the engagement (Free For All) and the map list's down arrow
  teamAlliance: [155, 173],
  mapListDown: [524, 462],
  territorialImperative: [411, 459],
  useMap: [719, 220],
  // Single Player: Load Saved Game; the Load Mission screen: the first save in the list and Load
  loadSavedGame: [719, 263],
  firstSave: [300, 135],
  loadSave: [719, 221],
  // Skirmish Game: the first "None" row's dropdown arrow; a row's dropdown lists None, Easy, Medium
  // and Brutal, Brutal being the item 92 game pixels below the arrow
  shortGameToggle: [80, 296],
  gameSpeedLeft: [406, 296], // the slider's left end: 0
  gameSpeedFive: [462, 296], // the handle at 5, the game's normal speed (the setup screen's default)
};

/** The 8 player rows' dropdown arrows, rows 2 to 8 in the Skirmish Game screen (row 1 is the human). */
export const rowArrows = [95, 121, 147, 173, 199, 226, 252].map((y) => [199, y]);

/** The rows' team dropdown arrows are at x 574, the same y as the row's player dropdown. */
export const teamArrowX = 574;

/**
 * The skirmish for the busy save: Team Alliance on the eight-player map "Territorial Imperative (2-8)", the
 * human (row 1) and six Brutal AIs (rows 2 to 7) on team A, one Easy AI (row 8) alone on team B, game speed 5,
 * Short Game off. Nothing threatens the human, so the match lasts while the allied AIs build up (Free For
 * All lost the idle human at 1:39, and four against four ended it at 2:14 to 8:08). Assumes the main menu is
 * up. Ends on the Skirmish Game screen.
 */
export async function setUpBusySkirmish(t, { log = console.log } = {}) {
  await settle(t, 5000);
  await t.clickGame(...at.singlePlayer);
  await t.page.waitForTimeout(4000);
  await t.clickGame(...at.skirmish);
  await t.page.waitForTimeout(4000);
  await t.clickGame(...at.customizeBattle);
  await t.page.waitForTimeout(4000);
  await t.clickGame(...at.teamAlliance);
  await t.page.waitForTimeout(1500);
  // scroll the map list to the eight-player maps, then take the map at the arrow-down position
  for (let i = 0; i < 130; i++) {
    await t.clickGame(...at.mapListDown);
    await t.page.waitForTimeout(40);
  }
  await t.page.waitForTimeout(800);
  await t.clickGame(...at.territorialImperative);
  await t.page.waitForTimeout(1500);
  await t.clickGame(...at.useMap);
  await t.page.waitForTimeout(4000);
  // players: a row's dropdown lists None, Easy, Medium, Brutal, Brutal being 92 game pixels below the arrow
  // and Easy 46 (the list's rows are 23 apart)
  for (const [i, [x, y]] of rowArrows.entries()) {
    const easy = i === rowArrows.length - 1;
    await t.clickGame(x, y);
    await t.page.waitForTimeout(800);
    await t.clickGame(x - 105, y + (easy ? 46 : 92));
    await t.page.waitForTimeout(800);
  }
  // teams: the dropdown lists A, B, C, D, the item 22 game pixels below the arrow for A, 44 for B. The AI rows
  // start on D: rows 2 to 7 go to A, row 8 to B.
  for (const [i, [, y]] of rowArrows.entries()) {
    await t.clickGame(teamArrowX, y);
    await t.page.waitForTimeout(800);
    await t.clickGame(teamArrowX, y + (i === rowArrows.length - 1 ? 44 : 22));
    await t.page.waitForTimeout(800);
  }
  await t.clickGame(...at.shortGameToggle);
  await t.page.waitForTimeout(800);
  await setGameSpeedFive(t);
  log(
    "skirmish set: Team Alliance, Territorial Imperative (2-8), the human and 6 Brutal AIs on team A, 1 Easy AI on team B, game speed 5, Short Game off",
  );
}

/**
 * The game speed set to 5 on the Skirmish Game screen: the slider goes to 0 at its left end, then a click at
 * the handle's 5 position sets 5. The early skirmish and the busy save both use this, so no setting carries over.
 */
export async function setGameSpeedFive(t) {
  await t.clickGame(...at.gameSpeedLeft);
  await t.page.waitForTimeout(800);
  await t.clickGame(...at.gameSpeedFive);
  await t.page.waitForTimeout(800);
}

/** From the Skirmish Game screen to the battle. */
export async function startBattle(t) {
  await t.clickGame(...at.startGame);
  await t.waitFor("the battle", (s) => (s?.fps ?? 0) > 0, 240);
  await t.page.waitForTimeout(5000); // the load's own frames are over
}

/** Where the busy save is put in the game's file system: the game lists every SAVE*.SAV there. */
export const SAVE_NAME = "SAVE0001.SAV";

/**
 * The busy save's load: the save is written into the game's file system, then the game's own screens are used
 * (Single Player, Load Saved Game, the save in the list, Load). Assumes the main menu is up, at the size set by
 * setResolution. Returns when the battle runs: the game's frame rate is above 0 for three samples in a row and the
 * picture changes between them. A screenshot, busy-loaded.png, shows what was loaded.
 */
export async function loadBusySave(t, savePath, { log = console.log } = {}) {
  const base64 = readFileSync(savePath).toString("base64");
  await t.page.evaluate(
    ([name, text]) => {
      const bin = atob(text);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      window.Module.FS.writeFile(`/game/${name}`, bytes);
    },
    [SAVE_NAME, base64],
  );
  await settle(t, 3000);
  await t.clickGame(...at.singlePlayer);
  await t.page.waitForTimeout(3000);
  await t.clickGame(...at.loadSavedGame);
  await t.page.waitForTimeout(3000);
  await t.clickGame(...at.firstSave); // the only save in the list
  await t.page.waitForTimeout(800);
  await t.clickGame(...at.loadSave);
  await waitState(t, "the loaded battle", (s) => (s?.fps ?? 0) > 0, 240);
  await t.page.waitForTimeout(5000); // the load's own frames are over
  const seen = [];
  for (let i = 0; i < 3; i++) {
    seen.push({ fps: (await t.state())?.fps ?? 0, picture: (await picture(t.page)).checksum });
    await t.page.waitForTimeout(1000);
  }
  await t.shot("busy-loaded");
  if (seen.some((x) => !(x.fps > 0)) || new Set(seen.map((x) => x.picture)).size < 2)
    await t.fail(`the loaded save does not run: ${JSON.stringify(seen)}`);
  log(`busy save loaded: ${seen.map((x) => x.fps).join(", ")} fps`);
}

/**
 * The sizes the game's own resolution setting accepts (src/web/settings.c). Nothing else sets a battle's size:
 * 3840x2160 through ?video= or a hand-edited RA2MD.INI was tried, and the battle still reported 1920x1080.
 */
export const RESOLUTIONS = [
  [800, 600],
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
];

/**
 * The picture size the game uses for its next battle: the game's own resolution setting (ra2_setting key 4),
 * which also writes RA2MD.INI. A launch's ?video= alone does not change the size a battle reports (it lagged
 * by one launch on a persistent profile), so every launch sets it at the menu, before any skirmish.
 */
export async function setResolution(t, size) {
  if (!RESOLUTIONS.some(([w, h]) => w === size.w && h === size.h))
    throw new Error(
      `${size.w}x${size.h}: the game's resolution setting does not accept this size (src/web/settings.c lists up to 2560x1440), and the battle would report another`,
    );
  await t.page.evaluate(
    ([w, h]) => window.Module.cwrap("ra2_setting", null, ["number", "number", "number"])(4, w, h),
    [size.w, size.h],
  );
  await t.page.waitForTimeout(1500);
}

/**
 * A pointer move to (x, y) in the game's pixels that the game sees there, in a battle. The page locks the
 * pointer in a battle, and a locked pointer is relative: the game moves it by the distance the mouse travelled,
 * from where the game last had it, so a click at a game position landed somewhere else (the cause of the busy
 * save's earlier misses: the MCV never selected, the in-game menu's buttons never hit). Releasing the lock
 * makes the next move absolute; a left click then locks the pointer again from that very spot.
 */
export async function syncPointer(t, x, y) {
  await t.page.evaluate(() => document.exitPointerLock());
  await t.page.waitForTimeout(200);
  await t.moveGame(x, y);
  await t.page.waitForTimeout(150);
}

/** A click at game pixels (x, y) in a battle (see syncPointer). */
export async function clickBattle(t, x, y, button = "left") {
  await syncPointer(t, x, y);
  await t.clickGame(x, y, button);
}
