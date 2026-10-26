// The game's clock calls, counted with --clockstats (docs/web/testing.md, "Probes: wait precision and the game's clock").
//
//   cd web; node e2e/clock-probe.mjs --build ../build-web-probe [--profile ../work/perf/profile-fresh] [--headed]
//           [--menu-seconds 25] [--match-seconds 30]
//
// Opens the Yuri's Revenge game from the imported profile (perf-nav.mjs's openGame) with ?arg=--clockstats, records
// --menu-seconds at the main menu, then Single Player > Skirmish > Start Game and --match-seconds of battle. Each
// second the game prints a clock event (qpc, tgt, gtc, sleep, sleep0): how many QueryPerformanceCounter, timeGetTime,
// GetTickCount, Sleep(n) and Sleep(0) calls it made. Prints per-phase medians, the fewest Sleep calls in one second,
// and the spin verdict: a spin is a second with at least 1000 clock reads and no Sleep at all. Writes
// work/perf/clock-probe.json. Needs the -O1 probe build (BUILD_DIR=build-web-probe) and the Vite dev server up.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { options } from "./lib.mjs";
import { at, openGame, settle, startBattle } from "./perf-nav.mjs";

const argv = process.argv.slice(2);
const number = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : fallback;
};
const menuSeconds = number("--menu-seconds", 25);
const matchSeconds = number("--match-seconds", 30);

const base = options(argv);
if (!base.profile) base.profile = "../work/perf/profile-fresh";
if (!base.pageArgs.includes("--clockstats")) base.pageArgs.push("--clockstats");

const t = await openGame(base, { shots: base.shots, headed: base.headed });
try {
  // the page's own lines (ra2Tap) hold every @ra2 event; lib.mjs keeps them in t.all
  const clockEvents = (from, to = t.all.length) =>
    t.all
      .slice(from, to)
      .map((line) =>
        /"e":"clock","qpc":(\d+),"tgt":(\d+),"gtc":(\d+),"sleep":(\d+),"sleep0":(\d+)/.exec(line),
      )
      .filter(Boolean)
      .map((m) => ({ qpc: +m[1], tgt: +m[2], gtc: +m[3], sleep: +m[4], sleep0: +m[5] }));
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };
  const phase = (name, rows) => {
    const isSpin = (r) => r.qpc + r.tgt + r.gtc >= 1000 && r.sleep + r.sleep0 === 0;
    const summary = {
      phase: name,
      seconds: rows.length,
      median: {
        reads: median(rows.map((r) => r.qpc + r.tgt + r.gtc)),
        qpc: median(rows.map((r) => r.qpc)),
        tgt: median(rows.map((r) => r.tgt)),
        gtc: median(rows.map((r) => r.gtc)),
        sleep: median(rows.map((r) => r.sleep)),
        sleep0: median(rows.map((r) => r.sleep0)),
      },
      minSleepPerSecond: rows.length ? Math.min(...rows.map((r) => r.sleep + r.sleep0)) : null,
      spinSeconds: rows.filter(isSpin).length,
      rows,
    };
    const m = summary.median;
    console.log(
      `${name}: ${rows.length} s, median per second: reads ${m.reads} (qpc ${m.qpc}, timeGetTime ${m.tgt}, GetTickCount ${m.gtc}), ` +
        `Sleep(n) ${m.sleep}, Sleep(0) ${m.sleep0}; fewest Sleep in a second ${summary.minSleepPerSecond}; ` +
        `spin seconds ${summary.spinSeconds}`,
    );
    return summary;
  };

  const menuFrom = t.all.length;
  await settle(t, menuSeconds * 1000);
  const menu = phase("main menu", clockEvents(menuFrom));

  const matchFrom = t.all.length;
  await t.clickGame(...at.singlePlayer);
  await t.page.waitForTimeout(4000);
  await t.clickGame(...at.skirmish);
  await t.page.waitForTimeout(4000);
  await startBattle(t);
  const battleFrom = t.all.length;
  const setup = phase("skirmish setup and load", clockEvents(matchFrom, battleFrom));
  await settle(t, matchSeconds * 1000);
  const battle = phase("battle", clockEvents(battleFrom));

  const total = [menu, setup, battle].reduce((n, p) => n + p.seconds, 0);
  if (!total)
    throw new Error("no clock events: the build has no --clockstats, or the game did not run");
  const spin = [menu, setup, battle].some((p) => p.spinSeconds > 0);
  console.log(`spin: ${spin ? "YES (a run of clock reads with no Sleep; Task 9 runs)" : "no"}`);

  const out = path.resolve("../work/perf/clock-probe.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      { at: new Date().toISOString(), build: base.gameBuild, phases: [menu, setup, battle], spin },
      null,
      1,
    ) + "\n",
  );
  console.log(`wrote ${out}`);
} finally {
  await t.browser.close();
}
