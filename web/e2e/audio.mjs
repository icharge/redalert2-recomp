// Stage 7, in a real Chrome: the sound ring and the worklet that plays it.
//
//   node e2e/audio.mjs [--minutes 5] [--skirmish] [--url http://127.0.0.1:5173/]
//
// 1. a test tone: a sine written into a ring in shared memory, played by public/audio-worklet.js in an
//    offline context, with no game; the output has the tone's frequency and the ring was read.
// 2. the game: at the main menu the page starts the sound after a click, the game's mixer keeps the ring
//    fed (frames mixed go on at the sample rate) and the worklet drains it with no underrun.
// 3. with --skirmish --minutes N: the same over N minutes of a skirmish (W7.4); the game's own frame rate is
//    printed beside it. Plays through the dev server, so the page's address needs `dev`.
import { options, picture, startPage } from "./lib.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const minutes = Number(flag("--minutes", 0));
const skirmish = argv.includes("--skirmish");
const base = options(argv);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const t = await startPage({ ...base, url: new URL("/?e2e", base.url).toString() });

// ---- 1. the tone, in a page of the dev server that is isolated, so it can have a SharedArrayBuffer ----------------
{
  const page = await t.browser.newPage();
  await page.goto(new URL("/icons/icon.svg", base.url).toString());
  const result = await page.evaluate(async () => {
    if (!crossOriginIsolated) return { isolated: false };
    const FRAMES = 8192;
    const RATE = 44100;
    const buffer = new SharedArrayBuffer(32 + FRAMES * 4);
    const head = new Int32Array(buffer, 0, 8);
    const pcm = new Int16Array(buffer, 32, FRAMES * 2);
    head[3] = FRAMES;
    head[4] = RATE;
    for (let i = 0; i < FRAMES; i++) {
      const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / RATE) * 16000);
      pcm[2 * i] = v;
      pcm[2 * i + 1] = -v; // the two channels differ, so a swap would show
    }
    head[1] = FRAMES; // wr
    head[2] = 1; // live
    const context = new OfflineAudioContext(2, RATE, RATE);
    await context.audioWorklet.addModule("/audio-worklet.js");
    const node = new AudioWorkletNode(context, "ra2-ring", {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { buffer, address: 0 },
    });
    node.connect(context.destination);
    const out = await context.startRendering();
    const left = out.getChannelData(0);
    const right = out.getChannelData(1);
    let crossings = 0;
    let peak = 0;
    for (let i = 1; i < FRAMES; i++) {
      if (left[i - 1] < 0 !== left[i] < 0) crossings++;
      peak = Math.max(peak, Math.abs(left[i] ?? 0));
    }
    let mirrored = true;
    for (let i = 0; i < FRAMES; i++)
      if (Math.abs((left[i] ?? 0) + (right[i] ?? 0)) > 1e-6) mirrored = false;
    let tail = 0; // after the ring ran dry: silence
    for (let i = FRAMES + 256; i < RATE; i++) tail = Math.max(tail, Math.abs(left[i] ?? 0));
    return {
      isolated: true,
      crossings,
      peak,
      mirrored,
      tail,
      rd: head[0] >>> 0,
      underruns: head[5],
    };
  });
  await page.close();
  check(result.isolated, "the dev server's pages are cross-origin isolated");
  if (result.isolated) {
    const hz = (result.crossings / 2) * (44100 / 8192);
    check(
      Math.abs(hz - 440) < 8,
      `the worklet plays the tone: ${hz.toFixed(0)} Hz, peak ${result.peak.toFixed(2)}`,
    );
    check(result.mirrored, "left and right come out as they went in");
    check(result.rd === 8192, `it took exactly the frames in the ring (${result.rd})`);
    check(result.tail === 0 && result.underruns > 0, "a dry ring is silence, and counted");
  }
}

// ---- 2. the game --------------------------------------------------------------------------------------------------
await t.waitFor("the main menu", (s) => s?.phase === "running");
await t.page.waitForFunction(
  () => window.ra2Audio?.state !== undefined && window.ra2Audio.state !== "starting",
);
const stateBefore = await t.page.evaluate(() => window.ra2Audio.state);
console.log(`sound state before a click: ${stateBefore}`);
await t.page.mouse.click(640, 480); // a click on the page, as a player's
await t.page
  .waitForFunction(() => window.ra2Audio.state === "running", null, { timeout: 15_000 })
  .catch(() => {});
const state = await t.page.evaluate(() => window.ra2Audio.state);
check(state === "running", `the sound runs after a click (was ${stateBefore})`);

const stats = () => t.page.evaluate(() => window.ra2Audio.stats());
const sample = async (seconds) => {
  const a = await stats();
  const began = Date.now();
  await t.page.waitForTimeout(seconds * 1000);
  const b = await stats();
  const s = (Date.now() - began) / 1000;
  return {
    seconds: s,
    mixedPerS: (b.mixed - a.mixed) / s,
    playedPerS: (b.rd - a.rd) / s,
    underruns: b.underruns - a.underruns,
    queued: b.wr - b.rd,
    low: b.low,
    live: b.live,
  };
};
const menu = await sample(8);
console.log(JSON.stringify(menu));
let peak = 0;
for (let i = 0; i < 40; i++) {
  peak = Math.max(peak, await t.page.evaluate(() => window.ra2Audio.peak()));
  await t.page.waitForTimeout(100);
}
check(peak > 0.01, `the game's sound is in the ring: peak ${peak.toFixed(3)}`);
// the volume: ra2_set_volume is what the page's slider calls
const loudest = async (seconds) => {
  let peak = 0;
  for (let i = 0; i < seconds * 10; i++) {
    peak = Math.max(peak, await t.page.evaluate(() => window.ra2Audio.peak()));
    await t.page.waitForTimeout(100);
  }
  return peak;
};
const volume = (v) =>
  t.page.evaluate((x) => window.Module.ccall("ra2_set_volume", null, ["number"], [x]), v);
await volume(0);
await t.page.waitForTimeout(400); // what was already mixed plays out of the ring
const muted = await loudest(2);
await volume(0.5);
const half = await loudest(3);
await volume(1);
const full = await loudest(3);
check(muted === 0, `volume 0 is silent in the ring (peak ${muted})`);
check(half > 0 && full > 0, `volume comes back: half ${half.toFixed(3)}, full ${full.toFixed(3)}`);
check(menu.live === 1, "the ring is live");
check(
  Math.abs(menu.playedPerS - 44100) < 2000,
  `the worklet takes ${menu.playedPerS.toFixed(0)} frames a second`,
);
check(
  Math.abs(menu.mixedPerS - 44100) < 2000,
  `the mixer makes ${menu.mixedPerS.toFixed(0)} frames a second`,
);
check(menu.underruns === 0, `no underrun at the menu (${menu.underruns})`);
check(
  menu.queued >= 0 && menu.queued <= 16384,
  `the ring holds ${menu.queued} frames: neither empty nor overrun`,
);

// ---- 3. a skirmish -----------------------------------------------------------------------------------------------
// An idle player loses in about two minutes and the game shows the score; Continue goes back to the menus and
// another skirmish starts, until there have been --minutes of battle (fps above 0).
if (skirmish || minutes > 0) {
  const pause = (s) => t.page.waitForTimeout(s * Number(process.env.SLOW ?? 1) * 1000);
  const fpsNow = async () => (await t.state())?.fps ?? 0;
  // a click just before the next screen is up is lost: click again until the picture changes
  const advance = async (x, y) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = (await picture(t.page)).checksum;
      await t.clickGame(x, y);
      for (let i = 0; i < 16; i++) {
        await t.page.waitForTimeout(500);
        if ((await picture(t.page)).checksum !== before) return;
      }
    }
  };
  // from the main menu the first time; Continue after a battle leaves the skirmish screen up
  const start = async (fromMenu) => {
    await pause(2);
    if (fromMenu) {
      await advance(719, 221); // Single Player
      await pause(3);
      await advance(720, 305); // Skirmish
      await pause(3);
    }
    await t.clickGame(719, 263); // Start Game
    for (let i = 0; i < 180; i++) {
      if ((await fpsNow()) > 0) return true;
      await t.page.waitForTimeout(500);
    }
    return false;
  };
  if (!(await start(true))) await t.fail("the battle did not start");
  console.log("in the battle");
  const want = (minutes || 0.5) * 60;
  let battle = 0;
  let elapsed = 0;
  let underruns = 0;
  let idle = 0;
  let battles = 1;
  while (battle < want && elapsed < want * 3) {
    await t.page.evaluate(() => window.ra2Audio.resetLow());
    const r = await sample(10);
    elapsed += 10;
    const fps = await fpsNow();
    const peak = await t.page.evaluate(() => window.ra2Audio.peak());
    underruns += r.underruns;
    if (fps > 0) battle += 10;
    console.log(
      `${String(elapsed).padStart(4)}s  mixed ${r.mixedPerS.toFixed(0)}/s  played ${r.playedPerS.toFixed(0)}/s  queued ${r.queued} (low ${r.low})  underruns ${r.underruns}  peak ${peak.toFixed(2)}  game ${fps} fps  battle ${battle}s`,
    );
    idle = fps > 0 ? 0 : idle + 1;
    if (idle === 2 && battle < want) {
      await t.shot(`audio-score-${battles}`);
      await t.clickGame(720, 557); // Continue
      if (!(await start(false))) {
        await t.shot("audio-no-restart");
        console.log("a new battle did not start; sampling on at the menus");
        idle = -1000;
      } else {
        battles++;
        idle = 0;
        console.log(`battle ${battles}`);
      }
    }
  }
  await t.shot("audio-end");
  const end = await t.state();
  check(end?.phase === "running", `the game is still running after ${elapsed} s (${end?.phase})`);
  check(battle >= want, `${battle} s of battle in ${battles} skirmishes (wanted ${want})`);
  check(underruns === 0, `no underrun in ${elapsed} s of sound (${underruns})`);
}

await t.browser.close();
if (failures.length) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
console.log("all passed");
