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
  console.log(
    `${name.padEnd(8)} ${last?.size?.w}x${last?.size?.h}  game ${median(rows.map((r) => r.fps))} fps` +
      ` (min ${Math.min(...rows.map((r) => r.fps))})  page ${median(rows.map((r) => r.pictures))} pictures/s` +
      ` ${median(rows.map((r) => r.ticks))} frames/s  draw ${median(rows.map((r) => r.drawMs))} ms`,
  );
};
await phase("idle");
const size = (await sample()).size ?? { w: 800, h: 600 };
await phase("panning", () =>
  t.rdrag(size.w / 2, size.h / 2, size.w / 2 + size.w / 4, size.h / 2, 600),
);
await t.browser.close();
