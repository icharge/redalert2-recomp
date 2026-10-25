// The browser performance benchmark (docs/superpowers/specs/2026-10-26-web-frame-performance-design.md,
// section 1). Samples the game once a second in Chrome and writes one run.json per run.
//
//   node e2e/perf.mjs [--sizes 1280x720,1920x1080,2560x1440] [--hd off,on] [--moments early,menu]
//                     [--seconds 60] [--out ../work/perf/<date>] [--baseline <run.json>]
//                     [--append] [--profile ../work/perf/profile] [--game ../game] [--headed]
//
// Cases: "WxH/hd-on|hd-off/early" (a new skirmish: 30 s untouched, then 30 s of panning, with HD
// vehicles off, then on) and "menu/idle" (the main menu, 30 s untouched). `--append` merges this run's
// cases into the run.json at --out (only for the same build), so the matrix can run in chunks. Relative
// paths are the repo root's. Each command must finish within 10 minutes: run longer ones in the background.
//
// The first run imports ../game into --profile (a persistent Chrome profile under work/, git-ignored)
// through the Import screen; later runs reuse it. Games are opened from the profile, not from a folder:
// the page's dev and test folders copy every file into memory, which Yuri's Revenge does not fit in the
// 768 MB limit (perf-nav.mjs).
//
// Not measured yet: the busy moment (a save of a match with many units) and the 10-minute soak. The busy
// save could not be made (docs/web/testing.md, "Performance").
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { options, startPage } from "./lib.mjs";
import { compare, summarize } from "./perf-report.mjs";
import { at, openGame, settle } from "./perf-nav.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const list = (name, fallback) => flag(name, fallback).split(",").filter(Boolean);
const sizes = list("--sizes", "1280x720,1920x1080,2560x1440");
const hdStates = list("--hd", "off,on");
const moments = list("--moments", "early,menu");
const seconds = Number(flag("--seconds", 60));
const today = new Date().toLocaleDateString("en-CA"); // the local date, YYYY-MM-DD
const outDir = path.resolve(repo, flag("--out", `work/perf/${today}`));
const profile = path.resolve(repo, flag("--profile", "work/perf/profile"));
const gameDir = path.resolve(repo, flag("--game", "game"));
const baselinePath = flag("--baseline", null);
const append = argv.includes("--append");

for (const m of moments)
  if (m !== "early" && m !== "menu")
    throw new Error(`--moments ${m}: only early and menu are measured`);

const base = { ...options(argv), profile, shots: path.join(outDir, "shots") };
mkdirSync(path.join(outDir, "samples"), { recursive: true });
const started = Date.now();
const log = (line) => console.log(`${((Date.now() - started) / 1000).toFixed(0)}s  ${line}`);

/** The build the run measured: the page's build.json, as the page serves it. */
function buildId() {
  const info = JSON.parse(readFileSync(path.join(repo, "web/public/game/build.json"), "utf8"));
  return `${info.build} (ra2md ${info.games?.ra2md?.build ?? "?"})`;
}

/**
 * The CPU time of this profile's Chrome processes, read by the OS once a second. (The DevTools
 * protocol's SystemInfo is served only on the browser target, which a persistent context does not
 * expose.) A PowerShell loop prints "<epoch ms> <CPU seconds>" each second; latest() is the last line.
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
  return {
    latest: () => latest,
    stop: () => child.kill(),
  };
}
const sampler = startCpuSampler();

/** One sample: the game's frame numbers, the page's, the process CPU and the JS heap. */
async function readSample(t, cdp, lastCpu) {
  const frames = await t.page.evaluate(() => {
    const snapshot = window.ra2Store?.getSnapshot();
    const overlay = [...document.querySelectorAll("div")].find((d) =>
      d.textContent?.startsWith("game"),
    )?.innerText;
    const draw = /draw ([\d.]+) ms/.exec(overlay ?? "");
    const presenter = window.ra2Presenter;
    const counters = presenter?.counters?.();
    return {
      fps: snapshot?.fps ?? null,
      worstMs: snapshot?.pacing?.worstMs ?? null,
      late: snapshot?.pacing?.late ?? null,
      publishMs: snapshot?.pacing?.publishMs ?? null,
      // the presenter's own counter once it exists; the frame-stats overlay (?stats=1) until then
      drawMs:
        typeof counters?.drawMs === "number" ? counters.drawMs : draw ? Number(draw[1]) : null,
      textureBytes: presenter?.textureBytes?.() ?? null,
      wasmBytes: window.Module?.HEAPU8?.buffer?.byteLength ?? null,
    };
  });
  const now = sampler.latest();
  const heap = await cdp.send("Runtime.getHeapUsage");
  const cpuPct =
    lastCpu && now && now.at > lastCpu.at
      ? ((now.seconds - lastCpu.seconds) / ((now.at - lastCpu.at) / 1000)) * 100
      : null;
  return { ...frames, cpuPct, jsHeapBytes: heap.usedSize ?? null, cpu: now };
}

/** Right-button drags across the middle of the picture, back and forth, until the returned stop runs. */
function startPanning(t, size) {
  let stopping = false;
  const running = (async () => {
    let flip = false;
    while (!stopping) {
      const to = size.w / 2 + (flip ? -1 : 1) * (size.w / 4);
      await t.rdrag(size.w / 2, size.h / 2, to, size.h / 2, 300);
      flip = !flip;
    }
  })();
  return async () => {
    stopping = true;
    await running;
  };
}

/** Samples once a second for `total` seconds. Panning starts at second `pan` (null: never). */
async function sample(t, { total, pan = null }) {
  const cdp = await t.page.context().newCDPSession(t.page);
  const size = (await t.state())?.size ?? { w: 1280, h: 720 };
  const rows = [];
  let lastCpu = sampler.latest();
  let stopPanning = null;
  const begin = Date.now();
  for (let s = 0; s < total; s++) {
    const elapsed = (Date.now() - begin) / 1000;
    if (pan !== null && !stopPanning && elapsed >= pan) stopPanning = startPanning(t, size);
    await t.page.waitForTimeout(1000);
    const row = await readSample(t, cdp, lastCpu);
    if (row.cpu) lastCpu = row.cpu;
    delete row.cpu;
    rows.push(row);
  }
  if (stopPanning) await stopPanning();
  await cdp.detach();
  return rows;
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

/** The game at a picture size, in a new skirmish (the same path as measure.mjs), at the battle. */
async function openEarly(video) {
  const t = await openGame(base, { video });
  await settle(t, 5000);
  await t.clickGame(...at.singlePlayer);
  await t.page.waitForTimeout(4000);
  await t.clickGame(...at.skirmish);
  await t.page.waitForTimeout(4000);
  await t.clickGame(...at.startGame);
  await t.waitFor("the battle", (s) => (s?.fps ?? 0) > 0, 240);
  await t.page.waitForTimeout(5000); // the load's own frames are over
  return t;
}

/** One size, the early skirmish, with each HD state in turn: one case each. */
async function runEarly(size, hdList) {
  const t = await openEarly(size);
  const cases = {};
  for (const hd of hdList) {
    await setHd(t, hd === "on");
    const key = `${size}/hd-${hd}/early`;
    log(`case ${key}: ${seconds} s`);
    cases[key] = await sample(t, { total: seconds, pan: seconds / 2 });
  }
  await t.browser.close();
  return cases;
}

async function runMenu() {
  const t = await openGame(base, { video: "1280x720" });
  log("case menu/idle: 30 s untouched");
  const rows = await sample(t, { total: 30 });
  await t.browser.close();
  return { "menu/idle": rows };
}

/** Writes run.json: this run's cases, merged into the file's when --append. Samples go beside it. */
function writeRun(cases) {
  const build = buildId();
  const runPath = path.join(outDir, "run.json");
  const run = { date: today, build, cases: {} };
  if (append && existsSync(runPath)) {
    const old = JSON.parse(readFileSync(runPath, "utf8"));
    if (old.build !== build)
      throw new Error(
        `${runPath} was measured with build ${old.build}, this is ${build}: use a new --out`,
      );
    run.date = old.date;
    run.cases = { ...old.cases };
  }
  for (const [key, rows] of Object.entries(cases)) {
    run.cases[key] = summarize(rows);
    writeFileSync(
      path.join(outDir, "samples", `${key.replaceAll("/", "_")}.json`),
      JSON.stringify(rows, null, 1),
    );
  }
  writeFileSync(runPath, JSON.stringify(run, null, 2));
  return run;
}

/** Imports ../game into the profile when it is not there yet (the Library shows its card when it is). */
async function ensureImported() {
  const t = await startPage({ ...base, noDev: true, url: base.url });
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
  await t.browser.close();
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
await ensureImported();
let cases = {};
if (moments.includes("early")) {
  for (const size of sizes) {
    cases = { ...cases, ...(await runEarly(size, hdStates)) };
    writeRun(cases);
  }
}
if (moments.includes("menu")) {
  cases = { ...cases, ...(await runMenu()) };
  writeRun(cases);
}
sampler.stop();
const run = writeRun(cases);
log(`wrote ${path.join(outDir, "run.json")}: ${Object.keys(run.cases).length} cases`);
if (baselinePath) printCompare(run, JSON.parse(readFileSync(path.resolve(baselinePath), "utf8")));
