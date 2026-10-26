// A CPU profile of the game's worker thread in a busy match (docs/web/testing.md, "Profiling the busy game").
//
//   cd web; node e2e/profile-game.mjs --build ../work/build-web-prof [--profile ../work/perf/profile-fresh]
//                                     [--save ../work/perf/busy.sav] [--settle-seconds 10] [--seconds 20]
//                                     [--size 1280x720] [--name profile-busy] [--emsdk ../../emsdk] [--headed]
//   cd web; node e2e/profile-game.mjs --build ../work/build-web-prof --name profile-busy --reanalyze
//
// Opens the game from the profile (perf-nav.mjs's openGame), sets the picture to --size (default 1280x720), loads
// the busy save through the game's own Load Saved Game, turns HD vehicles off, waits --settle-seconds, then
// records --seconds of CPU profile on every worker over CDP and reads the game's fps once a second. The game runs
// on an Emscripten pthread worker, so the profiles are of the workers. The game's thread is the one with the most
// game work: time outside waiting and outside the Sleep spin (pcrecomp's wait_ms polls the clock, so it looks busy
// but is not work).
//
// The frames of the sample are counted from the game's fps events: each event carries the frames of its second,
// and the page's store (window.ra2Store) gives a new state object per event, so the sample polls it every 100 ms
// and adds the fps of each new object that carries one. The JSON's workPerFrameMs is the game worker's work
// (busy time) divided by those frames: the headroom measure (docs/web/testing.md, "Profiling the busy game").
//
// Writes work/perf/<name>.cpuprofile (the Chrome profile, for DevTools) and work/perf/<name>.json: the self-time
// share of six groups and the top 20 functions, the Sleep spin's share, the clock reads' time, and each busy
// worker's own shares. --reanalyze recomputes the JSON's groups from the saved .cpuprofile, without a browser.
//
// A group is a function's source tree, found from the build's object files (llvm-nm): the recompiled game
// (src/recomp), the runtime (pcrecomp's win32hle and src/runtime), the presenter (src/web), and waiting (the idle
// node, futex and thread-sleep calls, Atomics, Sleep, and wait_ms's own time). Functions named recomp_* are their own
// group, hook: the runtime's call wrappers, which the object map would otherwise count as runtime. Anything else
// (Emscripten's libc, JS glue, FFmpeg) is "other", so the six shares add up to one.
//
// The CDP sessions are in legacy (non-flattened) mode: Playwright's CDPSession sends only on its own session, so
// a worker's messages go through its parent (Target.sendMessageToTarget and Target.receivedMessageFromTarget).
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { options } from "./lib.mjs";
import { openGame, loadBusySave, setResolution, settle } from "./perf-nav.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const settleSeconds = Number(option("--settle-seconds", 10));
const seconds = Number(option("--seconds", 20));
const name = option("--name", "profile-busy");
// the picture size of the sample, WxH (the game's resolution list must have it: setResolution checks)
const sizeArg = option("--size", "1280x720");
const sizeMatch = /^(\d+)x(\d+)$/.exec(sizeArg);
if (!sizeMatch) throw new Error(`--size ${sizeArg}: expected WxH, for example 2560x1440`);
const size = { w: Number(sizeMatch[1]), h: Number(sizeMatch[2]) };
const savePath = path.resolve(option("--save", "../work/perf/busy.sav"));
// the emsdk checkout, whose llvm-nm.exe reads the objects (the Windows binary's name)
const emsdkBin = path.resolve(option("--emsdk", "../../emsdk")).replace(/\\/g, "/");
// The page exposes no game-speed getter (HostSettings has none, and the speed lives in the game's memory), so the
// busy save's own speed, 5, is recorded as assumed rather than read back.
const SPEED = "assumed 5 (busy.sav)";

const base = options(argv);
if (!base.gameBuild)
  throw new Error("--build <dir>: the build directory with ra2.js, ra2.wasm and ra2.data");
if (!base.profile) base.profile = "../work/perf/profile-fresh";
const buildDir = path.resolve(base.gameBuild);
const outDir = path.resolve("../work/perf");
mkdirSync(outDir, { recursive: true });

/**
 * One CDP session. The page's is Playwright's; a worker's is reached through its parent: frames to it are sent with
 * Target.sendMessageToTarget and its replies and events come back wrapped in the parent's
 * Target.receivedMessageFromTarget. Workers the page's session attaches to are registered as they appear.
 */
function makeSession({
  cdp = null,
  parent = null,
  sessionId = null,
  info = null,
  onAttach = null,
}) {
  const session = { sessionId, info, children: new Map(), pending: new Map(), seq: 1 };
  session.send = (method, params = {}) => {
    if (cdp) return cdp.send(method, params);
    const id = session.seq++;
    return new Promise((resolve, reject) => {
      session.pending.set(id, { resolve, reject });
      parent
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch((error) => {
          session.pending.delete(id);
          reject(error);
        });
    });
  };
  session.receive = (msg) => {
    if (msg.id !== undefined && session.pending.has(msg.id)) {
      const { resolve, reject } = session.pending.get(msg.id);
      session.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
      return;
    }
    const p = msg.params ?? {};
    if (msg.method === "Target.receivedMessageFromTarget")
      session.children.get(p.sessionId)?.receive(JSON.parse(p.message));
    else if (msg.method === "Target.attachedToTarget") {
      const child = makeSession({
        parent: session,
        sessionId: p.sessionId,
        info: p.targetInfo,
        onAttach,
      });
      session.children.set(p.sessionId, child);
      onAttach?.(child);
    } else if (msg.method === "Target.detachedFromTarget") session.children.delete(p.sessionId);
  };
  return session;
}

/** The worker's own setup: its nested workers are attached too, and its profiler enabled (not started). */
const workers = [];
async function onAttach(session) {
  if (!session.info || !/worker/.test(session.info.type)) return;
  workers.push(session);
  await session
    .send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: false,
    })
    .catch(() => {});
  await session
    .send("Profiler.enable")
    .catch((error) => console.log(`profiler on ${session.sessionId}: ${error.message}`));
}

// wait_ms's own time is waiting too: it is the game's Sleep, and the clock polls under it are counted apart
const WAITING =
  /futex|thread_sleep|Atomics|^\(idle\)$|^wait_ms$|^Sleep$|usleep|nanosleep|cond_wait|^__wait$|^_wait$/;
const HOOK = /^recomp_/;
const RECOMPILED = /^sub_[0-9A-Fa-f]{8}$/;
// the clock reads a wait_ms poll makes (the Emscripten and libc calls it goes through)
const CLOCK = /^(_emscripten_get_now|now|_clock_time_get|__clock_gettime)$/;

/** function name -> group, from the build's object files: each defined symbol's group is its object's source tree. */
function symbolGroups() {
  const objDir = path.join(buildDir, "CMakeFiles", "ra2.dir");
  const objects = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".o")) objects.push(full);
    }
  };
  walk(objDir);
  const groupOf = (file) => {
    const rel = path.relative(objDir, file).replace(/\\/g, "/");
    if (/^src\/recomp\//.test(rel)) return "game";
    if (/pcrecomp\/|^src\/runtime\//.test(rel)) return "runtime";
    if (/^src\/web\//.test(rel)) return "presenter";
    return "other";
  };
  const groups = new Map();
  let conflicts = 0;
  for (let i = 0; i < objects.length; i += 100) {
    const chunk = objects.slice(i, i + 100);
    const nm = spawnSync(
      `${emsdkBin}/upstream/bin/llvm-nm.exe`,
      ["--defined-only", "--print-file-name", ...chunk],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    if (nm.status !== 0) throw new Error(`llvm-nm failed: ${nm.stderr}`);
    for (const line of nm.stdout.split(/\r?\n/)) {
      // text symbols only (functions): data labels such as .L.str repeat across objects
      const m = /^(.+?\.o):\s*(?:[0-9a-fA-F]+\s+)?[TtWw]\s+(\S+)$/.exec(line);
      if (!m) continue;
      const group = groupOf(m[1]);
      const prev = groups.get(m[2]);
      if (prev === undefined) groups.set(m[2], group);
      else if (prev !== group) conflicts++;
    }
  }
  return { groups, objects: objects.length, conflicts };
}

/** The group of a function in the profile. */
function classify(fnName, symbols) {
  if (fnName === "(idle)" || WAITING.test(fnName)) return "waiting";
  if (HOOK.test(fnName)) return "hook";
  if (RECOMPILED.test(fnName)) return "game";
  return symbols.groups.get(fnName) ?? "other";
}

/** Self time per node, in microseconds: each sample lasts until the next one. */
function selfTimes(profile) {
  const byNode = new Map();
  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i++) {
    const dt = i + 1 < samples.length ? timeDeltas[i + 1] : 0;
    byNode.set(samples[i], (byNode.get(samples[i]) ?? 0) + dt);
  }
  return byNode;
}

/**
 * The six groups' self time, the time with wait_ms on the stack (outside waiting), the clock reads' time and the
 * clock reads under wait_ms, in microseconds. wait_ms's own self time is in waiting.
 */
function breakdown(profile, symbols) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const under = new Set();
  const stack = profile.nodes
    .filter((n) => n.callFrame.functionName === "wait_ms")
    .map((n) => n.id);
  while (stack.length) {
    const id = stack.pop();
    if (under.has(id)) continue;
    under.add(id);
    stack.push(...(nodes.get(id)?.children ?? []));
  }
  const totals = { game: 0, hook: 0, runtime: 0, presenter: 0, waiting: 0, other: 0 };
  const byName = new Map();
  let spin = 0;
  let clock = 0;
  let clockUnder = 0;
  let unmapped = 0; // self time in functions no build object defines (Emscripten's libc, the JS glue, FFmpeg's)
  for (const [id, us] of selfTimes(profile)) {
    const fn = nodes.get(id)?.callFrame?.functionName || "(anonymous)";
    const group = classify(fn, symbols);
    totals[group] += us;
    if (under.has(id) && group !== "waiting") spin += us;
    if (CLOCK.test(fn)) {
      clock += us;
      if (under.has(id)) clockUnder += us;
    }
    if (group === "other" && !symbols.groups.has(fn)) unmapped += us;
    const row = byName.get(fn) ?? { name: fn, group, us: 0 };
    row.us += us;
    byName.set(fn, row);
  }
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  return { totals, grand, spin, clock, clockUnder, unmapped, byName };
}

/**
 * The game's own work on a worker, in microseconds: its time outside waiting (idle, futex, thread sleep, wait_ms)
 * and outside the Sleep spin (wait_ms's clock polling). The game's thread is the one with the most of this.
 */
function busyMicros(profile, symbols) {
  const b = breakdown(profile, symbols);
  return b.grand - b.totals.waiting - b.spin;
}

/** The JSON's measures of one profile: shares, top 20, spin, clock reads (all from breakdown). */
function summarize(profile, symbols) {
  const b = breakdown(profile, symbols);
  const share = Object.fromEntries(
    Object.entries(b.totals).map(([k, v]) => [k, +(v / b.grand).toFixed(4)]),
  );
  return {
    shares: share,
    shareMs: Object.fromEntries(
      Object.entries(b.totals).map(([k, v]) => [k, +(v / 1000).toFixed(1)]),
    ),
    totalMs: +(b.grand / 1000).toFixed(1),
    wait_msSpinShare: +(b.spin / b.grand).toFixed(4),
    clockReadsMs: +(b.clock / 1000).toFixed(1),
    clockReadsUnderWaitMsMs: +(b.clockUnder / 1000).toFixed(1),
    unmappedOtherMs: +(b.unmapped / 1000).toFixed(1),
    objects: symbols.objects,
    symbolGroupConflicts: symbols.conflicts,
    top: [...b.byName.values()]
      .sort((x, y) => y.us - x.us)
      .slice(0, 20)
      .map((r) => ({
        name: r.name,
        group: r.group,
        selfMs: +(r.us / 1000).toFixed(1),
        share: +(r.us / b.grand).toFixed(4),
      })),
  };
}

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/** Prints the shares and the top 10 of a summary. */
function printSummary(summary) {
  console.log(
    `shares of the game worker's ${summary.totalMs} ms: ` +
      Object.entries(summary.shares)
        .map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`)
        .join(", "),
  );
  console.log(
    `time under wait_ms (the Sleep spin, not waiting): ${(summary.wait_msSpinShare * 100).toFixed(1)}%; ` +
      `clock reads ${summary.clockReadsMs} ms, of which under wait_ms ${summary.clockReadsUnderWaitMsMs} ms`,
  );
  console.log("top 10 by self time:");
  for (const r of summary.top.slice(0, 10))
    console.log(`  ${(r.share * 100).toFixed(1).padStart(5)}%  ${r.group.padEnd(9)} ${r.name}`);
}

/** --reanalyze: the groups recomputed from the saved <name>.cpuprofile; the fps and the capture stay as they were. */
function reanalyze() {
  const jsonPath = path.join(outDir, `${name}.json`);
  const cpuprofile = path.join(outDir, `${name}.cpuprofile`);
  const prior = JSON.parse(readFileSync(jsonPath, "utf8"));
  const profile = JSON.parse(readFileSync(cpuprofile, "utf8"));
  const symbols = symbolGroups();
  const summary = summarize(profile, symbols);
  const b = breakdown(profile, symbols);
  const gameEntry = {
    sessionId: prior.game.sessionId,
    totalMs: summary.totalMs,
    shares: summary.shares,
    wait_msSpinShare: summary.wait_msSpinShare,
  };
  const result = {
    ...prior,
    at: new Date().toISOString(),
    reanalyzed: "groups recomputed from the saved .cpuprofile (hook group added)",
    speed: prior.speed ?? SPEED,
    game: { ...prior.game, samples: profile.samples.length },
    // the other workers' profiles were not saved, so only the game worker's entry is recomputed
    perWorker: (prior.perWorker ?? []).map((w) =>
      w.sessionId === prior.game.sessionId ? gameEntry : w,
    ),
    ...summary,
  };
  writeFileSync(jsonPath, JSON.stringify(result, null, 1) + "\n");
  console.log(`reanalyzed ${cpuprofile} (${profile.samples.length} samples, ${b.grand / 1000} ms)`);
  printSummary(summary);
  console.log(`wrote ${jsonPath}`);
}

if (argv.includes("--reanalyze")) {
  reanalyze();
  process.exit(0);
}

const t = await openGame(base, { video: sizeArg, shots: base.shots, headed: base.headed });
try {
  const cdp = await t.page.context().newCDPSession(t.page);
  const root = makeSession({ cdp, onAttach });
  for (const method of [
    "Target.attachedToTarget",
    "Target.receivedMessageFromTarget",
    "Target.detachedFromTarget",
  ])
    cdp.on(method, (params) => root.receive({ method, params }));
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
  });

  await settle(t, 3000);
  await setResolution(t, size);
  await loadBusySave(t, savePath, { log: console.log });
  // HD vehicles off, as perf.mjs's setHd does it (the setting, then the store's copy of it)
  await t.page.evaluate(() =>
    window.Module.cwrap("ra2_setting", null, ["number", "number", "number"])(2, 0, 0),
  );
  await t.page.waitForFunction(() => window.ra2Store?.getSnapshot().settings?.hd === false, null, {
    timeout: 30_000,
  });
  await t.page.waitForTimeout(settleSeconds * 1000);

  const before = (await t.state()) ?? {};
  console.log(
    `busy save at ${before.size?.w}x${before.size?.h}, hd ${before.settings?.hd}; ${workers.length} worker(s) attached`,
  );
  if (before.size?.w !== size.w || before.size?.h !== size.h || before.settings?.hd !== false)
    throw new Error(
      `the picture is ${before.size?.w}x${before.size?.h} with hd ${before.settings?.hd}, not ${size.w}x${size.h} with hd off`,
    );

  // Counts the frames of the sample: each new store state that carries an fps adds its fps (one event a second).
  // The first call only sets the baseline, so the state the sample starts from is not counted.
  const countFrames = () =>
    t.page.evaluate(() => {
      const store = window.ra2Store;
      const snap = store?.getSnapshot();
      const acc = (window.__frameCount ??= { frames: 0, events: 0, last: undefined });
      if (acc.last === undefined) acc.last = snap;
      else if (snap !== acc.last) {
        acc.last = snap;
        if (typeof snap?.fps === "number") {
          acc.frames += snap.fps;
          acc.events++;
        }
      }
      return { frames: acc.frames, events: acc.events };
    });
  await countFrames();

  for (const w of workers)
    await w.send("Profiler.start").catch((e) => console.log(`start ${w.sessionId}: ${e.message}`));
  const fps = [];
  for (let i = 0; i < seconds; i++) {
    for (let k = 0; k < 10; k++) {
      await t.page.waitForTimeout(100);
      await countFrames();
    }
    const s = await t.state();
    if (s?.phase === "crashed" || s?.phase === "exited")
      throw new Error(`the game ${s.phase} during the sample: ${s.error ?? ""}`);
    fps.push(s?.fps ?? null);
  }
  const counted = await countFrames();
  const stopped = [];
  for (const w of workers) {
    const result = await w.send("Profiler.stop").catch((e) => {
      console.log(`stop ${w.sessionId}: ${e.message}`);
      return null;
    });
    if (result?.profile) stopped.push({ session: w, profile: result.profile });
  }

  const symbols = symbolGroups();
  const ranked = stopped
    .map((s) => ({ ...s, busy: busyMicros(s.profile, symbols) }))
    .sort((a, b) => b.busy - a.busy);
  for (const s of ranked)
    console.log(
      `worker ${s.session.sessionId}: ${(s.busy / 1000).toFixed(0)} ms of game work (not waiting, not the Sleep spin) of ${((s.profile.endTime - s.profile.startTime) / 1000).toFixed(0)} ms`,
    );
  if (!ranked.length || ranked[0].busy === 0)
    throw new Error("no worker has a profile with busy time");
  const game = ranked[0];

  const summary = summarize(game.profile, symbols);
  // the workers with at least 1% of the game's work, with their own shares
  const perWorker = ranked
    .filter((s) => s.busy >= ranked[0].busy * 0.01)
    .map((s) => {
      const b = breakdown(s.profile, symbols);
      return {
        sessionId: s.session.sessionId,
        totalMs: +(b.grand / 1000).toFixed(1),
        shares: Object.fromEntries(
          Object.entries(b.totals).map(([k, v]) => [k, +(v / b.grand).toFixed(4)]),
        ),
        wait_msSpinShare: +(b.spin / b.grand).toFixed(4),
      };
    });

  const cache = readFileSync(path.join(buildDir, "CMakeCache.txt"), "utf8");
  const webLinkOpt = /^WEB_LINK_OPT:[^=]*=(.*)$/m.exec(cache)?.[1] ?? "";
  const after = (await t.state()) ?? {};
  const result = {
    at: new Date().toISOString(),
    build: path.relative(process.cwd(), buildDir),
    webLinkOpt,
    size: `${after.size?.w}x${after.size?.h}`,
    hd: after.settings?.hd ?? null,
    speed: SPEED,
    seconds,
    fps: {
      perSecond: fps,
      median: median(fps),
      min: Math.min(...fps.filter((x) => x != null)),
    },
    // the sample's frames (the fps events counted above) and the game worker's work per frame (busy time / frames)
    frames: counted.frames,
    fpsEvents: counted.events,
    busyMs: +(game.busy / 1000).toFixed(1),
    workPerFrameMs: counted.frames > 0 ? +(game.busy / 1000 / counted.frames).toFixed(2) : null,
    workers: ranked.map((s) => ({
      sessionId: s.session.sessionId,
      url: s.session.info?.url ?? null,
      busyMs: +(s.busy / 1000).toFixed(1),
      totalMs: +((s.profile.endTime - s.profile.startTime) / 1000).toFixed(1),
    })),
    game: { sessionId: game.session.sessionId, samples: game.profile.samples.length },
    perWorker,
    ...summary,
  };
  const cpuprofile = path.join(outDir, `${name}.cpuprofile`);
  writeFileSync(cpuprofile, JSON.stringify(game.profile));
  const jsonOut = path.join(outDir, `${name}.json`);
  writeFileSync(jsonOut, JSON.stringify(result, null, 1) + "\n");

  console.log(
    `fps per second: ${fps.join(", ")}; median ${result.fps.median}, min ${result.fps.min}`,
  );
  console.log(
    `${counted.frames} frames in ${counted.events} fps events; game work ${result.busyMs} ms, ${result.workPerFrameMs} ms a frame`,
  );
  printSummary(summary);
  console.log(`wrote ${cpuprofile}\nwrote ${jsonOut}`);
} finally {
  await t.browser.close();
}
