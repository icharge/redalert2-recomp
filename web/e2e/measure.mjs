// W5.2: how fast a skirmish runs in the page at a picture size, idle and while the view pans.
//
//   node e2e/measure.mjs [--video 800x600] [--seconds 20] [--headed]
//
// It starts the page with ?stats&video=WxH (the size is put into RA2MD.INI in memory, the game folder
// is not touched; without --video the size in the game folder's own settings is used), plays Single
// Player > Skirmish > Start Game, then reads the game's frame rate from its own events and the page's
// picture and animation-frame rates from the overlay (src/screens/FrameStats.tsx), once a second.
// Prints one line of medians for each phase. A headless Chrome draws without a GPU compositor, so the
// page's numbers are the lower bound of a real window's.
import { options, startPage } from "./lib.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const video = flag("--video", "");
const seconds = Number(flag("--seconds", 20));
const base = options(argv);
const url = new URL(base.url);
url.searchParams.set("stats", "1");
if (video) url.searchParams.set("video", video);

const t = await startPage({ ...base, url: url.toString() });
await t.waitFor("the main menu", (s) => s?.phase === "running");
const menuAt = Date.now();
const at = async (s) => {
  const wait = menuAt + s * Number(process.env.SLOW ?? 1) * 1000 - Date.now();
  if (wait > 0) await t.page.waitForTimeout(wait);
};
await at(6);
await t.clickGame(719, 221); // Single Player
await at(12);
await t.clickGame(720, 305); // Skirmish
await at(18);
await t.clickGame(719, 263); // Start Game
await t.waitFor("the battle", (s) => (s?.fps ?? 0) > 0, 240);
await t.page.waitForTimeout(5000); // the load's own frames are over

const sample = () =>
  t.page.evaluate(() => {
    const snapshot = window.ra2Store?.getSnapshot();
    const text = [...document.querySelectorAll("div")].find((d) =>
      d.textContent?.startsWith("game"),
    )?.innerText;
    const page = /page (\d+) pictures\/s, (\d+) frames\/s/.exec(text ?? "");
    const draw = /draw ([\d.]+) ms/.exec(text ?? "");
    return {
      fps: snapshot?.fps ?? 0,
      worst: snapshot?.pacing?.worstMs ?? null,
      late: snapshot?.pacing?.late ?? null,
      published: snapshot?.pacing?.published ?? null,
      publishMs: snapshot?.pacing?.publishMs ?? null,
      pictures: page ? Number(page[1]) : null,
      ticks: page ? Number(page[2]) : null,
      drawMs: draw ? Number(draw[1]) : null,
      size: snapshot?.size,
    };
  });
const median = (values) => {
  const sorted = values.filter((v) => v !== null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const phase = async (name, action) => {
  const rows = [];
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await action?.();
    await t.page.waitForTimeout(1000);
    rows.push(await sample());
  }
  const last = rows.at(-1);
  // a long run: one line for each half minute, to see the game slow down as it fills with units
  for (let i = 0; rows.length > 40 && i < rows.length; i += 30) {
    const part = rows.slice(i, i + 30);
    console.log(
      `  ${String(i).padStart(4)}s game ${median(part.map((r) => r.fps))} fps (min ${Math.min(...part.map((r) => r.fps))})  publish ${median(part.map((r) => r.publishMs))} ms, worst gap ${Math.max(...part.map((r) => r.worst ?? 0))} ms, ${part.reduce((n, r) => n + (r.late ?? 0), 0)} late`,
    );
  }
  console.log(
    `${name.padEnd(8)} ${last?.size?.w}x${last?.size?.h}  game ${median(rows.map((r) => r.fps))} fps` +
      ` (min ${Math.min(...rows.map((r) => r.fps))})  page ${median(rows.map((r) => r.pictures))} pictures/s` +
      ` ${median(rows.map((r) => r.ticks))} frames/s  draw ${median(rows.map((r) => r.drawMs))} ms` +
      `  publish ${median(rows.map((r) => r.published))}/s ${median(rows.map((r) => r.publishMs))} ms,` +
      ` worst gap ${Math.max(...rows.map((r) => r.worst ?? 0))} ms, ${rows.reduce((n, r) => n + (r.late ?? 0), 0)} late`,
  );
};
await phase("idle");
// W9.3: compare the same running skirmish with the real HD voxel compositor
// off and on. This also records the game's and presenter's frame times.
await t.page.evaluate(() => window.Module.cwrap("ra2_setting", null, ["number", "number", "number"])(2, 1, 0));
await t.page.waitForFunction(() => window.ra2Store?.getSnapshot().settings?.hd === true);
await t.page.waitForTimeout(2000);
await phase("HD idle");
await t.page.evaluate(() => window.Module.cwrap("ra2_setting", null, ["number", "number", "number"])(2, 0, 0));
await t.page.waitForFunction(() => window.ra2Store?.getSnapshot().settings?.hd === false);
await t.page.waitForTimeout(1000);
const size = (await sample()).size ?? { w: 800, h: 600 };
await phase("panning", () =>
  t.rdrag(size.w / 2, size.h / 2, size.w / 2 + size.w / 4, size.h / 2, 600),
);
await t.browser.close();
