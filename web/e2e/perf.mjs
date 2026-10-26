// The browser performance benchmark (docs/superpowers/specs/2026-10-26-web-frame-performance-design.md,
// section 1). Samples the game once a second in Chrome and writes one run.json per run.
//
//   node e2e/perf.mjs [--sizes 1280x720,1920x1080,2560x1440,3840x2160] [--hd off,on]
//                     [--moments early,busy,menu] [--repeats 2] [--seconds 60] [--save work/perf/busy.sav]
//                     [--soak-minutes 0] [--out work/perf/<date>] [--baseline <run.json>] [--append]
//                     [--profile work/perf/profile-fresh] [--game game] [--headed]
//
// The defaults are early skirmishes and the main menu at 720p, 1080p and 1440p, HD vehicles off and on
// (60 s each: 30 s untouched, then 30 s of right-button panning), the main menu untouched for 30 s. Each
// early case is run --repeats times (default 2, each a new launch); run.json holds the last run, and the
// first run's summary is kept beside it as firstRun. Every skirmish sets game speed 5 on the setup screen,
// and each case records the speed and the picture size the game reported.
// --moments busy loads --save (made by make-busy-save.mjs) through the game's Load Saved Game at each size,
// 4K included, with each HD state; the case is 60 s of the loaded battle, panned like the early cases. The
// menu case expects the game's 800x600 menu shell. Every case also fails when the game reports a picture size
// other than the requested one.
// --soak-minutes N runs the busy save at 2560x1440 for N minutes with HD vehicles on, off at 20%, on again at
// 40%, and the presenter's scale mode switched at 60% and 80%; if the match ends (no game frames for 5 s) the
// save is loaded again (resolution set, size checked) and the sample after it is marked reloaded.
// Cases are keyed "WxH/hd-on|hd-off/early|busy", "menu/idle" and "soak/2560x1440/hd-on/busy".
// run.json is written after every finished case, so a later failure keeps the earlier cases; a case that
// failed is listed under "failures" (and the exit code is 1). --append merges this run's cases into the
// run.json at --out (for the same build only). Relative paths are the repo root's. Each command must finish
// within 10 minutes: run longer ones in the background.
//
// The first run imports ../game into --profile (a persistent Chrome profile under work/, git-ignored)
// through the Import screen; later runs reuse it. Games are opened from the profile, not from a folder:
// the page's dev and test folders copy every file into memory, which Yuri's Revenge does not fit in the
// 768 MB limit (perf-nav.mjs).
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lastFailure, options, startPage } from "./lib.mjs";
import { compare, mergeCases } from "./perf-report.mjs";
import {
  at,
  gameUrl,
  loadBusySave,
  openGame,
  setGameSpeedFive,
  setResolution,
  settle,
  waitState,
} from "./perf-nav.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);

// Every flag this script takes; anything else is an error, not silently ignored.
const VALUE_FLAGS = new Set([
  "--sizes",
  "--hd",
  "--moments",
  "--seconds",
  "--soak-minutes",
  "--repeats",
  "--save",
  "--out",
  "--baseline",
  "--profile",
  "--game",
  "--url",
  "--shots",
  "--arg",
  "--build",
]);
const BOOLEAN_FLAGS = new Set(["--append", "--headed"]);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (BOOLEAN_FLAGS.has(arg)) continue;
  if (VALUE_FLAGS.has(arg)) {
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--"))
      throw new Error(`${arg} needs a value`);
    i++;
    continue;
  }
  throw new Error(`unknown argument ${arg} (see the usage at the top of e2e/perf.mjs)`);
}

const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const list = (name, fallback) => flag(name, fallback).split(",").filter(Boolean);
const sizes = list("--sizes", "1280x720,1920x1080,2560x1440");
const hdStates = list("--hd", "off,on");
const moments = list("--moments", "early,menu");
const seconds = Number(flag("--seconds", 60));
const soakMinutes = Number(flag("--soak-minutes", 0));
const repeats = Number(flag("--repeats", 2));
const savePath = path.resolve(repo, flag("--save", "work/perf/busy.sav"));
const today = new Date().toLocaleDateString("en-CA"); // the local date, YYYY-MM-DD
const outDir = path.resolve(repo, flag("--out", `work/perf/${today}`));
const profile = path.resolve(repo, flag("--profile", "work/perf/profile-fresh"));
const gameDir = path.resolve(repo, flag("--game", "game"));
const baselinePath = flag("--baseline", null);
const append = argv.includes("--append");

for (const m of moments)
  if (!["early", "busy", "menu"].includes(m))
    throw new Error(`--moments ${m}: use early, busy or menu`);
for (const h of hdStates)
  if (!["off", "on"].includes(h)) throw new Error(`--hd ${h}: use off or on`);
if (!(repeats >= 1)) throw new Error(`--repeats ${repeats}: use 1 or more`);
if ((moments.includes("busy") || soakMinutes > 0) && !existsSync(savePath))
  throw new Error(`no save at ${savePath}: make it with e2e/make-busy-save.mjs`);

// --game is the import folder here, so lib.mjs must not read it as a test folder
// --build <dir> (lib.mjs) serves that build directory's ra2.* files as the page's Yuri's Revenge module; without it
// the page loads the published build in web/public/game. --build is resolved against the working directory (run
// from web/, as the examples do), unlike --out, --profile and --save, which are repo-relative. The wasm's SHA-256
// (the run's build label) is the build's reliable identity: build.json's ids come from WEB_OUT, which can be
// rebuilt later.
const base = {
  ...options(argv),
  profile,
  testGame: null,
  shots: path.join(outDir, "shots"),
};
mkdirSync(path.join(outDir, "samples"), { recursive: true });
const started = Date.now();
const log = (line) => console.log(`${((Date.now() - started) / 1000).toFixed(0)}s  ${line}`);

/**
 * A --build directory's identity: the wasm the page loaded (ra2.wasm in the directory, by its SHA-256), the build
 * ids of the WEB_OUT that CMakeCache.txt names (its build.json), and the CMake build type.
 */
function buildOf(dir) {
  const cachePath = path.join(dir, "CMakeCache.txt");
  if (!existsSync(cachePath)) throw new Error(`--build ${dir}: no CMakeCache.txt there`);
  const cache = readFileSync(cachePath, "utf8");
  const webOut = /^WEB_OUT:PATH=(.*)$/m.exec(cache)?.[1]?.trim() || dir;
  const info = JSON.parse(readFileSync(path.join(webOut, "build.json"), "utf8"));
  const wasm = path.join(dir, "ra2.wasm");
  const sha = createHash("sha256").update(readFileSync(wasm)).digest("hex").slice(0, 12);
  const cachedType = (/^CMAKE_BUILD_TYPE:STRING=(.*)$/m.exec(cache)?.[1] ?? "").trim();
  // an empty cache value is CMakeLists' browser default, Release
  const buildType = cachedType || "Release (CMakeLists default)";
  if (!buildType.startsWith("Release"))
    console.warn(`warning: the build type is ${buildType}, not Release (${cachePath})`);
  return {
    id: `${path.basename(dir)}: ${info.build} (ra2md ${info.games?.ra2md?.build ?? "?"}), wasm ${sha}`,
    buildType,
  };
}

/** The build the run measured: --build's directory, else the page's build.json, and the CMake build type of its build directory. */
function build() {
  if (base.gameBuild) return buildOf(path.resolve(base.gameBuild));
  const info = JSON.parse(readFileSync(path.join(repo, "web/public/game/build.json"), "utf8"));
  const cache = path.join(repo, "build-web", "CMakeCache.txt");
  let buildType = "unknown";
  if (existsSync(cache)) {
    const found = /^CMAKE_BUILD_TYPE:STRING=(.*)$/m.exec(readFileSync(cache, "utf8"));
    if (found) buildType = found[1].trim() || "(empty)";
  }
  if (buildType !== "Release")
    console.warn(`warning: the build type is ${buildType}, not Release (build-web/CMakeCache.txt)`);
  return { id: `${info.build} (ra2md ${info.games?.ra2md?.build ?? "?"})`, buildType };
}

/**
 * Process CPU of this profile's Chrome processes, read by the OS once a second. (SystemInfo is served
 * only on the browser target, which a persistent context does not expose.) A PowerShell loop prints
 * "<epoch ms> <CPU seconds>" each second; latest() is the last line.
 */
function startCpuSampler() {
  const script = `
    $profile = '${profile.replace(/'/g, "''")}';
    while ($true) {
      $ids = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
        Where-Object { $_.CommandLine -like "*$profile*" } | ForEach-Object { $_.ProcessId });
      $sum = 0;
      if ($ids.Count -gt 0) {
        foreach ($p in (Get-Process -Id $ids -ErrorAction SilentlyContinue)) { $sum += $p.TotalProcessorTime.TotalSeconds }
      }
      Write-Output ("{0} {1}" -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), $sum);
      Start-Sleep -Seconds 1;
    }`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let latest = null;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const [at, seconds] = line.trim().split(" ").map(Number);
    if (Number.isFinite(at) && Number.isFinite(seconds)) latest = { at, seconds };
  });
  return { latest: () => latest, stop: () => child.kill() };
}
let sampler = null;

/**
 * One sample: the game's frame numbers, the page's, the process CPU and the JS heap. The presenter's
 * counters are running totals, so its figures are differences from the previous sample.
 */
async function readSample(t, cdp, last) {
  const frames = await t.page.evaluate(() => {
    const snapshot = window.ra2Store?.getSnapshot();
    const overlay = [...document.querySelectorAll("div")].find((d) =>
      d.textContent?.startsWith("game"),
    )?.innerText;
    const draw = /draw ([\d.]+) ms/.exec(overlay ?? "");
    const presenter = window.ra2Presenter;
    return {
      fps: snapshot?.fps ?? null,
      size: snapshot?.size ? `${snapshot.size.w}x${snapshot.size.h}` : null,
      worstMs: snapshot?.pacing?.worstMs ?? null,
      late: snapshot?.pacing?.late ?? null,
      publishMs: snapshot?.pacing?.publishMs ?? null,
      published: snapshot?.pacing?.published ?? null,
      counters: presenter?.counters?.() ?? null,
      overlayDrawMs: draw ? Number(draw[1]) : null,
      textureBytes: presenter?.textureBytes?.() ?? null,
      wasmBytes: window.Module?.HEAPU8?.buffer?.byteLength ?? null,
    };
  });
  const now = sampler.latest();
  const heap = await cdp.send("Runtime.getHeapUsage");
  const cpuPct =
    last?.cpu && now && now.at > last.cpu.at
      ? ((now.seconds - last.cpu.seconds) / ((now.at - last.cpu.at) / 1000)) * 100
      : null;
  // the presenter's drawMs: milliseconds per animation frame over the last sample (its own counters),
  // else the frame-stats overlay's figure, which is the same ratio
  let drawMs = frames.overlayDrawMs;
  let pictures = null;
  let ticks = null;
  const c = frames.counters;
  if (c && last?.counters) {
    const dTicks = c.ticks - last.counters.ticks;
    const dSeconds = (now && last.cpu ? (now.at - last.cpu.at) / 1000 : 1) || 1;
    drawMs = dTicks > 0 ? (c.drawMs - last.counters.drawMs) / dTicks : null;
    pictures = (c.pictures - last.counters.pictures) / dSeconds;
    ticks = dTicks / dSeconds;
  }
  const rest = { ...frames };
  delete rest.counters;
  delete rest.overlayDrawMs;
  return {
    ...rest,
    drawMs,
    pictures,
    ticks,
    cpuPct,
    jsHeapBytes: heap.usedSize ?? null,
    cpu: now,
    counters: frames.counters,
  };
}

/** Right-button drags across the middle of the picture, back and forth. A failure is kept for the case. */
function startPanning(t, size) {
  let stopping = false;
  let failure = null;
  const running = (async () => {
    let flip = false;
    while (!stopping) {
      const to = size.w / 2 + (flip ? -1 : 1) * (size.w / 4);
      await t.rdrag(size.w / 2, size.h / 2, to, size.h / 2, 300);
      flip = !flip;
    }
  })().catch((error) => {
    failure = error;
  });
  return {
    failure: () => failure,
    stop: async () => {
      stopping = true;
      await running;
    },
  };
}

/**
 * Samples once a second for `total` seconds. Panning starts at second `pan` (null: never). `actions` run once
 * each, when their second comes: [{ at, run }]. With `reload` (the soak), five seconds with no game frames
 * (the match has ended) call it to reload the save; the next sample is marked reloaded.
 */
async function sample(t, { total, pan = null, actions = [], reload = null }) {
  let cdp = await t.page.context().newCDPSession(t.page);
  const size = (await t.state())?.size ?? { w: 1280, h: 720 };
  const rows = [];
  let last = { cpu: sampler.latest(), counters: null };
  let stopPanning = null;
  let zeroFrames = 0;
  let reloaded = false;
  const pending = [...actions].sort((a, b) => a.at - b.at);
  const begin = Date.now();
  try {
    for (let s = 0; s < total; s++) {
      const elapsed = (Date.now() - begin) / 1000;
      while (pending.length && pending[0].at <= elapsed) await pending.shift().run();
      if (pan !== null && !stopPanning && elapsed >= pan) stopPanning = startPanning(t, size);
      if (stopPanning?.failure()) throw stopPanning.failure();
      await t.page.waitForTimeout(1000);
      const row = await readSample(t, cdp, last);
      // the picture size is the case's: a change while the game runs (a menu has none) is not a measurement
      if (row.fps > 0 && row.size && row.size !== `${size.w}x${size.h}`)
        throw new Error(
          `the game's picture changed from ${size.w}x${size.h} to ${row.size} during the case`,
        );
      if (reloaded) {
        row.reloaded = true;
        reloaded = false;
      }
      last = { cpu: row.cpu, counters: row.counters };
      delete row.cpu;
      delete row.counters;
      rows.push(row);
      zeroFrames = row.fps === 0 ? zeroFrames + 1 : 0;
      // PERF_TEST_RELOAD_AT=<second> forces the reload once, to test it without waiting for a match to end
      const forced = Number(process.env.PERF_TEST_RELOAD_AT) === s + 1;
      if (reload && (zeroFrames >= 5 || forced)) {
        log("the match has ended (no game frames for 5 s): reloading the save");
        if (stopPanning) {
          await stopPanning.stop();
          if (stopPanning.failure()) throw stopPanning.failure();
        }
        stopPanning = null;
        await cdp.detach();
        await reload();
        cdp = await t.page.context().newCDPSession(t.page);
        last = { cpu: sampler.latest(), counters: null };
        zeroFrames = 0;
        reloaded = true;
        if (pan !== null) stopPanning = startPanning(t, size);
      }
    }
    // a panning failure in the last second counts too, including one that happens while it is stopping
    if (stopPanning) {
      await stopPanning.stop();
      if (stopPanning.failure()) throw stopPanning.failure();
    }
  } finally {
    // whatever ended the sampling (a failed read, a panning failure), panning stops and the session is released
    if (stopPanning) await stopPanning.stop().catch(() => {});
    await cdp.detach().catch(() => {});
  }
  return rows;
}

/** The presenter's scale mode (Play.tsx cycles the same setting): the page's own mode switch. */
async function setScaleMode(t, mode) {
  await t.page.evaluate(
    (m) => window.Module.cwrap("ra2_setting", null, ["number", "number", "number"])(0, m, 0),
    mode,
  );
  await t.page.waitForTimeout(1500);
}

/** Turns the HD vehicles setting on or off, as measure.mjs does, and waits for the game to show it. */
async function setHd(t, on) {
  await t.page.evaluate(
    (v) => window.Module.cwrap("ra2_setting", null, ["number", "number", "number"])(2, v, 0),
    on ? 1 : 0,
  );
  await t.page.waitForFunction((v) => window.ra2Store?.getSnapshot().settings?.hd === v, on, {
    timeout: 30_000,
  });
  await t.page.waitForTimeout(2000);
}

/** WxH as { w, h }. */
function parseSize(text) {
  const [w, h] = text.split("x").map(Number);
  return { w, h };
}

/** Runs `steps` on an open game; if they throw, the game's browser is closed before the error goes on. */
async function closingOnError(t, steps) {
  try {
    await steps();
    return t;
  } catch (error) {
    await t.browser.close().catch(() => {});
    throw error;
  }
}

/** The game at a picture size, in a new skirmish (the same path as measure.mjs), at the battle. */
async function openEarly(video) {
  const t = await openGame(base, { video });
  return closingOnError(t, async () => {
    await settle(t, 5000);
    await setResolution(t, parseSize(video));
    await t.clickGame(...at.singlePlayer);
    await t.page.waitForTimeout(4000);
    await t.clickGame(...at.skirmish);
    await t.page.waitForTimeout(4000);
    await setGameSpeedFive(t);
    await t.clickGame(...at.startGame);
    await t.waitFor("the battle", (s) => (s?.fps ?? 0) > 0, 240);
    await t.page.waitForTimeout(5000); // the load's own frames are over
  });
}

/** The busy save at a picture size: the game's own Load Saved Game, then the battle. */
async function openBusy(video) {
  const t = await openGame(base, { video });
  return closingOnError(t, async () => {
    await settle(t, 3000);
    await setResolution(t, parseSize(video));
    await loadBusySave(t, savePath, { log });
  });
}

/** Runs `body` with a game open, and closes its browser however it ends. */
async function withGame(open, body) {
  let t = null;
  try {
    t = await open();
    return await body(t);
  } finally {
    await t?.browser.close().catch(() => {});
  }
}

/** The picture the game reports must be the one asked for: a case at another size is not a measurement. */
async function checkSize(t, size) {
  const want = typeof size === "string" ? parseSize(size) : size;
  const reported = (await t.state())?.size ?? null;
  if (!reported || reported.w !== want.w || reported.h !== want.h)
    throw new Error(
      `${want.w}x${want.h}: the game reports ${reported ? `${reported.w}x${reported.h}` : "no size"}, not ${want.w}x${want.h}`,
    );
  return reported;
}

/**
 * One size of a moment, with each HD state in turn in one launch. Early cases run `repeats` times, a new
 * launch each. Result: { [key]: { runs: [rows, ...], gameSpeed, size } }, the size as the game reported it.
 */
async function runMoment(moment, size, hdList, onCase) {
  const results = {};
  const runs = moment === "early" ? repeats : 1;
  for (let r = 1; r <= runs; r++) {
    await withGame(
      () => (moment === "busy" ? openBusy(size) : openEarly(size)),
      async (t) => {
        // PERF_TEST_FAIL_LAUNCH=<n> fails the nth launch, to test the partial-run record
        if (Number(process.env.PERF_TEST_FAIL_LAUNCH) === r)
          throw new Error(`forced failure of launch ${r}`);
        if (Number(process.env.PERF_TEST_FAIL_LAUNCH_HARD) === r)
          await t.fail(`forced game failure in launch ${r}`);
        const reported = await checkSize(t, size);
        for (const hd of hdList) {
          await setHd(t, hd === "on");
          const key = `${size}/hd-${hd}/${moment}`;
          log(`case ${key}, run ${r} of ${runs}: ${seconds} s`);
          const rows = await sample(t, { total: seconds, pan: seconds / 2 });
          results[key] ??= {
            planned: runs,
            runs: [],
            gameSpeed: moment === "busy" ? "5 (in the save)" : 5,
            size: reported,
          };
          results[key].runs.push(rows);
          onCase?.(results); // a finished case is on disk before the next one starts
        }
      },
    );
  }
  return results;
}

/** The game's menus are an 800x600 shell whatever size a battle is set to, so the menu case expects 800x600. */
const MENU_SIZE = { w: 800, h: 600 };

async function runMenu() {
  return withGame(
    () => openGame(base, { video: "1280x720" }),
    async (t) => {
      const reported = await checkSize(t, MENU_SIZE);
      log("case menu/idle: 30 s untouched");
      const rows = await sample(t, { total: 30 });
      return { "menu/idle": { runs: [rows], gameSpeed: null, size: reported } };
    },
  );
}

/**
 * The soak: N minutes of the busy save at 2560x1440. HD vehicles on; off at 20% and on again at 40%; the
 * scale mode switched to 1 at 60% and to 2 at 80%. The save is reloaded if the match ends (five seconds with
 * no game frames), with the HD and scale settings put back.
 */
async function runSoak(minutes) {
  const total = minutes * 60;
  const key = "soak/2560x1440/hd-on/busy";
  return withGame(
    () => openBusy("2560x1440"),
    async (t) => {
      let hd = true;
      let scale = 0;
      const reported = await checkSize(t, "2560x1440");
      await setHd(t, true);
      log(`case ${key}: ${minutes} min`);
      const rows = await sample(t, {
        total,
        pan: 0,
        actions: [
          {
            at: total * 0.2,
            run: async () => {
              hd = false;
              await setHd(t, false);
            },
          },
          {
            at: total * 0.4,
            run: async () => {
              hd = true;
              await setHd(t, true);
            },
          },
          {
            at: total * 0.6,
            run: async () => {
              scale = 1;
              await setScaleMode(t, 1);
            },
          },
          {
            at: total * 0.8,
            run: async () => {
              scale = 2;
              await setScaleMode(t, 2);
            },
          },
        ],
        reload: async () => {
          await t.page.goto(gameUrl(base, "2560x1440"));
          await waitState(t, "the main menu", (s) => s?.phase === "running", 300);
          await settle(t, 3000);
          await setResolution(t, parseSize("2560x1440"));
          await loadBusySave(t, savePath, { log });
          await checkSize(t, "2560x1440");
          await setHd(t, hd);
          await setScaleMode(t, scale);
        },
      });
      return {
        [key]: {
          runs: [rows],
          gameSpeed: "5 (in the save)",
          size: reported,
        },
      };
    },
  );
}

/** Every finished case of this process (key to { runs, gameSpeed, size }), and the cases that failed (key to message). */
const finished = {};
const failures = {};
let baseRun = null; // the run.json this process builds on: the file's cases with --append, else none

/**
 * Writes run.json from the cases finished so far: each case's last run, with the first run's summary kept as
 * firstRun when there were two, and its gameSpeed and size; merged into the file's cases when --append. A case
 * that failed is listed in failures, not dropped. Samples go beside it, one file per run. It runs after every
 * finished case, so a later failure does not lose the earlier cases.
 */
function writeRun() {
  const { id, buildType } = build();
  const runPath = path.join(outDir, "run.json");
  if (baseRun === null) {
    baseRun = { date: today, cases: {}, failures: {} };
    if (append && existsSync(runPath)) {
      const old = JSON.parse(readFileSync(runPath, "utf8"));
      if (old.build !== id)
        throw new Error(
          `${runPath} was measured with build ${old.build}, this is ${id}: use a new --out`,
        );
      baseRun = { date: old.date, cases: old.cases ?? {}, failures: old.failures ?? {} };
    }
  }
  const merged = mergeCases({
    baseCases: baseRun.cases,
    baseFailures: baseRun.failures,
    finished,
    failures,
  });
  const run = { date: baseRun.date, build: id, buildType, cases: merged.cases };
  for (const [key, result] of Object.entries(finished)) {
    const stem = key.replaceAll("/", "_");
    result.runs.forEach((rows, i) => {
      const name = result.runs.length > 1 ? `${stem}_run${i + 1}` : stem;
      writeFileSync(path.join(outDir, "samples", `${name}.json`), JSON.stringify(rows, null, 1));
    });
  }
  if (Object.keys(merged.failures).length) run.failures = merged.failures;
  writeFileSync(runPath, JSON.stringify(run, null, 2));
  return run;
}

function record(results) {
  Object.assign(finished, results);
  writeRun();
}

/** Imports ../game into the profile when it is not there yet (the Library shows its card when it is). */
async function ensureImported() {
  const t = await startPage({ ...base, noDev: true, url: base.url });
  try {
    const page = t.page;
    await page.getByRole("heading", { name: "Your games" }).waitFor({ timeout: 60_000 });
    const have = await page.locator('[data-slot-id="1"] [data-game-id="ra2md"]').count();
    if (!have) {
      log(`importing ${gameDir} into the profile (once)`);
      await page.getByRole("button", { name: "Import a folder…" }).click();
      await page.getByText("Bring your game").waitFor({ timeout: 30_000 });
      await page.locator('input[type="file"]').setInputFiles(gameDir);
      await page.getByText(/^Found /).waitFor({ timeout: 120_000 });
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /^Import / }).click();
      await page.getByText("Your games").waitFor({ timeout: 900_000 });
    }
  } finally {
    await t.browser.close().catch(() => {});
  }
}

function printCompare(run, baseline) {
  const pct = (v) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
  const num = (v) => (v === null ? "-" : Number.isInteger(v) ? String(v) : v.toFixed(2));
  console.log(["case", "measure", "baseline", "now", "change", "pass"].join("\t"));
  for (const r of compare(run, baseline)) {
    if (r.now === null && r.baseline === null) continue;
    const pass = r.pass === null ? "-" : r.pass ? "PASS" : "FAIL";
    console.log([r.case, r.measure, num(r.baseline), num(r.now), pct(r.change), pass].join("\t"));
  }
}

// ---- main ---------------------------------------------------------------------------------------
let exitCode = 0;
/** A case with all the runs planned for it: a later failure in its part does not touch it. */
const isComplete = (key) =>
  finished[key] && finished[key].runs.length >= (finished[key].planned ?? 1);
// a game failure (lib.mjs's fail) ends the process at once; the case it was in is recorded as failed first
let current = null;
process.on("exit", () => {
  sampler?.stop();
  if (!current) return;
  for (const key of current.filter((k) => !isComplete(k)))
    failures[key] = lastFailure() ?? "the process exited during this case (see its output)";
  try {
    writeRun();
  } catch {
    // nothing more can be done at exit
  }
});

/** Runs one part of the matrix: the cases it names are recorded as failed if it throws, and the run goes on. */
async function part(keys, body) {
  current = keys;
  try {
    await body();
  } catch (error) {
    console.error(`FAILED ${keys.join(", ")}: ${error?.stack ?? error}`);
    for (const key of keys.filter((k) => !isComplete(k)))
      failures[key] = String(error?.message ?? error);
    exitCode = 1;
    writeRun();
  }
  current = null;
}

sampler = startCpuSampler();
try {
  await ensureImported();
  for (const moment of ["early", "busy"]) {
    if (!moments.includes(moment)) continue;
    for (const size of sizes)
      await part(
        hdStates.map((hd) => `${size}/hd-${hd}/${moment}`),
        async () => {
          await runMoment(moment, size, hdStates, record);
        },
      );
  }
  if (moments.includes("menu")) await part(["menu/idle"], async () => record(await runMenu()));
  if (soakMinutes > 0)
    await part(["soak/2560x1440/hd-on/busy"], async () => record(await runSoak(soakMinutes)));
  const run = writeRun();
  log(`wrote ${path.join(outDir, "run.json")}: ${Object.keys(run.cases).length} cases`);
  if (Object.keys(failures).length)
    log(`FAILED cases: ${Object.keys(failures).join(", ")} (listed under failures in run.json)`);
  if (baselinePath) printCompare(run, JSON.parse(readFileSync(path.resolve(baselinePath), "utf8")));
} catch (error) {
  console.error(`FAILED: ${error?.stack ?? error}`);
  exitCode = 1;
} finally {
  sampler.stop();
}
process.exitCode = exitCode;
