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
  const edition = base.edition ?? "ra2md";
  if (edition !== "ra2" && edition !== "ra2md")
    throw new Error(`--edition ${edition}: use ra2 or ra2md`);
  url.searchParams.set("edition", edition);
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
    t.edition = base.edition ?? "ra2md";
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

/** Wait for the selected battle mode and at least three advancing, complete shared-frame sequences. */
export async function waitForBattle(t, size, seconds = 240) {
  const until = Date.now() + seconds * 1000;
  let previous = null;
  let advances = 0;
  for (;;) {
    const state = await t.state();
    if (state?.phase === "crashed" || state?.phase === "exited")
      await t.fail(`the game ${state.phase} while waiting for the battle: ${state.error ?? ""}`);
    const matchesSize = state?.size?.w === size.w && state?.size?.h === size.h;
    const sequence = await t.page.evaluate(() => {
      const module = window.Module;
      if (!module?.HEAPU8) return null;
      const shared = module.cwrap("ra2_shared", "number", [])() >>> 2;
      const words = new Int32Array(module.HEAPU8.buffer);
      const current = Atomics.load(words, shared + 1);
      return current & 1 ? null : current;
    });
    if (!matchesSize || sequence === null) advances = 0;
    else if (previous !== null && sequence !== previous) advances++;
    else advances = 0;
    if (matchesSize && advances >= 3) return state;
    previous = sequence;
    if (Date.now() > until) await t.fail(`timed out waiting for ${size.w}x${size.h} battle frames`);
    await t.page.waitForTimeout(250);
  }
}

/** Early games may not emit FPS telemetry before the first complete frame sequences arrive. */
export async function waitForEarlyBattle(t, size, seconds = 240) {
  return waitForBattle(t, size, seconds);
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

/** The menu coordinates differ in base RA2, whose 8-player map and row layout are distinct from YR. */
export function busySkirmishLayoutFor(edition = "ra2md") {
  if (edition === "ra2") {
    return {
      mapListDown: [599, 500],
      mapSelection: [410, 196], // A Path Beyond II (2-8), at the top of the bottom map-list page
      earlyMapListUp: [599, 258],
      earlyMapSelection: [410, 196], // Little Big Lake (2), at the top of the first map-list page
      earlyMapScrollClicks: 30,
      playerArrows: [115, 141, 167, 193, 219, 245, 271].map((y) => [274, y]),
      aiDifficultyX: 160,
      teamArrowX: null, // RA2 exposes player colors here; its Battle mode is already selected by default
      shortGameToggle: [140, 305],
      gameSpeedLeft: [406, 305],
      gameSpeedFive: [462, 305],
      selectTeamAlliance: false,
    };
  }
  if (edition === "ra2md") {
    return {
      mapListDown: at.mapListDown,
      mapSelection: at.territorialImperative,
      playerArrows: rowArrows,
      aiDifficultyX: null,
      teamArrowX,
      shortGameToggle: at.shortGameToggle,
      gameSpeedLeft: at.gameSpeedLeft,
      gameSpeedFive: at.gameSpeedFive,
      selectTeamAlliance: true,
    };
  }
  throw new Error(`--edition ${edition}: use ra2 or ra2md`);
}

/**
 * The skirmish for the busy save: Team Alliance on the eight-player map "Territorial Imperative (2-8)", the
 * human (row 1) and six Brutal AIs (rows 2 to 7) on team A, one Easy AI (row 8) alone on team B, game speed 5,
 * Short Game off. Nothing threatens the human, so the match lasts while the allied AIs build up (Free For
 * All lost the idle human at 1:39, and four against four ended it at 2:14 to 8:08). Assumes the main menu is
 * up. Ends on the Skirmish Game screen.
 */
export async function setUpBusySkirmish(
  t,
  { edition = t.edition ?? "ra2md", log = console.log } = {},
) {
  const layout = busySkirmishLayoutFor(edition);
  await settle(t, 5000);
  await t.clickGame(...at.singlePlayer);
  await t.page.waitForTimeout(4000);
  await t.clickGame(...at.skirmish);
  await t.page.waitForTimeout(4000);
  await t.clickGame(...at.customizeBattle);
  await t.page.waitForTimeout(4000);
  if (layout.selectTeamAlliance) {
    await t.clickGame(...at.teamAlliance);
    await t.page.waitForTimeout(1500);
  }
  // scroll the map list to the eight-player maps, then take the map at the arrow-down position
  for (let i = 0; i < 130; i++) {
    await t.clickGame(...layout.mapListDown);
    await t.page.waitForTimeout(40);
  }
  await t.page.waitForTimeout(800);
  await t.clickGame(...layout.mapSelection);
  await t.page.waitForTimeout(1500);
  await t.clickGame(...at.useMap);
  await t.page.waitForTimeout(4000);
  // players: a row's dropdown lists None, Easy, Medium, Brutal, Brutal being 92 game pixels below the arrow
  // and Easy 46 (the list's rows are 23 apart)
  for (const [i, [x, y]] of layout.playerArrows.entries()) {
    const easy = i === layout.playerArrows.length - 1;
    await t.clickGame(x, y);
    await t.page.waitForTimeout(800);
    await t.clickGame(layout.aiDifficultyX ?? x - 105, y + (easy ? 46 : 92));
    await t.page.waitForTimeout(800);
  }
  if (layout.teamArrowX !== null) {
    // YR's team dropdown lists A, B, C, D. The AI rows start on D: rows 2 to 7 go to A, row 8 to B.
    for (const [i, [, y]] of layout.playerArrows.entries()) {
      await t.clickGame(layout.teamArrowX, y);
      await t.page.waitForTimeout(800);
      await t.clickGame(layout.teamArrowX, y + (i === layout.playerArrows.length - 1 ? 44 : 22));
      await t.page.waitForTimeout(800);
    }
  }
  await t.clickGame(...layout.shortGameToggle);
  await t.page.waitForTimeout(800);
  await setGameSpeedFive(t, edition);
  log(
    edition === "ra2"
      ? "skirmish set: Battle, A Path Beyond II (2-8), six Brutal AIs and one Easy AI, game speed 5"
      : "skirmish set: Team Alliance, Territorial Imperative (2-8), the human and 6 Brutal AIs on team A, 1 Easy AI on team B, game speed 5, Short Game off",
  );
}

/**
 * The game speed set to 5 on the Skirmish Game screen: the slider goes to 0 at its left end, then a click at
 * the handle's 5 position sets 5. The early skirmish and the busy save both use this, so no setting carries over.
 */
export async function setGameSpeedFive(t, edition = t.edition ?? "ra2md") {
  const layout = busySkirmishLayoutFor(edition);
  await t.clickGame(...layout.gameSpeedLeft);
  await t.page.waitForTimeout(800);
  await t.clickGame(...layout.gameSpeedFive);
  await t.page.waitForTimeout(800);
}

/** Reset RA2's persistent early-case setup to its built-in two-player map and one Brutal AI. */
export async function prepareEarlySkirmish(t, edition = t.edition ?? "ra2md") {
  const layout = busySkirmishLayoutFor(edition);
  if (edition === "ra2") {
    await t.clickGame(...at.customizeBattle);
    await t.page.waitForTimeout(2000);
    for (let i = 0; i < layout.earlyMapScrollClicks; i++) {
      await t.clickGame(...layout.earlyMapListUp);
      await t.page.waitForTimeout(40);
    }
    await t.page.waitForTimeout(500);
    await t.clickGame(...layout.earlyMapSelection);
    await t.page.waitForTimeout(500);
    await t.clickGame(...at.useMap);
    await t.page.waitForTimeout(1500);

    // The human is row 1; this map exposes only row 2, which must be active for Start Game.
    const [x, y] = layout.playerArrows[0];
    await t.clickGame(x, y);
    await t.page.waitForTimeout(400);
    await t.clickGame(layout.aiDifficultyX, y + 92);
    await t.page.waitForTimeout(400);
  }
  await setGameSpeedFive(t, edition);
}

/** From the Skirmish Game screen to the battle. */
export async function startBattle(t) {
  const before = await t.state();
  const settings = before?.settings;
  const size = {
    w: settings?.width ?? before?.size?.w,
    h: settings?.height ?? before?.size?.h,
  };
  await t.clickGame(...at.startGame);
  await waitForBattle(t, size, 240);
  await t.page.waitForTimeout(5000); // the load's own frames are over
}

/** Where the busy save is put in the game's file system: the game lists every SAVE*.SAV there. */
export const SAVE_NAME = "SAVE0001.SAV";

/** Paths from the game directory that must be removed before the runner stages its sole save. */
export const savePathsToClear = (paths) => paths.filter((path) => /\.sav$/i.test(path));

/** A Library card may show either edition as selected while both share one imported installation. */
export const hasImportedGame = (gameIds) => gameIds.some((id) => id === "ra2md" || id === "ra2");

/**
 * The busy save's load: the save is written into the game's file system, then the game's own screens are used
 * (Single Player, Load Saved Game, the save in the list, Load). Assumes the main menu is up, at the size set by
 * setResolution. Returns when the requested picture mode is publishing changing frames. FPS telemetry is recorded
 * separately because its pump can be absent while pictures move. A screenshot, busy-loaded.png, shows what was loaded.
 */
export async function loadBusySave(t, savePath, { log = console.log, battleSize = null } = {}) {
  const base64 = readFileSync(savePath).toString("base64");
  const existingPaths = await t.page.evaluate(() => {
    const fs = window.Module.FS;
    const paths = [];
    for (const dir of ["/game", "/game/Saved Games"]) {
      let names;
      try {
        names = fs.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (name === "." || name === "..") continue;
        const path = `${dir}/${name}`;
        try {
          if (!(fs.stat(path).mode & 0o040000)) paths.push(path);
        } catch {
          // A file may disappear while the runner enumerates the directory.
        }
      }
    }
    return paths;
  });
  const oldSaves = savePathsToClear(existingPaths);
  if (oldSaves.length)
    await t.page.evaluate(
      (paths) => paths.forEach((path) => window.Module.FS.unlink(path)),
      oldSaves,
    );
  const writtenSize = await t.page.evaluate(
    ([name, text]) => {
      const bin = atob(text);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const fs = window.Module.FS;
      const path = `/game/${name}`;
      fs.writeFile(path, bytes);
      return fs.stat(path).size;
    },
    [SAVE_NAME, base64],
  );
  if (writtenSize !== Buffer.byteLength(base64, "base64"))
    await t.fail(
      `save file size mismatch: expected ${Buffer.byteLength(base64, "base64")}, wrote ${writtenSize}`,
    );
  await settle(t, 3000);
  if (battleSize) await enterSinglePlayerAtSize(t, battleSize);
  else {
    await t.clickGame(...at.singlePlayer);
    await t.page.waitForTimeout(3000);
  }
  await t.clickGame(...at.loadSavedGame);
  await t.page.waitForTimeout(3000);
  await t.clickGame(...at.firstSave); // the only save in the list
  await t.page.waitForTimeout(800);
  await t.clickGame(...at.loadSave);
  const settings = (await t.state())?.settings;
  const size = { w: settings?.width ?? 1280, h: settings?.height ?? 720 };
  await waitForBattle(t, size, 240);
  await t.page.waitForTimeout(5000); // the load's own frames are over
  const seen = [];
  for (let i = 0; i < 3; i++) {
    seen.push({ fps: (await t.state())?.fps ?? null, picture: (await picture(t.page)).checksum });
    await t.page.waitForTimeout(1000);
  }
  await t.shot("busy-loaded");
  if (new Set(seen.map((x) => x.picture)).size < 2)
    await t.fail(`the loaded save does not run: ${JSON.stringify(seen)}`);
  log(`busy save loaded; fps telemetry ${seen.map((x) => x.fps ?? "missing").join(", ")}`);
}

/** The sizes the game's own resolution setting accepts (src/web/settings.c). */
export const RESOLUTIONS = [
  [800, 600],
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];

// The approved browser-frame target and the Task 11 memory soak both keep HD vehicles off.
export const SOAK_HD = false;

/** A larger-resolution battle returns to the game's 800x600 shell when it reaches the main menu. */
export function isMenuShellPicture(size, pictureSize) {
  return (size.w !== 800 || size.h !== 600) && pictureSize === "800x600";
}

/** Resolve the requested soak size and its stable case key; default keeps the historical 1440p soak. */
export function resolveSoakSize(value = "2560x1440") {
  const match = /^(\d+)x(\d+)$/.exec(value);
  const size = match ? [Number(match[1]), Number(match[2])] : null;
  if (!size || !RESOLUTIONS.some(([w, h]) => w === size[0] && h === size[1]))
    throw new Error(
      `--soak-size ${value}: choose one of ${RESOLUTIONS.map(([w, h]) => `${w}x${h}`).join(", ")}`,
    );
  return { video: value, caseKey: `soak/${value}/${SOAK_HD ? "hd-on" : "hd-off"}/busy` };
}

/**
 * The picture size the game uses for its next battle: the game's own resolution setting (ra2_setting key 4),
 * which also writes RA2MD.INI. A launch's ?video= alone does not change the size a battle reports (it lagged
 * by one launch on a persistent profile), so every launch sets it at the menu, before any skirmish.
 */
export async function setResolution(t, size) {
  if (!RESOLUTIONS.some(([w, h]) => w === size.w && h === size.h))
    throw new Error(
      `${size.w}x${size.h}: the game's resolution setting does not accept this size (src/web/settings.c), and the battle would report another`,
    );
  await t.page.evaluate(
    ([w, h]) => window.Module.cwrap("ra2_setting", null, ["number", "number", "number"])(4, w, h),
    [size.w, size.h],
  );
  await waitState(
    t,
    `the ${size.w}x${size.h} resolution setting`,
    (state) => state?.settings?.width === size.w && state?.settings?.height === size.h,
    30,
  );
}

/** RA2 crashes if its next-battle resolution is changed on the main menu; change it after Single Player opens. */
export async function enterSinglePlayerAtSize(t, size) {
  await t.clickGame(...at.singlePlayer);
  await t.page.waitForTimeout(2000);
  await setResolution(t, size);
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
