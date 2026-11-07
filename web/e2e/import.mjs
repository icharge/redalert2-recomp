// Stage 6, end to end in a real Chrome with a fresh profile: import the game folder through the page's
// file input, see it in the launcher, play from the copy in OPFS, and check that something the game
// writes is still there after a reload.
//
//   node e2e/import.mjs [--game ../game] [--keep]
//
// Needs `pnpm dev` and a built game. The profile is a temporary folder, removed at the end (--keep
// leaves it, to look at what OPFS holds).
import { chromium } from "playwright-core";
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  chooseEdition,
  openInstall,
  openTab,
  openTray,
  options,
  playButton,
  waitForLauncher,
} from "./lib.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const gameDir = path.resolve(flag("--game", "../game"));
const base = options(argv);
mkdirSync(base.shots, { recursive: true });
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
    serviceWorkers: "block",
  });

/** Serve an isolated link output without replacing the module another task may be testing. */
async function routeBuild(context) {
  if (!base.gameBuild) return () => [];
  const buildDir = path.resolve(base.gameBuild);
  const served = [];
  const server = createServer((request, response) => {
    const name = new URL(request.url, "http://localhost").pathname.slice(1);
    if (!/^ra2\.(js|wasm|data)$/.test(name)) {
      response.writeHead(404).end();
      return;
    }
    served.push(name);
    const file = path.join(buildDir, name);
    try {
      const size = statSync(file).size;
      response.writeHead(200, {
        "Content-Length": size,
        "Content-Type": name.endsWith(".js")
          ? "text/javascript"
          : name.endsWith(".wasm")
            ? "application/wasm"
            : "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.on("close", () => server.close());
  await context.route(/\/game\/(?:ra2\/)?ra2\.(js|wasm|data)(?:\?.*)?$/, (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    return route.continue({ url: `http://127.0.0.1:${server.address().port}/${name}` });
  });
  return () => [...new Set(served)];
}

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
const servedBuildFiles = await routeBuild(context);
let page = context.pages()[0] ?? (await context.newPage());
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto(address);
await waitForLauncher(page, 30_000);
await openInstall(page);
check(true, "a browser with nothing imported offers INSTALL THE GAME");

await page.locator('input[type="file"]').setInputFiles(gameDir);
await page.getByRole("heading", { name: "READY TO INSTALL" }).waitFor({ timeout: 120_000 });
console.log(
  "    " +
    (await page.getByRole("region", { name: "Install the game" }).innerText()).replace(
      /\n/g,
      " | ",
    ),
);
check(true, "the folder is read, and each available exe passes the build check");

if (argv.includes("--movies")) await page.getByRole("checkbox", { name: /^Movies/ }).click();
// this check reads the imported RA2MD.INI, so bring the folder's settings once
const settingsBox = page.getByRole("checkbox", { name: "Settings and hotkeys" });
if (await settingsBox.isEnabled()) await settingsBox.click();
await page.waitForTimeout(500);
const started = Date.now();
await page.getByRole("button", { name: /^INSTALL \d/ }).click();
await page.getByRole("navigation", { name: "Launcher" }).waitFor({ timeout: 900_000 });
console.log(`    imported in ${((Date.now() - started) / 1000).toFixed(0)} s`);
check(true, "the import finishes and the launcher shows");
const games = page.getByRole("navigation", { name: "Games" });
check(
  await games.getByRole("button", { name: "Yuri’s Revenge", exact: true }).isVisible(),
  "the game rail lists Yuri's Revenge",
);
// two games in one install: the rail chooses which one PLAY starts
const hasRa2 = (await games.getByRole("button", { name: "Red Alert 2", exact: true }).count()) > 0;
if (argv.includes("--both")) check(hasRa2, "the rail offers both games from one import");
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

// one install only: with a game in the browser, the Install screen sends the player to GAME
const second = new URL("import", address);
second.search = new URL(address).search;
await page.goto(second.toString());
await page.getByRole("region", { name: "INSTALLED" }).waitFor({ timeout: 30_000 });
check(
  new URL(page.url()).pathname.endsWith("/manage") &&
    (await page.getByRole("button", { name: "INSTALL ANOTHER COPY" }).count()) === 0,
  "with a game installed, a second install goes to GAME: remove it first",
);
await page.screenshot({ path: path.join(base.shots, "installations.png") });

async function browseText(open, name, what, managed = false) {
  await open();
  await page.getByTestId("read-only-file-explorer").waitFor();
  try {
    await page.getByText(name, { exact: true }).waitFor();
  } catch (error) {
    console.error("file browser:", await page.getByRole("dialog").innerText());
    throw error;
  }
  // the Library's imported files can be changed (delete here, upload in the dialog's own bar); nothing can be exported
  check(
    (await page.locator(".fe_fileexplorer_folder_tools button").count()) === (managed ? 1 : 0) &&
      (await page.getByRole("button", { name: "Upload files…" }).count()) === (managed ? 1 : 0),
    managed
      ? `${what} browser can only upload and delete`
      : `${what} browser has no write or export tools`,
  );
  await page.getByText(name, { exact: true }).first().dblclick();
  const reader = page.getByRole("region", { name: `Text file ${name}` });
  await reader.waitFor();
  check((await reader.locator("pre").innerText()).length > 0, `${what} browser reads ${name}`);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "Close" }).click();
}

await openTab(page, "GAME");
await browseText(
  () => page.getByRole("button", { name: "BROWSE FILES" }).click(),
  "RA2MD.INI",
  "imported OPFS",
  true,
);

// ---- play from OPFS -----------------------------------------------------------------------------
const bootStarted = Date.now();
await openTab(page, "PLAY");
await chooseEdition(page, "ra2md");
await playButton(page).click();
await running(page);
console.log(
  `    game reached the main menu in ${((Date.now() - bootStarted) / 1000).toFixed(1)} s`,
);
if (base.gameBuild)
  console.log(`    isolated game assets served: ${servedBuildFiles().join(", ") || "none"}`);
const runtimeMemory = await page.evaluate(() => {
  const mib = (bytes) => (bytes == null ? null : +(bytes / (1024 * 1024)).toFixed(1));
  return {
    wasmMiB: mib(window.Module?.HEAPU8?.buffer?.byteLength),
    jsHeapMiB: mib(performance.memory?.usedJSHeapSize),
  };
});
console.log(`    memory: ${JSON.stringify(runtimeMemory)}`);
const opfsLines = await page.evaluate(() =>
  (window.ra2Store?.getLog() ?? []).filter((line) => /\[opfs-(?:open|read)\]/.test(line)),
);
for (const line of opfsLines) console.log(line);
if (argv.includes("--boot-probe-only")) {
  if (!opfsLines.some((line) => line.includes("[opfs-read]")))
    console.log("    no per-file OPFS read reports yet; readers may stay open until exit");
  const holdMs = Number(flag("--hold-after-menu", "0"));
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  await context.close();
  if (!argv.includes("--keep")) rmSync(profile, { recursive: true, force: true });
  process.exit(0);
}
check(true, "the game starts from the copy in OPFS and reaches its main menu");
await browseText(
  async () => {
    await openTray(page);
    await page.getByRole("button", { name: "FILES", exact: true }).click();
  },
  "RA2MD.INI",
  "live /game VFS",
);

// something the game writes: a saved game, beside the exe as the game names it (SAVE%04lX.sav)
await page.evaluate(() => {
  window.Module.FS.writeFile(
    "/game/SAVE0001.sav",
    new TextEncoder().encode("a save from the e2e check"),
  );
});
await page.waitForTimeout(7000); // the page copies it to OPFS within a few seconds
await context.close();

// ---- second visit: the same profile ---------------------------------------------------------------
context = await launch();
await routeBuild(context);
page = context.pages()[0] ?? (await context.newPage());
await page.goto(address);
await page.getByRole("navigation", { name: "Launcher" }).waitFor({ timeout: 30_000 });
check(true, "after a reload the launcher is there without importing again");
// the saves come out as a zip a desktop install can take
await chooseEdition(page, "ra2md");
await openTab(page, "GAME");
const download = page.waitForEvent("download");
await page.getByRole("button", { name: "DOWNLOAD .ZIP" }).click();
const zipFile = await download;
const zipPath = await zipFile.path();
const zipBytes = readFileSync(zipPath);
check(
  zipFile.suggestedFilename() === "slot-1-ra2md-saves.zip" &&
    zipBytes.includes(Buffer.from("SAVE0001.sav")),
  "Download saves gives a zip with the saved game in it",
);
await openTab(page, "PLAY");
await playButton(page).click();
await running(page);
check(new URL(page.url()).pathname.endsWith("/game/1"), "PLAY navigates to the installation route");
const direct = new URL("game/1?edition=ra2md&e2e=1", address);
await page.goto(direct.toString());
await running(page);
await page.reload();
await running(page);
check(true, "a direct game URL and refresh work under the deployment base");
const saved = await page.evaluate(() => {
  try {
    return new TextDecoder().decode(window.Module.FS.readFile("/game/SAVE0001.sav"));
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
  await page.getByRole("navigation", { name: "Launcher" }).waitFor({ timeout: 30_000 });
  await chooseEdition(page, "ra2");
  await playButton(page).click();
  await running(page);
  check(true, "Red Alert 2 starts from the shared import in OPFS");
}

// ---- leaving the game, and removal ---------------------------------------------------------
await context.close();
context = await launch();
page = context.pages()[0] ?? (await context.newPage());
await page.goto(address);
await waitForLauncher(page, 30_000);
await chooseEdition(page, "ra2md");
await playButton(page).click();
await running(page);
const oldWorkers = new Set(page.workers());
check(oldWorkers.size > 0, "the game has workers before browser Back");
for (const worker of oldWorkers) worker.on("close", () => oldWorkers.delete(worker));
await page.goBack();
await page.getByRole("navigation", { name: "Launcher" }).waitFor({ timeout: 30_000 });
check(
  await page.evaluate(() => !window.Module && !window.ra2Session),
  "browser Back unloads the runtime before showing the launcher",
);
check(oldWorkers.size === 0, "browser Back closes the old game's workers");
await openTab(page, "GAME");
await page.getByRole("button", { name: "REMOVE GAME", exact: true }).click();
await page.getByRole("alertdialog").getByRole("button", { name: "REMOVE", exact: true }).click();
await page.getByRole("button", { name: "INSTALL THE GAME" }).waitFor({ timeout: 60_000 });
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
  "removing the imported game(s) deletes their files and keeps the launcher open",
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
