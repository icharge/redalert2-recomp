// Stage 6, end to end in a real Chrome with a fresh profile: import the game folder through the page's
// file input, see it in the Library, play from the copy in OPFS, and check that something the game
// writes is still there after a reload.
//
//   node e2e/import.mjs [--game ../game] [--keep]
//
// Needs `pnpm dev` and a built game. The profile is a temporary folder, removed at the end (--keep
// leaves it, to look at what OPFS holds).
import { chromium } from "playwright-core";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { options } from "./lib.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const gameDir = path.resolve(flag("--game", "../game"));
const base = options(argv);
const profile = mkdtempSync(path.join(os.tmpdir(), "ra2-import-"));
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

/** The page's address, with any `--arg` the command line had (game arguments, docs/web/protocol.md). */
const address = (() => {
  const url = new URL(base.url);
  for (const arg of base.pageArgs) url.searchParams.append("arg", arg);
  return url.toString();
})();

const launch = () =>
  chromium.launchPersistentContext(profile, {
    executablePath: base.chrome,
    headless: !base.headed,
    args: ["--no-sandbox"],
    viewport: { width: 1280, height: 960 },
  });

/** Waits for the game's main menu; on a timeout says what state it was in, and the end of its log. */
async function running(page) {
  try {
    await page.waitForFunction(() => window.ra2Store?.getSnapshot().phase === "running", null, {
      timeout: 120_000,
    });
  } catch (error) {
    const state = await page.evaluate(() => JSON.stringify(window.ra2Store?.getSnapshot()));
    const log = await page.evaluate(() => (window.ra2Store?.getLog() ?? []).slice(-45));
    console.error("state:", state);
    console.error(log.join("\n"));
    throw error;
  }
}

// ---- first visit: nothing imported ------------------------------------------------------------
let context = await launch();
let page = context.pages()[0] ?? (await context.newPage());
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto(address);
await page.getByText("Bring your game").waitFor({ timeout: 30_000 });
check(true, "a browser with nothing imported shows the Import screen");

await page.locator('input[type="file"]').setInputFiles(gameDir);
await page.getByText(/^Found /).waitFor({ timeout: 120_000 });
console.log("    " + (await page.getByText(/^Found /).innerText()));
check(true, "the folder is read, and each available exe passes the build check");

if (argv.includes("--movies"))
  await page.getByRole("checkbox", { name: /Include the movies/ }).click();
await page.waitForTimeout(500);
const started = Date.now();
await page.getByRole("button", { name: /^Import / }).click();
await page.getByText("Your games").waitFor({ timeout: 900_000 });
console.log(`    imported in ${((Date.now() - started) / 1000).toFixed(0)} s`);
check(true, "the import finishes and the Library shows");
check(await page.locator('[data-game-id="ra2md"]').isVisible(), "the Library lists Yuri's Revenge");
const hasRa2 = (await page.locator('[data-game-id="ra2"]').count()) > 0;
if (argv.includes("--both")) check(hasRa2, "the Library lists both games from one import");
const opfsGameFiles = async () =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const gameRoot = await root.getDirectoryHandle("game");
    const files = [];
    const walk = async (dir, prefix) => {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === "directory") await walk(handle, `${prefix}${name}/`);
        else files.push(`${prefix}${name}`);
      }
    };
    await walk(gameRoot, "");
    return files;
  });
if (hasRa2) {
  const shared = (await opfsGameFiles()).filter((name) => name.toLowerCase().endsWith("/ra2.mix"));
  check(shared.length === 1, "the shared RA2 archive is stored once");
}

// ---- play from OPFS -----------------------------------------------------------------------------
await page.locator('[data-game-id="ra2md"]').getByRole("button", { name: "Play" }).click();
await running(page);
check(true, "the game starts from the copy in OPFS and reaches its main menu");

// something the game writes: a saved game, put in the game's folder as the game would
await page.evaluate(() => {
  const fs = window.Module.FS;
  try {
    fs.mkdir("/game/Saved Games");
  } catch {
    // there already
  }
  fs.writeFile("/game/Saved Games/e2e.sav", new TextEncoder().encode("a save from the e2e check"));
});
await page.waitForTimeout(7000); // the page copies it to OPFS within a few seconds
await context.close();

// ---- second visit: the same profile ---------------------------------------------------------------
context = await launch();
page = context.pages()[0] ?? (await context.newPage());
await page.goto(address);
await page.getByText("Your games").waitFor({ timeout: 30_000 });
check(true, "after a reload the Library is there without importing again");
// the saves come out as a zip a desktop install can take
const download = page.waitForEvent("download");
await page.locator('[data-game-id="ra2md"]').getByText("Download saves").click();
const zipFile = await download;
const zipPath = await zipFile.path();
const zipBytes = readFileSync(zipPath);
check(
  zipFile.suggestedFilename() === "ra2md-saves.zip" &&
    zipBytes.includes(Buffer.from("Saved Games/e2e.sav")),
  "Download saves gives a zip with the saved game in it",
);
await page.locator('[data-game-id="ra2md"]').getByRole("button", { name: "Play" }).click();
await running(page);
const saved = await page.evaluate(() => {
  try {
    return new TextDecoder().decode(window.Module.FS.readFile("/game/Saved Games/e2e.sav"));
  } catch {
    return null;
  }
});
check(saved === "a save from the e2e check", "a file the game wrote before the reload is back");

// ---- Red Alert 2 can also play from the same shared import ---------------------------------------
if (hasRa2) {
  await context.close();
  context = await launch();
  page = context.pages()[0] ?? (await context.newPage());
  await page.goto(address);
  await page.getByText("Your games").waitFor({ timeout: 30_000 });
  await page.locator('[data-game-id="ra2"]').getByRole("button", { name: "Play" }).click();
  await running(page);
  check(true, "Red Alert 2 starts from the shared import in OPFS");
}

// ---- remove --------------------------------------------------------------------------------------
await context.close();
context = await launch();
page = context.pages()[0] ?? (await context.newPage());
await page.goto(address);
await page.getByText("Your games").waitFor({ timeout: 30_000 });
const removeGame = async (id) => {
  const card = page.locator(`[data-game-id="${id}"]`);
  await card.getByRole("button", { name: "Remove…" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await card.waitFor({ state: "detached", timeout: 60_000 });
};
await removeGame("ra2md");
if (hasRa2) {
  check(await page.locator('[data-game-id="ra2"]').isVisible(), "removing Yuri keeps Red Alert 2");
  const shared = (await opfsGameFiles()).filter((name) => name.toLowerCase().endsWith("/ra2.mix"));
  check(shared.length === 1, "shared files remain available to the other game");
  await removeGame("ra2");
}
await page.getByText("Bring your game").waitFor({ timeout: 60_000 });
/** Every file under an OPFS folder, as paths. */
const left = await page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const files = async (dir, prefix) => {
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") out.push(...(await files(handle, prefix + name + "/")));
      else out.push(prefix + name);
    }
    return out;
  };
  return { game: await files(root, ""), top: [] };
});
const gameFiles = left.game.filter((p) => p.startsWith("game/"));
const saveFiles = left.game.filter((p) => p.startsWith("save/"));
check(
  gameFiles.length === 0,
  "removing the imported game(s) deletes their files and goes back to Import",
);
console.log("    left in OPFS:", JSON.stringify({ game: gameFiles.length, save: saveFiles }));
check(saveFiles.length > 0, "its saves are kept");

await context.close();
if (!argv.includes("--keep")) rmSync(profile, { recursive: true, force: true });
if (failures.length) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
console.log("all passed");
