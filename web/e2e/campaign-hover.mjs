// The campaign screen's Allied and Soviet emblems light up while the pointer
// is over them. The dialog runs that hover from its WM_NCHITTEST, which Windows
// sends with screen coordinates ahead of every mouse message (the dialog never
// reads WM_MOUSEMOVE); win32hle used to send only the mouse message, so the
// emblems stayed still in the browser and on the Linux host.
//
//   node e2e/campaign-hover.mjs --game ../game --shots ../work/campaign-hover
//   node e2e/campaign-hover.mjs --url 'http://localhost:5173/?target=game' ...  (Red Alert 2)
//
// Raw 800x600 game pixels: the screen is still with the pointer away, a hover
// changes the emblem, and moving away restores it. The pointer's own box is
// left out of the comparison because the game draws its cursor into the picture.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
// Both editions' Single Player button is 1667 and New Campaign is 1672.
opts.pageArgs.push("--mute", "--debuglog", "--press", "0xE2:1667@1", "--press", "0x100:1672@2");
const run = await startPage(opts);
// Dialog 0x94's emblem statics, as the game places them at 800x600 (the HLE
// window list: `--windows`).
const ra2 = new URL(opts.url).searchParams.get("target") === "game";
const emblems = ra2
  ? { allied: [30, 26, 570, 135], soviet: [98, 298, 444, 149] }
  : { allied: [141, 58, 348, 136], soviet: [141, 364, 348, 136] };
const away = [600, 520];
const centre = ([x, y, w, h]) => [x + Math.round(w / 2), y + Math.round(h / 2)];
const allied = centre(emblems.allied);
const soviet = centre(emblems.soviet);
const waitDialog = async (id) => {
  const deadline = Date.now() + 180000;
  while (!run.all.some((line) => line.includes(`[dialog] open ${id}`))) {
    assert.ok(Date.now() < deadline, `waiting for dialog ${id}`);
    assert.notEqual((await run.state())?.phase, "crashed");
    await run.page.waitForTimeout(250);
  }
};
/** A capture and one emblem's pixels, minus a box around the pointer (the game's cursor). */
const emblemPixels = (name, pointer) =>
  run.page.evaluate(
    async ([emblem, pointer]) => {
      const { width, height, data } = await window.ra2Presenter.capture();
      if (width !== 800 || height !== 600)
        throw new Error(`expected an 800x600 menu, got ${width}x${height}`);
      const [x, y, w, h] = emblem;
      const out = [];
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          if (Math.abs(xx - pointer[0]) < 20 && Math.abs(yy - pointer[1]) < 20) continue;
          const at = (yy * width + xx) * 4;
          out.push(data[at], data[at + 1], data[at + 2]);
        }
      return out;
    },
    [emblems[name], pointer],
  );
/** The screen fades the menu in; wait until the emblems are actually painted. */
const waitForEmblems = async () => {
  const deadline = Date.now() + 60000;
  const [x, y, w, h] = emblems.allied;
  for (;;) {
    const bright = await run.page.evaluate(
      async ([x, y, w, h]) => {
        const { width, data } = await window.ra2Presenter.capture();
        let n = 0;
        for (let yy = y; yy < y + h; yy++)
          for (let xx = x; xx < x + w; xx++) {
            const at = (yy * width + xx) * 4;
            if (data[at] > 150 && data[at + 1] > 150 && data[at + 2] > 150) n++;
          }
        return n;
      },
      [x, y, w, h],
    );
    if (bright > 300) return;
    assert.ok(Date.now() < deadline, "waiting for the campaign emblems to be painted");
    await run.page.waitForTimeout(250);
  }
};
function difference(a, b) {
  let over8 = 0;
  for (let i = 0; i < a.length; i += 3)
    if (
      Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2]),
      ) > 8
    )
      over8++;
  return over8;
}
try {
  await run.waitFor("the main menu", (s) => s?.phase === "running");
  await waitDialog("0x94"); // the script's presses: Single Player, then New Campaign
  await waitForEmblems();
  await run.page.waitForTimeout(500);

  await run.moveGame(...away);
  await run.page.waitForTimeout(600);
  const alliedIdle = await emblemPixels("allied", away);
  const sovietIdle = await emblemPixels("soviet", away);
  await run.page.waitForTimeout(600);
  const alliedIdleAgain = await emblemPixels("allied", away);
  const idleDrift = difference(alliedIdle, alliedIdleAgain);

  await run.moveGame(...allied);
  await run.page.waitForTimeout(800);
  const alliedHover = await emblemPixels("allied", allied);
  const alliedChanged = difference(alliedIdleAgain, alliedHover);

  await run.moveGame(...soviet);
  await run.page.waitForTimeout(800);
  const sovietHover = await emblemPixels("soviet", soviet);
  const sovietChanged = difference(sovietIdle, sovietHover);

  await run.moveGame(...away);
  await run.page.waitForTimeout(1200);
  const alliedAfter = await emblemPixels("allied", away);
  const alliedRestored = difference(alliedIdle, alliedAfter);

  const report = {
    edition: ra2 ? "ra2" : "ra2md",
    idleDrift,
    alliedChanged,
    sovietChanged,
    alliedRestored,
  };
  writeFileSync(path.join(opts.shots, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.equal(idleDrift, 0, "the campaign screen is still with the pointer away");
  assert.ok(alliedChanged > 400, `hovering the Allied emblem changes it (${alliedChanged} pixels)`);
  assert.ok(sovietChanged > 400, `hovering the Soviet emblem changes it (${sovietChanged} pixels)`);
  assert.ok(alliedRestored < 100, `leaving restores the Allied emblem (${alliedRestored} pixels)`);
  console.log(`PASS campaign emblem hover (${ra2 ? "Red Alert 2" : "Yuri's Revenge"})`);
} finally {
  await run.shot("last").catch(() => {});
  writeFileSync(path.join(opts.shots, "run.log"), run.all.join("\n"));
  await run.browser.close();
}
