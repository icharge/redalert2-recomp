// A CPU profile of the game's worker thread in a busy match (docs/web/testing.md, "Profiling the busy game").
//
//   cd web; node e2e/profile-game.mjs --build ../work/build-web-prof [--profile ../work/perf/profile-fresh]
//                                     [--save ../work/perf/busy.sav] [--settle-seconds 10] [--seconds 20]
//                                     [--name profile-busy] [--headed]
//
// Opens the game from the profile (perf-nav.mjs's openGame), sets the picture to 1280x720, loads the busy save
// through the game's own Load Saved Game, turns HD vehicles off, waits --settle-seconds, then records --seconds
// of CPU profile on every worker over CDP and reads the game's fps once a second. The game runs on an Emscripten
// pthread worker, so the profiles are of the workers. The game's thread is the one with the most game work: time
// outside waiting and outside the Sleep spin (pcrecomp's wait_ms polls the clock, so it looks busy but is not work).
// Writes work/perf/<name>.cpuprofile (the Chrome profile, for DevTools) and work/perf/<name>.json: the self-time
// share of four groups and the top 20 functions, the Sleep spin's share, and each busy worker's own shares.
// A group is a function's source tree, found from the build's object files (llvm-nm): the recompiled game
// (src/recomp), the runtime (pcrecomp's win32hle and src/runtime), the presenter (src/web), and waiting (the idle
// node, futex and thread-sleep calls, Atomics, Sleep). Anything else (Emscripten's libc, JS glue, FFmpeg) is
// "other", so the five shares add up to one.
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
const savePath = path.resolve(option("--save", "../work/perf/busy.sav"));
const emsdkBin = path.resolve(option("--emsdk", "../../emsdk")).replace(/\\/g, "/");

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

const WAITING =
  /futex|thread_sleep|Atomics|^\(idle\)$|^wait_ms$|^Sleep$|usleep|nanosleep|cond_wait|^__wait$|^_wait$/;
const RECOMPILED = /^sub_[0-9A-Fa-f]{8}$/;

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
      {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      },
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
 * The four groups' self time and the time with wait_ms on the stack (the game's Sleep: pcrecomp's wait_ms polls the
 * clock until its deadline, so its clock reads are a spin, not a wait), in microseconds.
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
  const totals = { game: 0, runtime: 0, presenter: 0, waiting: 0, other: 0 };
  const byName = new Map();
  let spin = 0;
  let unmapped = 0; // self time in functions no build object defines (Emscripten's libc, the JS glue, FFmpeg's)
  for (const [id, us] of selfTimes(profile)) {
    const fn = nodes.get(id)?.callFrame?.functionName || "(anonymous)";
    const group = classify(fn, symbols);
    totals[group] += us;
    if (under.has(id) && group !== "waiting") spin += us;
    if (group === "other" && !symbols.groups.has(fn)) unmapped += us;
    const row = byName.get(fn) ?? { name: fn, group, us: 0 };
    row.us += us;
    byName.set(fn, row);
  }
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  return { totals, grand, spin, unmapped, byName };
}

/**
 * The game's own work on a worker, in microseconds: its time outside waiting (idle, futex, thread sleep) and outside
 * the Sleep spin (wait_ms's clock polling). The game's thread is the one with the most of this.
 */
function busyMicros(profile, symbols) {
  const b = breakdown(profile, symbols);
  return b.grand - b.totals.waiting - b.spin;
}

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

const t = await openGame(base, { video: "1280x720", shots: base.shots, headed: base.headed });
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
  await setResolution(t, { w: 1280, h: 720 });
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
  if (before.size?.w !== 1280 || before.size?.h !== 720 || before.settings?.hd !== false)
    throw new Error(
      `the picture is ${before.size?.w}x${before.size?.h} with hd ${before.settings?.hd}, not 1280x720 with hd off`,
    );

  for (const w of workers)
    await w.send("Profiler.start").catch((e) => console.log(`start ${w.sessionId}: ${e.message}`));
  const fps = [];
  for (let i = 0; i < seconds; i++) {
    await t.page.waitForTimeout(1000);
    const s = await t.state();
    if (s?.phase === "crashed" || s?.phase === "exited")
      throw new Error(`the game ${s.phase} during the sample: ${s.error ?? ""}`);
    fps.push(s?.fps ?? null);
  }
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

  const { totals, grand, spin, unmapped, byName } = breakdown(game.profile, symbols);
  const share = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / grand]));
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
  const top = [...byName.values()]
    .sort((a, b) => b.us - a.us)
    .slice(0, 20)
    .map((r) => ({
      name: r.name,
      group: r.group,
      selfMs: +(r.us / 1000).toFixed(1),
      share: +(r.us / grand).toFixed(4),
    }));

  const cache = readFileSync(path.join(buildDir, "CMakeCache.txt"), "utf8");
  const webLinkOpt = /^WEB_LINK_OPT:[^=]*=(.*)$/m.exec(cache)?.[1] ?? "";
  const after = (await t.state()) ?? {};
  const result = {
    at: new Date().toISOString(),
    build: path.relative(process.cwd(), buildDir),
    webLinkOpt,
    size: `${after.size?.w}x${after.size?.h}`,
    hd: after.settings?.hd ?? null,
    seconds,
    fps: { perSecond: fps, median: median(fps), min: Math.min(...fps.filter((x) => x != null)) },
    workers: ranked.map((s) => ({
      sessionId: s.session.sessionId,
      url: s.session.info?.url ?? null,
      busyMs: +(s.busy / 1000).toFixed(1),
      totalMs: +((s.profile.endTime - s.profile.startTime) / 1000).toFixed(1),
    })),
    game: { sessionId: game.session.sessionId, samples: game.profile.samples.length },
    shares: share,
    shareMs: Object.fromEntries(
      Object.entries(totals).map(([k, v]) => [k, +(v / 1000).toFixed(1)]),
    ),
    totalMs: +(grand / 1000).toFixed(1),
    // the part of "other" (clock reads, mostly) and of the rest that runs under wait_ms, the game's Sleep spin
    wait_msSpinShare: +(spin / grand).toFixed(4),
    perWorker,
    unmappedOtherMs: +(unmapped / 1000).toFixed(1),
    objects: symbols.objects,
    symbolGroupConflicts: symbols.conflicts,
    top,
  };
  const cpuprofile = path.join(outDir, `${name}.cpuprofile`);
  writeFileSync(cpuprofile, JSON.stringify(game.profile));
  const jsonOut = path.join(outDir, `${name}.json`);
  writeFileSync(jsonOut, JSON.stringify(result, null, 1) + "\n");

  console.log(
    `fps per second: ${fps.join(", ")}; median ${result.fps.median}, min ${result.fps.min}`,
  );
  console.log(
    `shares of the game worker's ${result.totalMs} ms: ` +
      Object.entries(share)
        .map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`)
        .join(", "),
  );
  console.log(
    `time under wait_ms (the Sleep spin): ${(result.wait_msSpinShare * 100).toFixed(1)}% of the game worker`,
  );
  console.log("top 10 by self time:");
  for (const r of top.slice(0, 10))
    console.log(`  ${(r.share * 100).toFixed(1).padStart(5)}%  ${r.group.padEnd(9)} ${r.name}`);
  console.log(`wrote ${cpuprofile}\nwrote ${jsonOut}`);
} finally {
  await t.browser.close();
}
