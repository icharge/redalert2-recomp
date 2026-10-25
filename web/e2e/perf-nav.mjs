// The menu steps perf.mjs and make-busy-save.mjs share: the main menu to a battle, at a given picture
// size. Coordinates are the game's own 800x600 menu pixels (lib.mjs's clickGame takes them), as
// measure.mjs and save.mjs use them. Screens are checked by screenshot (docs/web/testing.md).
//
// The game is the Yuri's Revenge installation in the persistent profile (perf.mjs's --profile), opened
// at its own route, so its large files are read in place from OPFS (the page's dev and test folders
// copy every file into memory, which Yuri's Revenge does not fit in the 768 MB limit).
import { startPage } from "./lib.mjs";

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
  await t.waitFor("the main menu", (s) => s?.phase === "running", 300);
  return t;
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
  // Skirmish Game: the first "None" row's dropdown arrow; a row's dropdown lists None, Easy, Medium
  // and Brutal, Brutal being the item 92 game pixels below the arrow
  shortGameToggle: [80, 296],
  gameSpeedLeft: [406, 296], // the slider's left end: 0
  gameSpeedFive: [462, 296], // the handle at 5, the game's normal speed (the setup screen's default)
};

/** The 8 player rows' dropdown arrows, rows 3 to 8 (rows 1 and 2 are the human and the Brutal AI). */
export const rowArrows = [121, 147, 173, 199, 226, 252].map((y) => [199, y]);

/** The team dropdown arrows of rows 2 to 4, the human's team-mates (game pixels, at x 574). */
export const teamRowsA = [95, 121, 147];

/**
 * The skirmish for the busy save: Team Alliance on the eight-player map "Territorial Imperative (2-8)",
 * the human (row 1) and three Brutal AIs (rows 2 to 4) on team A, four Brutal AIs (rows 5 to 8) on team
 * D, game speed at its maximum, Short Game off. Free For All (every AI against the human) lost the human
 * at 1:39 with no units built, so the human is allied. Assumes the main menu is up. Ends on the Skirmish
 * Game screen.
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
  for (const [x, y] of rowArrows) {
    await t.clickGame(x, y);
    await t.page.waitForTimeout(800);
    await t.clickGame(x - 105, y + 92); // Brutal Enemy in the dropdown
    await t.page.waitForTimeout(800);
  }
  // team A (the human's) for rows 2 to 4: the team dropdown's A item sits 22 game pixels below its arrow
  for (const y of teamRowsA) {
    await t.clickGame(574, y);
    await t.page.waitForTimeout(800);
    await t.clickGame(574, y + 22);
    await t.page.waitForTimeout(800);
  }
  await t.clickGame(...at.shortGameToggle);
  await t.page.waitForTimeout(800);
  await setGameSpeedFive(t);
  log(
    "skirmish set: Team Alliance, Territorial Imperative (2-8), 7 Brutal AIs (human + 3 on team A), game speed 5, Short Game off",
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

/**
 * The busy save's load (Single Player, Load Saved Game, the save, Load). Not available: no save could be made
 * (docs/web/testing.md, "The frame benchmark"), so this stops rather than guessing the load screen.
 */
export async function loadBusySave(t, savePath) {
  await t.browser.close().catch(() => {});
  throw new Error(
    `the busy save cannot be loaded yet: no save was made (${savePath}); see the task report`,
  );
}

/**
 * The picture size the game uses for its next battle: the game's own resolution setting (ra2_setting key 4),
 * which also writes RA2MD.INI. A launch's ?video= alone does not change the size a battle reports (it lagged
 * by one launch on a persistent profile), so every launch sets it at the menu, before any skirmish.
 */
export async function setResolution(t, size) {
  await t.page.evaluate(
    ([w, h]) => window.Module.cwrap("ra2_setting", null, ["number", "number", "number"])(4, w, h),
    [size.w, size.h],
  );
  await t.page.waitForTimeout(1500);
}
